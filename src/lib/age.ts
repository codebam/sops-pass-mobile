/**
 * On-device age (X25519) key generation and identity helpers.
 *
 * The private identity string (AGE-SECRET-KEY-1...) never leaves the device;
 * only the corresponding public recipient (age1...) is shared so files can be
 * encrypted to this device.
 */
import * as age from 'age-encryption';

export interface AgeKeyPair {
  /** AGE-SECRET-KEY-1... — secret, kept in secure storage. */
  identity: string;
  /** age1... — public recipient shared with sops (.sops.yaml + `sops updatekeys`). */
  recipient: string;
}

/** Generate a fresh age X25519 identity on-device. */
export async function generateAgeKeyPair(): Promise<AgeKeyPair> {
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  return { identity, recipient };
}

/** Derive the public recipient for an identity string (throws on malformed input). */
export async function recipientForIdentity(identity: string): Promise<string> {
  return age.identityToRecipient(identity.trim());
}

export function looksLikeAgeIdentity(s: string): boolean {
  return /^\s*AGE-SECRET-KEY-1[0-9A-Z]{50,64}\s*$/.test(s);
}

export function looksLikeAgeRecipient(s: string): boolean {
  return /^\s*age1[0-9a-z]{50,64}\s*$/.test(s);
}
