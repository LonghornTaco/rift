import { describe, it, expect } from 'vitest';
import { formatProgress, classifyError } from '@/lib/rift/progress-format';
import type { TransferProgress } from '@/lib/rift/types';

const base = (over: Partial<TransferProgress>): TransferProgress => ({
  itemPath: '/sitecore/content/Home',
  phase: 'creating',
  ...over,
});

describe('formatProgress', () => {
  it('maps creating to Prepare with an indeterminate bar', () => {
    const r = formatProgress(base({ phase: 'creating' }));
    expect(r).toEqual({ stage: 'Prepare', statusLine: 'Preparing transfer', percent: null, state: 'active' });
  });

  it('uses the source env name when packaging', () => {
    const r = formatProgress(base({ phase: 'exporting' }), { source: 'prod' });
    expect(r.stage).toBe('Package');
    expect(r.statusLine).toBe('Packaging content on prod...');
  });

  it('falls back to generic "target" when no name is given', () => {
    const r = formatProgress(base({ phase: 'uploading', chunksComplete: 6, chunksTotal: 10 }));
    expect(r.statusLine).toBe('Uploading to target (6 of 10)');
  });

  it('computes percent from chunk counts while uploading', () => {
    const r = formatProgress(base({ phase: 'uploading', chunksComplete: 6, chunksTotal: 10 }), { target: 'dev' });
    expect(r).toEqual({ stage: 'Transfer', statusLine: 'Uploading to dev (6 of 10)', percent: 60, state: 'active' });
  });

  it('reports 100 percent and complete state when done', () => {
    const r = formatProgress(base({ phase: 'complete' }));
    expect(r).toEqual({ stage: 'Done', statusLine: 'Done', percent: 100, state: 'complete' });
  });

  it('holds the last known percent on error using retained chunk counts', () => {
    const r = formatProgress(base({ phase: 'error', chunksComplete: 1, chunksTotal: 6, error: 'boom' }));
    expect(r.state).toBe('error');
    expect(r.stage).toBe('Failed');
    expect(r.percent).toBe(17);
  });

  it('omits the chunk suffix and percent when counts are unknown', () => {
    const r = formatProgress(base({ phase: 'downloading' }));
    expect(r.statusLine).toBe('Downloading content');
    expect(r.percent).toBeNull();
  });
});

describe('classifyError', () => {
  it('gives friendly CORS copy for preflight/method errors', () => {
    const msg = 'saveChunk PUT blocked: Method PUT is not allowed by Access-Control-Allow-Methods in preflight response';
    expect(classifyError(msg)).toBe('Upload was blocked by the target environment (CORS). This is an environment-side setting, not a Rift issue.');
  });

  it('gives a generic message for other errors', () => {
    expect(classifyError('Maximum call stack size exceeded')).toBe('Migration failed for this item.');
  });

  it('handles undefined', () => {
    expect(classifyError(undefined)).toBe('Migration failed for this item.');
  });
});
