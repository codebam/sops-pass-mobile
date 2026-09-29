import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateAgeKeyPair, looksLikeAgeIdentity, looksLikeAgeRecipient, recipientForIdentity } from '../age';

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

describe('on-device age keys', () => {
  it('generates a valid identity/recipient pair', async () => {
    const kp = await generateAgeKeyPair();
    expect(looksLikeAgeIdentity(kp.identity)).toBe(true);
    expect(looksLikeAgeRecipient(kp.recipient)).toBe(true);
    expect(await recipientForIdentity(kp.identity)).toBe(kp.recipient);
  });

  it('generates a fresh pair each time', async () => {
    const a = await generateAgeKeyPair();
    const b = await generateAgeKeyPair();
    expect(a.identity).not.toBe(b.identity);
    expect(a.recipient).not.toBe(b.recipient);
  });

  it('derives the exact recipients age-keygen published for the fixture keys', async () => {
    // Cross-check our pure-JS derivation against the real CLI's output: the
    // .pub files were produced by `age-keygen -y` in scripts/make-fixtures.sh.
    for (const name of ['a', 'b']) {
      const id = readIdentity(join(FIX, `testkey-${name}.txt`));
      const pub = readFileSync(join(FIX, `testkey-${name}.pub`), 'utf8').trim();
      expect(await recipientForIdentity(id)).toBe(pub);
    }
  });

  it('rejects malformed identity strings', async () => {
    await expect(recipientForIdentity('AGE-SECRET-KEY-1NOTAREALKEY')).rejects.toThrow();
    await expect(recipientForIdentity('hello world')).rejects.toThrow();
  });

  it('rejects a recipient used as an identity', async () => {
    const kp = await generateAgeKeyPair();
    await expect(recipientForIdentity(kp.recipient)).rejects.toThrow();
  });
});
