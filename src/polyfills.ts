/**
 * Hermes has no WebCrypto; age-encryption / noble ask globalThis.crypto.getRandomValues
 * for randomness (key generation). expo-crypto provides a secure, Keystore-backed
 * implementation — install it into the global before anything else loads.
 *
 * TextEncoder/TextDecoder are native in Hermes ≥ RN 0.85 (encoder since 0.74), but a
 * guarded pure-JS fallback is installed for older engines that lack them.
 */
import { getRandomValues } from 'expo-crypto';
import { installTextCodecFallback } from './lib/utf8';

type CryptoLike = {
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

const g = globalThis as unknown as { crypto?: CryptoLike };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues as unknown as CryptoLike['getRandomValues'];
}

installTextCodecFallback();

export {};
