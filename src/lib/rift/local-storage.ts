import type { RiftPreset, RiftSettings, MigrationHistoryEntry } from './types';
import { DEFAULT_SETTINGS } from './types';

const PRESETS_KEY = 'rift:presets';
const SETTINGS_KEY = 'rift:settings';
const HISTORY_KEY = 'rift:history';
const MAX_HISTORY = 50;

export function getPresets(): RiftPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    // Detect old format presets and discard
    if (raw.length > 0 && raw[0].sourceEnvId && !raw[0].sourceTenantId) {
      localStorage.removeItem(PRESETS_KEY);
      return [];
    }
    return raw;
  } catch { return []; }
}

export function savePreset(preset: RiftPreset): void {
  const presets = getPresets();
  const index = presets.findIndex(p => p.id === preset.id);
  if (index >= 0) presets[index] = preset;
  else presets.push(preset);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function deletePreset(id: string): void {
  const presets = getPresets().filter(p => p.id !== id);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function getSettings(): RiftSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: RiftSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getHistory(): MigrationHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch { return []; }
}

export function addHistoryEntry(entry: MigrationHistoryEntry): void {
  const history = [entry, ...getHistory()].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
