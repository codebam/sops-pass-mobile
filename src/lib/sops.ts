/**
 * Pure-TypeScript SOPS (v3, YAML store, AES256_GCM + age) decryption.
 *
 * Ported faithfully from getsops/sops v3.13.3:
 *   - aes/cipher.go          (ENC[...] value format, AES-256-GCM, variable nonce size)
 *   - sops.go                (Tree.Decrypt walk, MAC = SHA-512 over plaintext leaf values)
 *   - decrypt/decrypt.go     (MAC verification: stored MAC AES-GCM'd with AAD = RFC3339 lastmodified)
 *   - stores/*, age source   (metadata shape: sops.age[] / sops.key_groups[] with armored age data keys)
 *
 * Runs in Expo Go / Hermes: only @noble + @scure + `yaml` — no WebCrypto, no native modules.
 * Decryption-only: no randomness is consumed on this path.
 */
import * as age from 'age-encryption';
import { gcm } from '@noble/ciphers/aes.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { parse as parseYaml } from 'yaml';
import { makeAgeIdentity, recipientForIdentity } from './age';
import { utf8Decode, utf8Encode } from './utf8';

export class SopsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** The file's sops metadata does not contain a stanza that this identity can unwrap. */
export class NoMatchingIdentityError extends SopsError {}
/** GCM-authenticated values or the file MAC failed verification (tampering/corruption). */
export class SopsIntegrityError extends SopsError {}
/** The input is not a well-formed sops document this decryptor understands. */
export class SopsFormatError extends SopsError {}

/** sops' "mac_only_encrypted" MAC initialization: sha256("sops"). Asserted in tests. */
export const MAC_ONLY_ENCRYPTED_INIT = new Uint8Array([
  0x8a, 0x3f, 0xd2, 0xad, 0x54, 0xce, 0x66, 0x52, 0x7b, 0x10, 0x34, 0xf3, 0xd1, 0x47, 0xbe, 0x0b, 0x0b, 0x97, 0x5b,
  0x3b, 0xf4, 0x4f, 0x72, 0xc6, 0xfd, 0xad, 0xec, 0x81, 0x76, 0xf2, 0x7d, 0x69,
]);

// Same regex as sops aes/cipher.go: ^ENC\[AES256\_GCM,data:(.+),iv:(.+),tag:(.+),type:(.+)\]
const ENC_RE = /^ENC\[AES256_GCM,data:(.+),iv:(.+),tag:(.+),type:(.+)\]$/;

export interface SopsAgeStanza {
  recipient?: string;
  enc: string;
}
export interface SopsMetadata {
  lastmodified?: unknown;
  mac?: unknown;
  mac_only_encrypted?: unknown;
  unencrypted_suffix?: unknown;
  encrypted_suffix?: unknown;
  unencrypted_regex?: unknown;
  encrypted_regex?: unknown;
  version?: unknown;
  age?: SopsAgeStanza[];
  key_groups?: Array<{ age?: SopsAgeStanza[] }>;
  shamir_threshold?: unknown;
  [key: string]: unknown;
}

export interface DecryptedSops {
  /** The decrypted data tree (top-level `sops` metadata key removed). */
  data: Record<string, unknown>;
  metadata: SopsMetadata;
  /** Present when the file stored a MAC and it verified (always, unless absent). */
  macVerified: boolean;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function utf8(s: string): Uint8Array {
  return utf8Encode(s);
}
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function hexUpper(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0').toUpperCase();
  return s;
}

/** Deep-convert yaml Maps/arrays into plain JS for UI consumption. Byte arrays pass through. */
export function toPlain(v: unknown): unknown {
  if (v instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of v) o[String(k)] = toPlain(val);
    return o;
  }
  if (Array.isArray(v)) return v.map(toPlain);
  return v;
}

// ---------------------------------------------------------------------------
// sops value decryption (aes/cipher.go)
// ---------------------------------------------------------------------------

/**
 * Decrypt one sops-format value (`ENC[AES256_GCM,...]`) or an empty string.
 * `additionalData` is the sops AAD: the ":"-joined key path with a trailing ":".
 */
export function decryptValue(ciphertext: string, key: Uint8Array, additionalData: string): unknown {
  if (ciphertext === '') return ''; // sops' isEmpty() path
  const m = ENC_RE.exec(ciphertext);
  if (!m) {
    throw new SopsFormatError(`value does not match sops' data format: ${ciphertext.slice(0, 24)}...`);
  }
  const data = base64.decode(m[1]);
  const iv = base64.decode(m[2]);
  const tag = base64.decode(m[3]);
  const datatype = m[4];
  let decryptedBytes: Uint8Array;
  try {
    decryptedBytes = gcm(key, iv, utf8(additionalData)).decrypt(concatBytes(data, tag));
  } catch {
    throw new SopsIntegrityError(`could not decrypt with AES_GCM (${datatype} value, tag mismatch)`);
  }
  switch (datatype) {
    case 'str':
      return utf8Decode(decryptedBytes);
    case 'bytes':
      return decryptedBytes;
    case 'int':
      return parseInt(utf8Decode(decryptedBytes), 10);
    case 'float':
      return parseFloat(utf8Decode(decryptedBytes));
    case 'bool': {
      // Go strconv.ParseBool accepts these
      const s = utf8Decode(decryptedBytes);
      if (['1', 't', 'T', 'TRUE', 'true', 'True'].includes(s)) return true;
      if (['0', 'f', 'F', 'FALSE', 'false', 'False'].includes(s)) return false;
      throw new SopsFormatError(`invalid bool value: ${s}`);
    }
    case 'time':
      return utf8Decode(decryptedBytes);
    case 'comment':
      return utf8Decode(decryptedBytes);
    default:
      throw new SopsFormatError(`unknown datatype: ${datatype}`);
  }
}

// ---------------------------------------------------------------------------
// MAC (sops.go: Tree.Decrypt hash walk)
// ---------------------------------------------------------------------------

function metaStr(meta: SopsMetadata, field: keyof SopsMetadata): string {
  const v = meta[field];
  return typeof v === 'string' ? v : '';
}

/** sops shouldBeEncrypted() — suffix/regex rules from metadata (subset needed for a store file). */
export function shouldBeEncrypted(path: string[], meta: SopsMetadata): boolean {
  let encrypted = true;
  const unencSuffix = metaStr(meta, 'unencrypted_suffix');
  const encSuffix = metaStr(meta, 'encrypted_suffix');
  const unencRegex = metaStr(meta, 'unencrypted_regex');
  const encRegex = metaStr(meta, 'encrypted_regex');
  if (unencSuffix) {
    for (const v of path) {
      if (v.endsWith(unencSuffix)) {
        encrypted = false;
        break;
      }
    }
  }
  if (encSuffix) {
    encrypted = false;
    for (const v of path) {
      if (v.endsWith(encSuffix)) {
        encrypted = true;
        break;
      }
    }
  }
  if (unencRegex) {
    for (const p of path) {
      if (safeMatch(unencRegex, p)) {
        encrypted = false;
        break;
      }
    }
  }
  if (encRegex) {
    encrypted = false;
    for (const p of path) {
      if (safeMatch(encRegex, p)) {
        encrypted = true;
        break;
      }
    }
  }
  return encrypted;
}

function safeMatch(pattern: string, s: string): boolean {
  try {
    return new RegExp(pattern).test(s);
  } catch {
    return false;
  }
}

/** sops sops.go ToBytes(): value -> bytes fed into the MAC hash. */
export function toMacBytes(v: unknown): Uint8Array {
  if (typeof v === 'string') return utf8(v);
  if (typeof v === 'number') {
    // Go: int -> Itoa; float64 -> FormatFloat('f', -1, 64). Number.isInteger covers the int case.
    return utf8(String(v));
  }
  if (typeof v === 'boolean') return utf8(v ? 'True' : 'False');
  if (v instanceof Uint8Array) return v;
  throw new SopsFormatError(`cannot convert ${typeof v} to MAC bytes`);
}

/**
 * Normalize a sops `lastmodified` string the way Go does:
 * time.Parse(...).Format(time.RFC3339) — fractional seconds dropped, +00:00 rendered as Z.
 */
export function normalizeRfc3339(s: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
  if (!m) return s;
  let off = m[3] ?? 'Z';
  if (off === '+00:00' || off === '-00:00') off = 'Z';
  return m[1] + off;
}

interface WalkCtx {
  dataKey: Uint8Array;
  meta: SopsMetadata;
  macHash: ReturnType<typeof sha512.create>;
  macOnlyEncrypted: boolean;
}

function walkValue(v: unknown, path: string[], ctx: WalkCtx): unknown {
  if (v instanceof Map) {
    const out = new Map<unknown, unknown>();
    for (const [k, val] of v) out.set(k, walkValue(val, [...path, String(k)], ctx));
    return out;
  }
  if (Array.isArray(v)) {
    // sops walkSlice does NOT append the index to the path.
    return v.map((el) => walkValue(el, path, ctx));
  }
  if (v === null || v === undefined) {
    // sops: nil values are neither encrypted nor included in the MAC.
    return null;
  }

  const encrypted = shouldBeEncrypted(path, ctx.meta);
  let out: unknown = v;
  if (encrypted) {
    if (typeof v !== 'string') {
      throw new SopsFormatError(`expected encrypted value as string, but got ${typeof v} at ${path.join('/')}`);
    }
    const pathString = path.join(':') + ':';
    out = decryptValue(v, ctx.dataKey, pathString);
  }
  if (!ctx.macOnlyEncrypted || encrypted) {
    ctx.macHash.update(toMacBytes(out));
  }
  return out;
}

// ---------------------------------------------------------------------------
// age data-key unwrap
// ---------------------------------------------------------------------------

function stanzasFromMetadata(meta: SopsMetadata): SopsAgeStanza[] {
  if (Array.isArray(meta.age) && meta.age.length > 0) return meta.age;
  const groups = meta.key_groups;
  if (Array.isArray(groups) && groups.length > 0) {
    if (groups.length > 1) {
      throw new SopsFormatError('multiple sops key groups (Shamir secret sharing) are not supported by this app');
    }
    const g = groups[0];
    if (g && Array.isArray(g.age) && g.age.length > 0) return g.age;
  }
  return [];
}

/** Unwrap the 32-byte sops data key from the metadata's age stanzas using `identity`. */
export async function unwrapDataKey(meta: SopsMetadata, identity: string): Promise<Uint8Array> {
  const stanzas = stanzasFromMetadata(meta);
  if (stanzas.length === 0) {
    throw new SopsFormatError('no age recipients found in sops metadata (pgp/kms-only files are not supported)');
  }
  const recipient = await recipientForIdentity(identity);
  // Try our own stanza first (matching recipient), then any other (covers stanza order oddities).
  const ordered = [...stanzas].sort((a, b) => Number(b.recipient === recipient) - Number(a.recipient === recipient));
  let lastErr: unknown = null;
  for (const st of ordered) {
    if (typeof st.enc !== 'string' || st.enc.length === 0) continue;
    try {
      const d = new age.Decrypter();
      d.addIdentity(makeAgeIdentity(identity));
      const blob = age.armor.decode(st.enc);
      const key = await d.decrypt(blob);
      if (key.length !== 32) {
        throw new SopsFormatError(`unexpected data key length ${key.length} (expected 32)`);
      }
      return key;
    } catch (e) {
      lastErr = e;
    }
  }
  const fileRecipients = stanzas.map((s) => s.recipient).filter((r): r is string => typeof r === 'string' && r.length > 0);
  throw new NoMatchingIdentityError(
    `this device's recipient is ${recipient}. This file's recipients are: ${fileRecipients.join(', ')}. ` +
      `If the device key was re-generated, add the current recipient (Settings → Device key) to .sops.yaml ` +
      `and run \`sops updatekeys\`; (last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
  );
}

// ---------------------------------------------------------------------------
// full document decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt a sops YAML document (the whole encrypted file contents) with an age identity string.
 * Verifies the sops MAC; throws SopsIntegrityError on mismatch.
 */
export async function decryptSopsYaml(encryptedText: string, identity: string): Promise<DecryptedSops> {
  const doc = parseYaml(encryptedText, { mapAsMap: true });
  if (!(doc instanceof Map)) throw new SopsFormatError('expected a YAML mapping at the document root');
  const rawMeta = doc.get('sops');
  if (!(rawMeta instanceof Map)) throw new SopsFormatError('sops metadata not found in file');
  const metadata = toPlain(rawMeta) as SopsMetadata;

  let dataKey: Uint8Array;
  try {
    dataKey = await unwrapDataKey(metadata, identity);
  } catch (e) {
    if (e instanceof NoMatchingIdentityError) {
      const fp = bytesToHex(sha256(utf8Encode(encryptedText))).slice(0, 32);
      throw new NoMatchingIdentityError(`${e.message} [fetched ${encryptedText.length} chars, sha256 ${fp}]`);
    }
    throw e;
  }

  const ctx: WalkCtx = {
    dataKey,
    meta: metadata,
    macHash: sha512.create(),
    macOnlyEncrypted: metadata.mac_only_encrypted === true,
  };
  if (ctx.macOnlyEncrypted) ctx.macHash.update(MAC_ONLY_ENCRYPTED_INIT);

  const decrypted = new Map<unknown, unknown>();
  for (const [k, v] of doc) {
    if (k === 'sops') continue;
    decrypted.set(k, walkValue(v, [String(k)], ctx));
  }

  let macVerified = false;
  const storedMac = metadata.mac;
  if (typeof storedMac === 'string' && storedMac.length > 0) {
    const computed = hexUpper(ctx.macHash.digest());
    const aad = normalizeRfc3339(typeof metadata.lastmodified === 'string' ? metadata.lastmodified : '');
    let original: unknown;
    try {
      original = decryptValue(storedMac, dataKey, aad);
    } catch (e) {
      throw new SopsIntegrityError(
        `stored MAC could not be read (file may be tampered with or corrupted): ${e instanceof Error ? e.message : e}`,
      );
    }
    if (typeof original !== 'string' || original.toUpperCase() !== computed) {
      throw new SopsIntegrityError('MAC mismatch — the file was modified after it was encrypted');
    }
    macVerified = true;
  }

  return { data: toPlain(decrypted) as Record<string, unknown>, metadata, macVerified };
}
