import type { RiftEnvironment, RiftPreset, RiftSettings, MigrationHistoryEntry } from './types';
import { DEFAULT_SETTINGS } from './types';
import { encrypt, decrypt, type EncryptedValue } from './crypto';

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

// --- Environments (async, encrypted) ---

/** Stored environment shape — clientSecret is encrypted, clientId may be encrypted. */
interface StoredEnvironment {
  id: string;
  name: string;
  cmUrl: string;
  clientId: string | EncryptedValue;
  clientSecret: string | EncryptedValue;
  allowWrite: boolean;
}

async function decryptEnv(stored: StoredEnvironment): Promise<RiftEnvironment> {
  return {
    id: stored.id,
    name: stored.name,
    cmUrl: stored.cmUrl,
    clientId: await decrypt(stored.clientId as EncryptedValue),
    clientSecret: await decrypt(stored.clientSecret as EncryptedValue),
    allowWrite: stored.allowWrite,
  };
}

async function encryptEnv(env: RiftEnvironment): Promise<StoredEnvironment> {
  return {
    id: env.id,
    name: env.name,
    cmUrl: env.cmUrl,
    clientId: await encrypt(env.clientId),
    clientSecret: await encrypt(env.clientSecret),
    allowWrite: env.allowWrite,
  };
}

export async function getEnvironments(): Promise<RiftEnvironment[]> {
  const stored = readJson<StoredEnvironment>(ENVS_KEY);
  return Promise.all(stored.map(decryptEnv));
}

export async function saveEnvironment(env: RiftEnvironment): Promise<void> {
  const envs = await getEnvironments();
  const idx = envs.findIndex((e) => e.id === env.id);
  if (idx >= 0) {
    envs[idx] = env;
  } else {
    envs.push(env);
  }
  const encrypted = await Promise.all(envs.map(encryptEnv));
  writeJson(ENVS_KEY, encrypted);
}

export async function deleteEnvironment(id: string): Promise<void> {
  const envs = await getEnvironments();
  const encrypted = await Promise.all(
    envs.filter((e) => e.id !== id).map(encryptEnv)
  );
  writeJson(ENVS_KEY, encrypted);
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
