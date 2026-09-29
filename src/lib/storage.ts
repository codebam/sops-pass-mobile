/**
 * Persistence: secrets (identity, token, settings) in expo-secure-store
 * (Android Keystore-backed), the encrypted vault blob cached on disk.
 * The cached blob is ciphertext — safe at rest; the plaintext never touches disk.
 *
 * A tiny in-memory fallback keeps the web preview usable where secure storage
 * does not exist; on device the secure-store path is always taken.
 */
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import type { SyncConfig } from './types';

const K_IDENTITY = 'sopspass.identity';
const K_TOKEN = 'sopspass.githubToken';
const K_SETTINGS = 'sopspass.settings';

export interface PersistedSettings {
  sync: SyncConfig;
  lockEnabled: boolean;
  autoClearClipboard: boolean;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  sync: { owner: 'codebam', repo: 'nixos', branch: 'master', path: 'secrets/passwords.enc.yaml' },
  lockEnabled: false,
  autoClearClipboard: true,
};

const memFallback = new Map<string, string>();

async function sGet(key: string): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v !== null && v !== undefined) return v;
  } catch {
    /* secure store unavailable (e.g. web preview) */
  }
  return memFallback.get(key) ?? null;
}

async function sSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
    return;
  } catch {
    memFallback.set(key, value);
  }
}

async function sDel(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
  memFallback.delete(key);
}

export async function loadIdentity(): Promise<string | null> {
  return sGet(K_IDENTITY);
}
export async function saveIdentity(identity: string): Promise<void> {
  await sSet(K_IDENTITY, identity);
}
export async function loadToken(): Promise<string> {
  return (await sGet(K_TOKEN)) ?? '';
}
export async function saveToken(token: string): Promise<void> {
  if (token) await sSet(K_TOKEN, token);
  else await sDel(K_TOKEN);
}

export async function loadSettings(): Promise<PersistedSettings> {
  try {
    const raw = await sGet(K_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sync: { ...DEFAULT_SETTINGS.sync, ...(parsed.sync ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveSettings(s: PersistedSettings): Promise<void> {
  await sSet(K_SETTINGS, JSON.stringify(s));
}

// --- cached encrypted vault ------------------------------------------------

function vaultCacheFile(): File {
  return new File(Paths.document, 'vault.enc.yaml');
}

export function readCachedVault(): string | null {
  try {
    const f = vaultCacheFile();
    if (!f.exists) return null;
    return f.textSync();
  } catch {
    return null;
  }
}

export function writeCachedVault(text: string): void {
  try {
    vaultCacheFile().write(text);
  } catch {
    /* cache is best-effort */
  }
}

export function clearCachedVault(): void {
  try {
    const f = vaultCacheFile();
    if (f.exists) f.delete();
  } catch {
    /* ignore */
  }
}

/** Forget everything: identity, token, settings, cached vault. */
export async function wipeAll(): Promise<void> {
  await sDel(K_IDENTITY);
  await sDel(K_TOKEN);
  await sDel(K_SETTINGS);
  clearCachedVault();
}
