import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  decryptSopsYaml,
  MAC_ONLY_ENCRYPTED_INIT,
  NoMatchingIdentityError,
  SopsError,
  normalizeRfc3339,
} from '../sops';
import { generateAgeKeyPair, recipientForIdentity } from '../age';
import { flattenVault } from '../types';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures');

function readIdentity(path: string): string {
  const txt = readFileSync(path, 'utf8');
  const line = txt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1'));
  if (!line) throw new Error(`no age identity in ${path} — run \`npm run fixtures\``);
  return line;
}

const ID_A = readIdentity(join(FIX, 'testkey-a.txt'));
const ID_B = readIdentity(join(FIX, 'testkey-b.txt'));
const ENC = readFileSync(join(FIX, 'encrypted.yaml'), 'utf8');
const EXPECTED = parseYaml(readFileSync(join(FIX, 'expected.yaml'), 'utf8')) as Record<string, unknown>;

describe('sops v3 decryptor', () => {
  it('decrypts the multi-recipient fixture exactly like `sops -d` (using the second key)', async () => {
    const res = await decryptSopsYaml(ENC, ID_B);
    expect(res.data).toEqual(EXPECTED);
    expect(res.macVerified).toBe(true);
  });

  it('decrypts with the first key too (same file, multiple stanzas)', async () => {
    const res = await decryptSopsYaml(ENC, ID_A);
    expect(res.data).toEqual(EXPECTED);
  });

  it('handles unicode, multiline, numeric, boolean and empty values', async () => {
    const { data } = await decryptSopsYaml(ENC, ID_B);
    expect((data.unicode as any).emoji).toBe('🔐🗝️☂️');
    expect((data.unicode as any).rtl).toBe('كلمة المرور');
    expect((data.unicode as any).accents).toBe('café naïve ñoño');
    expect(data.multiline).toBe('line one\nline two\n');
    expect(data.number_int).toBe(42);
    expect(data.number_float).toBeCloseTo(3.14);
    expect(data.bool_true).toBe(true);
    expect(data.empty).toBe('');
    expect((data.nested as any)['service.com']['alice@example.com']).toBe('p@ss:with,special[chars] # and hash');
  });

  it('passes through values excluded by unencrypted_suffix', async () => {
    const { data } = await decryptSopsYaml(ENC, ID_B);
    expect(data.suffixed_unencrypted).toBe('plaintext-value');
  });

  it('verifies the mac_only_encrypted variant', async () => {
    const enc = readFileSync(join(FIX, 'maconly/encrypted.yaml'), 'utf8');
    const expected = parseYaml(readFileSync(join(FIX, 'maconly/expected.yaml'), 'utf8')) as Record<string, unknown>;
    const res = await decryptSopsYaml(enc, ID_A);
    expect(res.data).toEqual(expected);
    expect(res.macVerified).toBe(true);
    expect(res.metadata.mac_only_encrypted).toBe(true);
  });

  it('MAC init constant equals sha256("sops")', () => {
    const digest = sha256(new TextEncoder().encode('sops'));
    expect(Array.from(digest)).toEqual(Array.from(MAC_ONLY_ENCRYPTED_INIT));
  });

  it('rejects a tampered ciphertext (GCM/MAC must fail)', async () => {
    const tampered = ENC.replace(/simple: ENC\[AES256_GCM,data:([A-Za-z0-9+/])/, (_m, c: string) => {
      const flipped = c === 'A' ? 'B' : 'A';
      return `simple: ENC[AES256_GCM,data:${flipped}`;
    });
    expect(tampered).not.toBe(ENC);
    let err: unknown = null;
    try {
      await decryptSopsYaml(tampered, ID_B);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SopsError);
  });

  it('fails cleanly with an identity that is not a recipient', async () => {
    const kp = await generateAgeKeyPair();
    let err: unknown = null;
    try {
      await decryptSopsYaml(ENC, kp.identity);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NoMatchingIdentityError);
  });

  it('derives the same recipient age-keygen reports', async () => {
    const pub = readFileSync(join(FIX, 'testkey-a.pub'), 'utf8').trim();
    expect(await recipientForIdentity(ID_A)).toBe(pub);
  });

  it('rejects non-sops input', async () => {
    let err: unknown = null;
    try {
      await decryptSopsYaml('hello: world\n', ID_A);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SopsError);
    expect(String((err as Error).message)).toContain('sops metadata not found');
  });

  it('normalizes timestamps the way Go formats RFC3339', () => {
    expect(normalizeRfc3339('2026-09-29T01:10:28Z')).toBe('2026-09-29T01:10:28Z');
    expect(normalizeRfc3339('2026-09-29T01:10:28.123Z')).toBe('2026-09-29T01:10:28Z');
    expect(normalizeRfc3339('2026-09-29T01:10:28+00:00')).toBe('2026-09-29T01:10:28Z');
    expect(normalizeRfc3339('2026-09-29T01:10:28-04:00')).toBe('2026-09-29T01:10:28-04:00');
  });

  it('flattens into pass-style paths', async () => {
    const { data } = await decryptSopsYaml(ENC, ID_B);
    const entries = flattenVault(data);
    const otp = entries.find((e) => e.path === 'otp-sample/work');
    expect(otp).toBeDefined();
    expect(otp!.value).toContain('otpauth://');
    expect(entries.map((e) => e.path)).toContain('nested/service.com/alice@example.com');
  });
});
