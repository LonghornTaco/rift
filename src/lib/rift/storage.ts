import type { RiftEnvironment, RiftPreset, RiftSettings, MigrationHistoryEntry } from './types';
import { DEFAULT_SETTINGS } from './types';

const ENVS_KEY = 'rift:environments';
const PRESETS_KEY = 'rift:presets';
const SETTINGS_KEY = 'rift:settings';
const HISTORY_KEY = 'rift:history';
const MAX_HISTORY = 50;

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeJson<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// --- Environments (sync, no encryption) ---

export function getEnvironments(): RiftEnvironment[] {
  return readJson<RiftEnvironment>(ENVS_KEY);
}

export function saveEnvironment(env: RiftEnvironment): void {
  const envs = getEnvironments();
  const idx = envs.findIndex((e) => e.id === env.id);
  if (idx >= 0) {
    envs[idx] = env;
  } else {
    envs.push(env);
  }
  writeJson(ENVS_KEY, envs);
}

export function deleteEnvironment(id: string): void {
  writeJson(ENVS_KEY, getEnvironments().filter((e) => e.id !== id));
}

// --- Presets (sync, no sensitive data) ---

export function getPresets(): RiftPreset[] {
  return readJson<RiftPreset>(PRESETS_KEY);
}

export function savePreset(preset: RiftPreset): void {
  const presets = getPresets();
  const idx = presets.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    presets.push(preset);
  }
  writeJson(PRESETS_KEY, presets);
}

export function deletePreset(id: string): void {
  writeJson(PRESETS_KEY, getPresets().filter((p) => p.id !== id));
}

// --- Settings (sync, no sensitive data) ---

export function getSettings(): RiftSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: RiftSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function updatePresetLastUsed(id: string): void {
  const presets = getPresets();
  const preset = presets.find((p) => p.id === id);
  if (preset) {
    preset.lastUsed = new Date().toISOString();
    writeJson(PRESETS_KEY, presets);
  }
}

// --- Migration History (sync, no sensitive data) ---

export function getHistory(): MigrationHistoryEntry[] {
  return readJson<MigrationHistoryEntry>(HISTORY_KEY);
}

export function addHistoryEntry(entry: MigrationHistoryEntry): void {
  const history = getHistory();
  history.unshift(entry); // newest first
  writeJson(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
