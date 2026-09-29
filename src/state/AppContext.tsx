import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { generateAgeKeyPair, recipientForIdentity, type AgeKeyPair } from '../lib/age';
import { decryptSopsYaml } from '../lib/sops';
import { fetchVaultFromGitHub } from '../lib/github';
import { flattenVault, type Vault, type SyncConfig } from '../lib/types';
import * as store from '../lib/storage';
import type { PersistedSettings } from '../lib/storage';

export type { Vault } from '../lib/types';

interface AppApi {
  ready: boolean;
  identity: string | null;
  recipient: string | null;
  settings: PersistedSettings;
  token: string;
  vault: Vault | null;
  syncing: boolean;
  syncError: string | null;
  locked: boolean;

  generateKey(): Promise<AgeKeyPair>;
  importKey(identity: string): Promise<string>;
  resetKey(): Promise<void>;
  updateSettings(patch: Partial<PersistedSettings>): Promise<void>;
  updateSyncConfig(sync: Partial<SyncConfig>): Promise<void>;
  updateToken(token: string): Promise<void>;
  refresh(): Promise<void>;
  unlock(): Promise<boolean>;
  lockNow(): void;
  wipe(): Promise<void>;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [settings, setSettings] = useState<PersistedSettings>(store.DEFAULT_SETTINGS);
  const [token, setToken] = useState('');
  const [vault, setVault] = useState<Vault | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const syncingRef = useRef(false);

  // --- boot -----------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const [id, tok, s] = await Promise.all([store.loadIdentity(), store.loadToken(), store.loadSettings()]);
      setIdentity(id);
      setToken(tok);
      setSettings(s);
      if (id) {
        try {
          setRecipient(await recipientForIdentity(id));
        } catch {
          setRecipient(null);
        }
        setLocked(s.lockEnabled);
        // Instant unlock from the cached ciphertext, if we have it.
        const cached = store.readCachedVault();
        if (cached) {
          try {
            const dec = await decryptSopsYaml(cached, id);
            setVault({
              entries: flattenVault(dec.data),
              lastModified: typeof dec.metadata.lastmodified === 'string' ? dec.metadata.lastmodified : undefined,
              sopsVersion: typeof dec.metadata.version === 'string' ? dec.metadata.version : undefined,
              sha: '',
              syncedAt: Date.now(),
              fromCache: true,
            });
          } catch {
            /* corrupt/rotated cache — a network refresh will fix it */
          }
        }
      }
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  // --- lock on background ---------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && settingsRef.current.lockEnabled) setLocked(true);
    });
    return () => sub.remove();
  }, []);

  // --- actions --------------------------------------------------------------
  const generateKey = useCallback(async (): Promise<AgeKeyPair> => {
    const kp = await generateAgeKeyPair();
    await store.saveIdentity(kp.identity);
    setIdentity(kp.identity);
    setRecipient(kp.recipient);
    return kp;
  }, []);

  const importKey = useCallback(async (raw: string): Promise<string> => {
    const trimmed = raw.trim();
    const rec = await recipientForIdentity(trimmed); // throws when malformed
    await store.saveIdentity(trimmed);
    setIdentity(trimmed);
    setRecipient(rec);
    return rec;
  }, []);

  const resetKey = useCallback(async () => {
    await store.wipeAll();
    setIdentity(null);
    setRecipient(null);
    setVault(null);
    setSyncError(null);
    setToken('');
    setSettings(store.DEFAULT_SETTINGS);
    setLocked(false);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<PersistedSettings>) => {
    const next = { ...settingsRef.current, ...patch, sync: { ...settingsRef.current.sync, ...(patch.sync ?? {}) } };
    await store.saveSettings(next);
    setSettings(next);
  }, []);

  const updateSyncConfig = useCallback(
    async (sync: Partial<SyncConfig>) => updateSettings({ sync: { ...settingsRef.current.sync, ...sync } as SyncConfig }),
    [updateSettings],
  );

  const updateToken = useCallback(async (t: string) => {
    await store.saveToken(t);
    setToken(t);
  }, []);

  const refresh = useCallback(async () => {
    const id = identity;
    if (!id || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      const { text, sha } = await fetchVaultFromGitHub(settingsRef.current.sync, tokenRef.current);
      const dec = await decryptSopsYaml(text, id);
      setVault({
        entries: flattenVault(dec.data),
        lastModified: typeof dec.metadata.lastmodified === 'string' ? dec.metadata.lastmodified : undefined,
        sopsVersion: typeof dec.metadata.version === 'string' ? dec.metadata.version : undefined,
        sha,
        syncedAt: Date.now(),
        fromCache: false,
      });
      store.writeCachedVault(text);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [identity]);

  const unlock = useCallback(async (): Promise<boolean> => {
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hasHw && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) {
        setLocked(false);
        return true;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock sops-pass',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (res.success) setLocked(false);
      return res.success;
    } catch {
      return false;
    }
  }, []);

  const lockNow = useCallback(() => setLocked(true), []);

  const wipe = useCallback(async () => {
    await store.wipeAll();
    setIdentity(null);
    setRecipient(null);
    setVault(null);
    setToken('');
    setSettings(store.DEFAULT_SETTINGS);
    setSyncError(null);
    setLocked(false);
  }, []);

  const api = useMemo<AppApi>(
    () => ({
      ready,
      identity,
      recipient,
      settings,
      token,
      vault,
      syncing,
      syncError,
      locked,
      generateKey,
      importKey,
      resetKey,
      updateSettings,
      updateSyncConfig,
      updateToken,
      refresh,
      unlock,
      lockNow,
      wipe,
    }),
    [
      ready,
      identity,
      recipient,
      settings,
      token,
      vault,
      syncing,
      syncError,
      locked,
      generateKey,
      importKey,
      resetKey,
      updateSettings,
      updateSyncConfig,
      updateToken,
      refresh,
      unlock,
      lockNow,
      wipe,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
