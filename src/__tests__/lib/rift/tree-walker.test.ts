import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TreeWalker, type TreeWalkerOptions } from '@/lib/rift/tree-walker';
import type { DualTreeNode, TreeNode } from '@/lib/rift/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function treeNode(path: string): TreeNode {
  return { itemId: `id-${path}`, name: path.split('/').pop() ?? path, path, hasChildren: true, templateName: 'Folder' };
}

function folder(path: string): DualTreeNode {
  return {
    path,
    name: path.split('/').pop() ?? path,
    hasChildren: true,
    source: treeNode(path),
    target: treeNode(path),
  };
}

/** A walker whose every fetch returns a hand-resolved promise, recorded in call order. */
function setup(overrides: Partial<TreeWalkerOptions> = {}) {
  const reads: Deferred<DualTreeNode[]>[] = [];
  const fetch = vi.fn((_path: string) => {
    const d = deferred<DualTreeNode[]>();
    reads.push(d);
    return d.promise;
  });
  const next = vi.fn((_children: DualTreeNode[]): string[] => []);
  const onLoaded = vi.fn();
  const onProgress = vi.fn();
  const walker = new TreeWalker({
    fetch,
    isCached: () => false,
    next,
    onLoaded,
    onProgress,
    ...overrides,
  });
  return { walker, reads, fetch, next, onLoaded, onProgress };
}

function fetchedPaths(fetch: { mock: { calls: unknown[][] } }): unknown[] {
  return fetch.mock.calls.map((call) => call[0]);
}

describe('TreeWalker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes paths in order with at most two in flight', async () => {
    const { walker, reads, fetch } = setup();
    walker.enqueue(['/r/a', '/r/b', '/r/c']);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/b']);
    expect(walker.progress).toEqual({ checked: 0, pending: 1, inFlight: 2, paused: false });

    reads[0].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/b', '/r/c']);
  });

  it('puts front insertions ahead of the queue', async () => {
    const { walker, reads, fetch } = setup({ concurrency: 1 });
    walker.enqueue(['/r/a', '/r/b']);
    walker.enqueue(['/r/c'], 'front');
    expect(fetchedPaths(fetch)).toEqual(['/r/a']);

    reads[0].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/c']);
  });

  it('skips cached and duplicate paths', () => {
    const { walker, fetch } = setup({ isCached: (path) => path === '/r/a' });
    walker.enqueue(['/r/a', '/r/b', '/r/b']);
    walker.enqueue(['/r/b']);
    expect(fetchedPaths(fetch)).toEqual(['/r/b']);
    expect(walker.progress).toEqual({ checked: 0, pending: 0, inFlight: 1, paused: false });
  });

  it('skips a queued path that became cached before it was taken', async () => {
    const cached = new Set<string>();
    const { walker, reads, fetch, onLoaded } = setup({ concurrency: 1, isCached: (path) => cached.has(path) });
    walker.enqueue(['/r/a', '/r/b', '/r/c']);
    cached.add('/r/b');

    reads[0].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/c']);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(walker.progress).toEqual({ checked: 1, pending: 0, inFlight: 1, paused: false });
  });

  it('stores a result, counts it and follows next()', async () => {
    const { walker, reads, fetch, next, onLoaded } = setup();
    next.mockReturnValue(['/r/a/x']);
    walker.enqueue(['/r/a']);

    const children = [folder('/r/a/x')];
    reads[0].resolve(children);
    await vi.advanceTimersByTimeAsync(0);

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith('/r/a', children);
    expect(next).toHaveBeenCalledWith(children);
    expect(walker.progress.checked).toBe(1);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/a/x']);
  });

  it('retries a failed read after 1000 then 2000 ms, then drops it', async () => {
    const { walker, reads, fetch, onLoaded } = setup();
    walker.enqueue(['/r/a']);
    walker.enqueue(['/r/a']);
    expect(fetch).toHaveBeenCalledTimes(1);

    reads[0].reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(0);
    expect(walker.progress).toEqual({ checked: 0, pending: 1, inFlight: 0, paused: false });
    walker.enqueue(['/r/a']);
    expect(walker.progress.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    reads[1].reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);

    reads[2].reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(walker.progress).toEqual({ checked: 0, pending: 0, inFlight: 0, paused: false });
  });

  it('pauses before taking the next path and resumes later', async () => {
    const { walker, reads, fetch, onLoaded } = setup({ concurrency: 1 });
    walker.enqueue(['/r/a', '/r/b']);
    walker.pause();
    expect(walker.progress.paused).toBe(true);

    reads[0].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLoaded).toHaveBeenCalledWith('/r/a', []);
    expect(fetchedPaths(fetch)).toEqual(['/r/a']);
    expect(walker.progress).toEqual({ checked: 1, pending: 1, inFlight: 0, paused: true });

    walker.resume();
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/b']);
    expect(walker.progress.paused).toBe(false);
  });

  it('drops a read that lands after reset()', async () => {
    const { walker, reads, fetch, next, onLoaded } = setup();
    next.mockReturnValue(['/r/a/x']);
    walker.enqueue(['/r/a']);

    walker.reset();
    expect(walker.progress).toEqual({ checked: 0, pending: 0, inFlight: 0, paused: false });

    walker.enqueue(['/r/a']);
    expect(fetchedPaths(fetch)).toEqual(['/r/a', '/r/a']);

    reads[0].resolve([folder('/r/a/x')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(walker.progress).toEqual({ checked: 0, pending: 0, inFlight: 1, paused: false });

    next.mockReturnValue([]);
    reads[1].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(walker.progress.checked).toBe(1);
  });

  it('drops a failure that lands after reset() without retrying it', async () => {
    const { walker, reads, fetch } = setup();
    walker.enqueue(['/r/a']);
    walker.reset();

    reads[0].reject(new Error('stale'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(walker.progress).toEqual({ checked: 0, pending: 0, inFlight: 0, paused: false });
  });

  it('cancels a waiting retry on reset()', async () => {
    const { walker, reads, fetch } = setup();
    walker.enqueue(['/r/a']);
    reads[0].reject(new Error('boom'));
    await vi.advanceTimersByTimeAsync(0);
    expect(walker.progress.pending).toBe(1);

    walker.reset();
    expect(walker.progress.pending).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports progress after every change', async () => {
    const { walker, reads, onProgress } = setup();
    const count = () => onProgress.mock.calls.length;

    walker.enqueue(['/r/a']);
    const afterEnqueue = count();
    expect(afterEnqueue).toBeGreaterThan(0);

    reads[0].resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    const afterSettle = count();
    expect(afterSettle).toBeGreaterThan(afterEnqueue);
    expect(onProgress.mock.calls[afterSettle - 1][0]).toEqual({ checked: 1, pending: 0, inFlight: 0, paused: false });

    walker.pause();
    const afterPause = count();
    expect(afterPause).toBeGreaterThan(afterSettle);
    expect(onProgress.mock.calls[afterPause - 1][0].paused).toBe(true);

    walker.resume();
    const afterResume = count();
    expect(afterResume).toBeGreaterThan(afterPause);

    walker.reset();
    const afterReset = count();
    expect(afterReset).toBeGreaterThan(afterResume);
    expect(onProgress.mock.calls[afterReset - 1][0]).toEqual({ checked: 0, pending: 0, inFlight: 0, paused: false });

    const last = onProgress.mock.calls[afterReset - 1][0];
    const previous = onProgress.mock.calls[afterReset - 2][0];
    expect(last).not.toBe(previous);
    expect(walker.progress).not.toBe(walker.progress);
  });
});
