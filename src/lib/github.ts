/**
 * Fetch the sops-encrypted vault file from a (private) GitHub repo.
 * Uses the contents API: works for private repos with a fine-grained PAT
 * (Contents: Read) and needs no git plumbing.
 */
import { base64 } from '@scure/base';
import type { SyncConfig } from './types';

const MAX_CONTENTS_API = 1_000_000; // GitHub refuses to inline content above ~1 MB

export interface VaultFetchResult {
  /** Raw encrypted YAML text. */
  text: string;
  /** Git blob sha (identifies the revision). */
  sha: string;
  size: number;
}

export async function fetchVaultFromGitHub(cfg: SyncConfig, token: string): Promise<VaultFetchResult> {
  const repoPath = cfg.path
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
  const url =
    `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}` +
    `/contents/${repoPath}?ref=${encodeURIComponent(cfg.branch)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sops-pass-mobile',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw new Error(`network error contacting api.github.com: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 200);
    try {
      const j = JSON.parse(body) as { message?: string };
      if (j.message) detail = j.message;
    } catch {
      /* keep raw snippet */
    }
    if (res.status === 404) {
      throw new Error(
        `GitHub 404 for ${cfg.owner}/${cfg.repo}/${cfg.path}@${cfg.branch}. ` +
          `Check owner/repo/path/branch and that the token has "Contents: Read" (${detail})`,
      );
    }
    if (res.status === 401) {
      throw new Error(`GitHub 401 — token invalid or expired (${detail})`);
    }
    throw new Error(`GitHub ${res.status}: ${detail}`);
  }

  const j = (await res.json()) as { content?: string; encoding?: string; sha?: string; size?: number };
  if (!j || typeof j !== 'object') throw new Error('unexpected GitHub response');
  if (j.encoding === 'none' || typeof j.content !== 'string' || j.content === '') {
    throw new Error(`GitHub returned no inline content (file > ${MAX_CONTENTS_API} bytes?) — reduce the store size`);
  }
  const text = new TextDecoder().decode(base64.decode(j.content.replace(/\s+/g, '')));
  return { text, sha: String(j.sha ?? ''), size: typeof j.size === 'number' ? j.size : text.length };
}
