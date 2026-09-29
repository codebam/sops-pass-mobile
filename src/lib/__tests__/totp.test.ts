import { describe, expect, it } from 'vitest';
import { findOtpauthUri, hotp, parseOtpauth, totp } from '../totp';
import { base32 } from '@scure/base';

// RFC 6238 Appendix B vectors.
const SECRET_SHA1_B32 = base32.encode(new TextEncoder().encode('12345678901234567890'));
const SECRET_SHA256_B32 = base32.encode(new TextEncoder().encode('12345678901234567890123456789012'));

describe('TOTP', () => {
  it('matches RFC 6238 SHA-1 vectors (8 digits)', () => {
    const cases: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code] of cases) {
      const r = totp({ secret: SECRET_SHA1_B32, digits: 8, period: 30, algorithm: 'SHA1', label: '' }, t * 1000);
      expect(r.code).toBe(code);
    }
  });

  it('matches the RFC 6238 SHA-256 vector', () => {
    const r = totp({ secret: SECRET_SHA256_B32, digits: 8, period: 30, algorithm: 'SHA256', label: '' }, 59_000);
    expect(r.code).toBe('46119246');
  });

  it('defaults to pyotp-compatible 6-digit codes (pass otp parity)', () => {
    const r = totp({ secret: SECRET_SHA1_B32, digits: 6, period: 30, algorithm: 'SHA1', label: '' }, 59_000);
    expect(r.code).toBe('287082');
  });

  it('computes seconds remaining for the countdown', () => {
    const r = totp({ secret: SECRET_SHA1_B32, digits: 6, period: 30, algorithm: 'SHA1', label: '' }, 59_500);
    expect(r.secondsRemaining).toBe(1);
    const r2 = totp({ secret: SECRET_SHA1_B32, digits: 6, period: 30, algorithm: 'SHA1', label: '' }, 60_000);
    expect(r2.secondsRemaining).toBe(30);
  });

  it('hotp counter uses big-endian 8-byte counter', () => {
    const key = new TextEncoder().encode('12345678901234567890');
    expect(hotp(key, 1, 6, 'SHA1')).toBe('287082');
  });

  it('parses otpauth URIs like the ones stored by pass', () => {
    const uri = 'otpauth://totp/Acme:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme&period=60&digits=8';
    const p = parseOtpauth(uri);
    expect(p).not.toBeNull();
    expect(p!.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(p!.digits).toBe(8);
    expect(p!.period).toBe(60);
    expect(p!.algorithm).toBe('SHA1');
    expect(p!.issuer).toBe('Acme');
    expect(p!.label).toBe('alice@example.com');
  });

  it('handles defaults and rejects non-totp URIs', () => {
    const p = parseOtpauth('otpauth://totp/example?secret=jbswy3dpehpk3pxp');
    expect(p!.secret).toBe('JBSWY3DPEHPK3PXP'); // uppercased
    expect(p!.digits).toBe(6);
    expect(p!.period).toBe(30);
    expect(parseOtpauth('https://example.com')).toBeNull();
    expect(parseOtpauth('otpauth://hotp/example?secret=AAAA')).toBeNull();
  });

  it('finds the otpauth line inside multiline entries and ignores others', () => {
    const value = 'username: alice\npassword: hunter2\notpauth://totp/X:y?secret=JBSWY3DPEHPK3PXP\n';
    expect(findOtpauthUri(value)).toBe('otpauth://totp/X:y?secret=JBSWY3DPEHPK3PXP');
    expect(findOtpauthUri('no otp here')).toBeNull();
  });
});
