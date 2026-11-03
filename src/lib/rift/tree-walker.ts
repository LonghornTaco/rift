import type { DualTreeNode } from './types';

export interface WalkProgress {
  checked: number;
  pending: number;
  inFlight: number;
  paused: boolean;
}

export interface TreeWalkerOptions {
  /** Strict read of one folder's children on both environments; rejects on any failure. */
  fetch: (path: string) => Promise<DualTreeNode[]>;
  isCached: (path: string) => boolean;
  /** The child folders the walk may descend into. */
  next: (children: DualTreeNode[]) => string[];
  onLoaded: (path: string, children: DualTreeNode[]) => void;
  onProgress: (progress: WalkProgress) => void;
  concurrency?: number;
  maxAttempts?: number;
  /** Delay before the first retry; doubled for each later retry. */
  retryDelayMs?: number;
}

/**
 * Bounded, retrying, pausable breadth-first folder walk. Pure scheduling:
 * it only decides when to call `fetch` and reports what came back.
 */
export class TreeWalker {
  private readonly fetchChildren: TreeWalkerOptions['fetch'];
  private readonly isCached: TreeWalkerOptions['isCached'];
  private readonly next: TreeWalkerOptions['next'];
  private readonly onLoaded: TreeWalkerOptions['onLoaded'];
  private readonly onProgress: TreeWalkerOptions['onProgress'];
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  private queue: string[] = [];
  private readonly inFlight = new Set<string>();
  private readonly retrying = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private generation = 0;
  private checked = 0;
  private paused = false;

  constructor(options: TreeWalkerOptions) {
    this.fetchChildren = options.fetch;
    this.isCached = options.isCached;
    this.next = options.next;
    this.onLoaded = options.onLoaded;
    this.onProgress = options.onProgress;
    this.concurrency = options.concurrency ?? 2;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  get progress(): WalkProgress {
    return {
      checked: this.checked,
      pending: this.queue.length + this.retrying.size,
      inFlight: this.inFlight.size,
      paused: this.paused,
    };
  }

  enqueue(paths: readonly string[], position: 'back' | 'front' = 'back'): void {
    const fresh: string[] = [];
    for (const path of paths) {
      if (fresh.includes(path) || this.isKnown(path) || this.isCached(path)) continue;
      fresh.push(path);
    }
    if (position === 'front') this.queue.unshift(...fresh);
    else this.queue.push(...fresh);
    this.emit();
    this.pump();
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.emit();
    this.pump();
  }

  reset(): void {
    this.generation += 1;
    this.queue = [];
    this.inFlight.clear();
    for (const timer of this.retrying.values()) clearTimeout(timer);
    this.retrying.clear();
    this.attempts.clear();
    this.checked = 0;
    this.paused = false;
    this.emit();
  }

  private isKnown(path: string): boolean {
    return this.queue.includes(path) || this.inFlight.has(path) || this.retrying.has(path);
  }

  private emit(): void {
    this.onProgress(this.progress);
  }

  private pump(): void {
    while (!this.paused && this.inFlight.size < this.concurrency && this.queue.length > 0) {
      const path = this.queue.shift()!;
      if (!this.isCached(path)) this.start(path);
      this.emit();
    }
  }

  private start(path: string): void {
    const generation = this.generation;
    this.inFlight.add(path);
    let read: Promise<DualTreeNode[]>;
    try {
      read = this.fetchChildren(path);
    } catch (error) {
      read = Promise.reject(error);
    }
    read.then(
      (children) => {
        if (generation === this.generation) this.succeed(path, children);
      },
      () => {
        if (generation === this.generation) this.fail(path);
      },
    );
  }

  private succeed(path: string, children: DualTreeNode[]): void {
    this.inFlight.delete(path);
    this.attempts.delete(path);
    this.onLoaded(path, children);
    this.checked += 1;
    this.enqueue(this.next(children), 'back');
  }

  private fail(path: string): void {
    this.inFlight.delete(path);
    const attempt = (this.attempts.get(path) ?? 0) + 1;
    if (attempt >= this.maxAttempts) {
      this.attempts.delete(path);
    } else {
      this.attempts.set(path, attempt);
      const timer = setTimeout(() => {
        this.retrying.delete(path);
        this.queue.push(path);
        this.emit();
        this.pump();
      }, this.retryDelayMs * 2 ** (attempt - 1));
      this.retrying.set(path, timer);
    }
    this.emit();
    this.pump();
  }
}
