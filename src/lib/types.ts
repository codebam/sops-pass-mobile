import { base64 } from '@scure/base';

export interface SyncConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Path of the sops-encrypted YAML file inside the repo. */
  path: string;
}

export interface VaultEntry {
  /** "google.com" or "wordpress.com/codebam@riseup.net" — the pass-style path. */
  path: string;
  value: string;
}

export interface Vault {
  entries: VaultEntry[];
  lastModified?: string;
  sopsVersion?: string;
  /** Git blob sha the vault was fetched at ("" when decrypted from local cache). */
  sha: string;
  syncedAt: number;
  fromCache: boolean;
}

export function valueToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (v instanceof Uint8Array) return base64.encode(v);
  return String(v);
}

/** Flatten the decrypted data tree into <path, value> leaves, document order preserved. */
export function flattenVault(data: Record<string, unknown>): VaultEntry[] {
  const out: VaultEntry[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (v === null || v === undefined) {
      out.push({ path: path.join('/'), value: '' });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((el, i) => walk(el, [...path, String(i)]));
      return;
    }
    if (typeof v === 'object' && !(v instanceof Uint8Array)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, [...path, k]);
      return;
    }
    out.push({ path: path.join('/'), value: valueToString(v) });
  };
  for (const [k, v] of Object.entries(data)) walk(v, [k]);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
