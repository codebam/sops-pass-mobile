/**
 * Expo Go / Hermes simulation: run the full crypto path with a `crypto` global
 * that has `getRandomValues` but NO `crypto.subtle` — exactly what Hermes gives
 * us. This is the regression test for the "Cannot read property 'importKey' of
 * undefined" crash: no code we depend on may touch WebCrypto.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { decryptSopsYaml, NoMatchingIdentityError } from '../sops';
import { generateAgeKeyPair, recipientForIdentity } from '../age';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures');
const realCrypto = globalThis.crypto;
const realGetRandomValues = realCrypto.getRandomValues.bind(realCrypto);

function readIdentity(path: string): string {
  const txt = readFileSync(path, 'utf8');
  const line = txt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1'));
  if (!line) throw new Error(`no age identity in ${path} — run \`npm run fixtures\``);
  return line;
}

describe('no-WebCrypto environment (Expo Go / Hermes)', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', { getRandomValues: realGetRandomValues });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('has no crypto.subtle in this environment', () => {
    expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined();
  });

  it('generates keys and derives recipients', async () => {
    const kp = await generateAgeKeyPair();
    expect(await recipientForIdentity(kp.identity)).toBe(kp.recipient);
  });

  it('fully decrypts the multi-recipient fixture like `sops -d`', async () => {
    const enc = readFileSync(join(FIX, 'encrypted.yaml'), 'utf8');
    const expected = parseYaml(readFileSync(join(FIX, 'expected.yaml'), 'utf8')) as Record<string, unknown>;
    const idB = readIdentity(join(FIX, 'testkey-b.txt'));

    const res = await decryptSopsYaml(enc, idB);
    expect(res.data).toEqual(expected);
    expect(res.macVerified).toBe(true);
  });

  it('fails cleanly (no subtle TypeError) when the device key is not a recipient', async () => {
    const enc = readFileSync(join(FIX, 'encrypted.yaml'), 'utf8');
    const stranger = await generateAgeKeyPair();
    let err: unknown = null;
    try {
      await decryptSopsYaml(enc, stranger.identity);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NoMatchingIdentityError);
  });
});
