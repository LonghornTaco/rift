import type { TransferProgress } from './types';

export type MigrationStage = 'Prepare' | 'Package' | 'Transfer' | 'Import' | 'Done' | 'Failed';

export interface ProgressEnvNames {
  source?: string;
  target?: string;
}

export interface FormattedProgress {
  /** Coarse user-facing stage - used for wording, not shown as a stepper. */
  stage: MigrationStage;
  /** Plain-English status line for the row. */
  statusLine: string;
  /** 0-100 when known; null means indeterminate (show "-" and an animated bar). */
  percent: number | null;
  /** Drives icon and colour. */
  state: 'active' | 'complete' | 'error';
}

const CORS_PATTERN = /cors|access-control|preflight|method (put|delete)/i;

/**
 * Turn a raw transfer error message into human-readable copy. The raw message
 * is still shown in the per-row debug log.
 */
export function classifyError(message: string | undefined): string {
  if (message && CORS_PATTERN.test(message)) {
    return 'Upload was blocked by the target environment (CORS). This is an environment-side setting, not a Rift issue.';
  }
  return 'Migration failed for this item.';
}

function chunkSuffix(tp: TransferProgress): string {
  const { chunksComplete, chunksTotal } = tp;
  if (chunksComplete != null && chunksTotal != null && chunksTotal > 0) {
    return ` (${chunksComplete} of ${chunksTotal})`;
  }
  return '';
}

function percentFor(tp: TransferProgress): number | null {
  if (tp.phase === 'complete') return 100;
  const { chunksComplete, chunksTotal } = tp;
  if (chunksComplete != null && chunksTotal != null && chunksTotal > 0) {
    return Math.round((chunksComplete / chunksTotal) * 100);
  }
  return null;
}

/**
 * Map a TransferProgress to friendly display fields. `envs.source`/`envs.target`
 * are the environment display names; fall back to generic "source"/"target".
 */
export function formatProgress(tp: TransferProgress, envs: ProgressEnvNames = {}): FormattedProgress {
  const source = envs.source ?? 'source';
  const target = envs.target ?? 'target';

  switch (tp.phase) {
    case 'creating':
      return { stage: 'Prepare', statusLine: 'Preparing transfer', percent: null, state: 'active' };
    case 'exporting':
      return { stage: 'Package', statusLine: `Packaging content on ${source}...`, percent: null, state: 'active' };
    case 'downloading':
      return { stage: 'Package', statusLine: `Downloading content${chunkSuffix(tp)}`, percent: percentFor(tp), state: 'active' };
    case 'uploading':
      return { stage: 'Transfer', statusLine: `Uploading to ${target}${chunkSuffix(tp)}`, percent: percentFor(tp), state: 'active' };
    case 'assembling':
      return { stage: 'Transfer', statusLine: `Assembling package on ${target}`, percent: null, state: 'active' };
    case 'consuming':
      return { stage: 'Import', statusLine: `Importing into ${target}`, percent: null, state: 'active' };
    case 'cleanup':
      return { stage: 'Import', statusLine: 'Finishing up', percent: null, state: 'active' };
    case 'complete':
      return { stage: 'Done', statusLine: 'Done', percent: 100, state: 'complete' };
    case 'error':
      return { stage: 'Failed', statusLine: classifyError(tp.error), percent: percentFor(tp), state: 'error' };
    default:
      return { stage: 'Prepare', statusLine: 'Working...', percent: null, state: 'active' };
  }
}
