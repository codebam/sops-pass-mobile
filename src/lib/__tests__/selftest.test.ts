import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recipientForIdentity } from '../age';
import { deviceKeySelfTest, SELF_TEST_RECIPIENT } from '../selftest';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures');

function readIdentity(path: string): string {
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1'));
  if (!line) throw new Error(`no age identity in ${path} — run \`npm run fixtures\``);
  return line;
}

describe('device-key self-test', () => {
  it('targets a well-formed age X25519 recipient', () => {
    expect(SELF_TEST_RECIPIENT).toMatch(/^age1[0-9a-z]{58}$/);
  });

  it('with a valid non-matching key: fails AFTER parsing the challenge, names the derived recipient', async () => {
    const res = await deviceKeySelfTest(readIdentity(join(FIX, 'testkey-b.txt')));
    expect(res.ok).toBe(false);
    expect(res.derivedRecipient).toBe(await recipientForIdentity(readIdentity(join(FIX, 'testkey-b.txt'))));
    expect(res.derivedRecipient).not.toBe(SELF_TEST_RECIPIENT);
    // 'could not decrypt' (not the 'would not even parse' branch) proves armor decoding worked.
    expect(res.message).toContain('could not decrypt');
    expect(res.message).toContain('does NOT match');
  });

  it('rejects a malformed identity loudly', async () => {
    await expect(deviceKeySelfTest('AGE-SECRET-KEY-1NOTVALID')).rejects.toThrow(/identity/i);
  });
});
