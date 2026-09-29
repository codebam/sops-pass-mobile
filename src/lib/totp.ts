/**
 * TOTP (RFC 6238) for otpauth:// URIs found in password entries — parity with
 * `pass otp` (pyotp defaults: SHA-1, 6 digits, 30 s).
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { base32 } from '@scure/base';

export interface OtpauthParams {
  secret: string;
  digits: number;
  period: number;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  label: string;
  issuer?: string;
}

export interface TotpResult {
  code: string;
  secondsRemaining: number;
  period: number;
  digits: number;
}

/** Find the first otpauth:// line in a (multi-line) password entry value. */
export function findOtpauthUri(value: string): string | null {
  for (const line of value.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('otpauth://')) return t;
  }
  return null;
}

/** Parse an otpauth://totp/... URI (manual parsing — URL is unreliable in Hermes). */
export function parseOtpauth(uri: string): OtpauthParams | null {
  const m = /^otpauth:\/\/(totp|hotp)\/([^?]*)\??(.*)$/i.exec(uri.trim());
  if (!m) return null;
  if (m[1].toLowerCase() !== 'totp') return null;
  const label = decodeURIComponent(m[2] || '');
  const params = new Map<string, string>();
  for (const pair of m[3].split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    params.set(pair.slice(0, eq).toLowerCase(), decodeURIComponent(pair.slice(eq + 1)));
  }
  const secret = (params.get('secret') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!secret) return null;
  const digitsRaw = parseInt(params.get('digits') ?? '6', 10);
  const periodRaw = parseInt(params.get('period') ?? '30', 10);
  const algRaw = (params.get('algorithm') ?? 'SHA1').toUpperCase();
  const algorithm = algRaw === 'SHA256' || algRaw === 'SHA512' ? algRaw : 'SHA1';
  const issuer = params.get('issuer') ?? undefined;
  const display = issuer && label.includes(':') ? label.split(':').slice(1).join(':').trim() || label : label;
  return {
    secret,
    digits: Number.isFinite(digitsRaw) && digitsRaw >= 6 && digitsRaw <= 10 ? digitsRaw : 6,
    period: Number.isFinite(periodRaw) && periodRaw > 0 ? periodRaw : 30,
    algorithm,
    label: display,
    issuer,
  };
}

function base32Decode(secret: string): Uint8Array {
  const clean = secret.replace(/=+$/, '');
  const padded = clean + '='.repeat((8 - (clean.length % 8)) % 8);
  return base32.decode(padded);
}

export function hotp(key: Uint8Array, counter: number, digits: number, algorithm: OtpauthParams['algorithm']): string {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hashFn = algorithm === 'SHA256' ? sha256 : algorithm === 'SHA512' ? sha512 : sha1;
  const mac = hmac(hashFn, key, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) * 2 ** 24) + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, '0');
}

export function totp(params: OtpauthParams, nowMs: number = Date.now()): TotpResult {
  const key = base32Decode(params.secret);
  const step = Math.floor(nowMs / 1000 / params.period);
  const code = hotp(key, step, params.digits, params.algorithm);
  const secondsRemaining = params.period - (Math.floor(nowMs / 1000) % params.period);
  return { code, secondsRemaining, period: params.period, digits: params.digits };
}
