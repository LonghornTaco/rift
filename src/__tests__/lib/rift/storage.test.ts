import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEnvironments,
  saveEnvironment,
  deleteEnvironment,
  getPresets,
  savePreset,
  deletePreset,
  updatePresetLastUsed,
} from '@/lib/rift/storage';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const key in store) delete store[key]; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
});

describe('environment storage', () => {
  const env = {
    id: 'test-id-1',
    name: 'DEV',
    cmUrl: 'https://dev.sitecorecloud.io',
    clientId: 'client-123',
    clientSecret: 'secret-456',
    allowWrite: true,
  };

  it('returns empty array when no environments saved', () => {
    expect(getEnvironments()).toEqual([]);
  });

  it('saves and retrieves an environment', () => {
    saveEnvironment(env);
    const envs = getEnvironments();
    expect(envs).toHaveLength(1);
    expect(envs[0]).toEqual(env);
  });

  it('updates an existing environment by id', () => {
    saveEnvironment(env);
    saveEnvironment({ ...env, name: 'DEV-UPDATED' });
    const envs = getEnvironments();
    expect(envs).toHaveLength(1);
    expect(envs[0].name).toBe('DEV-UPDATED');
  });

  it('deletes an environment by id', () => {
    saveEnvironment(env);
    deleteEnvironment('test-id-1');
    expect(getEnvironments()).toEqual([]);
  });
});

describe('preset storage', () => {
  const preset = {
    id: 'preset-1',
    name: 'Full Site',
    paths: [
      { itemPath: '/sitecore/content/site/Home', itemId: 'guid-1', scope: 'ItemAndDescendants' as const },
    ],
    lastUsed: '2026-03-20T00:00:00.000Z',
  };

  it('returns empty array when no presets saved', () => {
    expect(getPresets()).toEqual([]);
  });

  it('saves and retrieves a preset', () => {
    savePreset(preset);
    expect(getPresets()).toHaveLength(1);
    expect(getPresets()[0]).toEqual(preset);
  });

  it('deletes a preset by id', () => {
    savePreset(preset);
    deletePreset('preset-1');
    expect(getPresets()).toEqual([]);
  });

  it('updates lastUsed timestamp', () => {
    savePreset(preset);
    updatePresetLastUsed('preset-1');
    const updated = getPresets()[0];
    expect(updated.lastUsed).not.toBe('2026-03-20T00:00:00.000Z');
  });
});
