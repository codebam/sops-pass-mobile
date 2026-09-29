/**
 * On-device age (X25519) key handling — pure JS (@noble/@scure), no WebCrypto.
 *
 * Why not use age-encryption's built-in helpers? Its X25519 routines prefer
 * `crypto.subtle` and only fall back to @noble when that throws a ReferenceError
 * or NotSupportedError. Expo Go's Hermes engine provides a `crypto` global
 * (getRandomValues) but *no* `crypto.subtle`, so `.importKey` access throws a
 * plain TypeError that the fallback does not catch. We therefore do the X25519
 * math ourselves: keygen + recipient derivation with @noble, and a custom
 * `Identity` object (age-encryption's documented extension point) used by the
 * Decrypter for stanza unwrapping.
 *
 * The private identity string (AGE-SECRET-KEY-1...) never leaves the device;
 * only the corresponding public recipient (age1...) is shared with sops.
 */
import { bech32, base64nopad } from '@scure/base';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { Identity, Stanza } from 'age-encryption';

export interface AgeKeyPair {
  /** AGE-SECRET-KEY-1... — secret, kept in secure storage. */
  identity: string;
  /** age1... — public recipient shared with sops (.sops.yaml + `sops updatekeys`). */
  recipient: string;
}

const X25519_LABEL = /* @__PURE__ */ (() => new TextEncoder().encode('age-encryption.org/v1/X25519'))();

/** Decode an `AGE-SECRET-KEY-1...` string to its 32-byte X25519 scalar. */
function decodeIdentity(raw: string): Uint8Array {
  const trimmed = raw.trim();
  let res: { prefix: string; bytes: Uint8Array };
  try {
    res = bech32.decodeToBytes(trimmed);
  } catch {
    throw new Error('invalid age identity (expected AGE-SECRET-KEY-1...)');
  }
  if (
    !trimmed.toUpperCase().startsWith('AGE-SECRET-KEY-1') ||
    res.prefix.toUpperCase() !== 'AGE-SECRET-KEY-' ||
    res.bytes.length !== 32
  ) {
    throw new Error('invalid age identity (expected AGE-SECRET-KEY-1...)');
  }
  return Uint8Array.from(res.bytes);
}

/** Generate a fresh age X25519 identity on-device. */
export async function generateAgeKeyPair(): Promise<AgeKeyPair> {
  const scalar = randomBytes(32);
  return {
    identity: bech32.encodeFromBytes('AGE-SECRET-KEY-', scalar).toUpperCase(),
    recipient: bech32.encodeFromBytes('age', x25519.scalarMultBase(scalar)),
  };
}

/** Derive the public recipient for an identity string (throws on malformed input). */
export async function recipientForIdentity(identity: string): Promise<string> {
  const scalar = decodeIdentity(identity);
  return bech32.encodeFromBytes('age', x25519.scalarMultBase(scalar));
}

export function looksLikeAgeIdentity(s: string): boolean {
  return /^\s*AGE-SECRET-KEY-1[0-9A-Z]{50,64}\s*$/.test(s);
}

export function looksLikeAgeRecipient(s: string): boolean {
  return /^\s*age1[0-9a-z]{50,64}\s*$/.test(s);
}

/**
 * A custom age `Identity` whose X25519 stanza unwrap is pure JS — identical
 * semantics to age-encryption's built-in X25519Identity, minus WebCrypto.
 */
export function makeAgeIdentity(rawIdentity: string): Identity {
  const scalar = decodeIdentity(rawIdentity);
  const recipient = x25519.scalarMultBase(scalar);
  return {
    unwrapFileKey(stanzas: Stanza[]): Uint8Array | null {
      for (const s of stanzas) {
        if (s.args.length < 1 || s.args[0] !== 'X25519') continue;
        if (s.args.length !== 2) throw new Error('invalid X25519 stanza');
        const share = base64nopad.decode(s.args[1]);
        if (share.length !== 32) throw new Error('invalid X25519 stanza');
        if (s.body.length !== 32) throw new Error('invalid stanza');
        const secret = x25519.scalarMult(scalar, share);
        const salt = new Uint8Array(64);
        salt.set(share, 0);
        salt.set(recipient, 32);
        const key = hkdf(sha256, secret, salt, X25519_LABEL, 32);
        try {
          return chacha20poly1305(key, new Uint8Array(12)).decrypt(s.body);
        } catch {
          /* not our stanza (different recipient) — try the next one */
        }
      }
      return null;
    },
  };
}
