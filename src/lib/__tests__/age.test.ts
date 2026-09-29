import { describe, expect, it } from 'vitest';
import { generateAgeKeyPair, looksLikeAgeIdentity, looksLikeAgeRecipient, recipientForIdentity } from '../age';

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

  it('rejects malformed identity strings', async () => {
    await expect(recipientForIdentity('AGE-SECRET-KEY-1NOTAREALKEY')).rejects.toThrow();
    await expect(recipientForIdentity('hello world')).rejects.toThrow();
  });

  it('rejects a recipient used as an identity', async () => {
    const kp = await generateAgeKeyPair();
    await expect(recipientForIdentity(kp.recipient)).rejects.toThrow();
  });
});
