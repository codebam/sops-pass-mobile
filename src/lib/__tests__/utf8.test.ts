import { describe, expect, it } from 'vitest';
import { installTextCodecFallback, utf8Decode, utf8Encode } from '../utf8';

// Native implementations are the oracle: our codec must agree byte-for-byte.
const nativeEncode = (s: string) => new TextEncoder().encode(s);
const nativeDecode = (b: Uint8Array) => new TextDecoder().decode(b);

const CORPUS = [
  '',
  'hunter2',
  'p@ss:with,special[chars] # and hash',
  'café naïve ñoño',
  'كلمة المرور',
  '🔐🗝️☂️',
  'Zażółć gęślą jaźń',
  '日本語のテキスト',
  '🙂‍↔️ emoji zwj',
  'mixed ascii + émoji 🌍 + عربي',
  '\u0000\u007f\u0080\u07ff\u0800\uffff',
  'a'.repeat(10000),
];

describe('utf8 codec', () => {
  it('encodes identically to the native TextEncoder', () => {
    for (const s of CORPUS) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(nativeEncode(s)));
    }
  });

  it('decodes identically to the native TextDecoder for valid UTF-8', () => {
    for (const s of CORPUS) {
      expect(utf8Decode(nativeEncode(s))).toBe(s);
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('matches the native decoder on malformed input (maximal-subpart semantics)', () => {
    const vectors: number[][] = [
      [0xff],
      [0xc0, 0xaf], // overlong
      [0xed, 0xa0, 0x80], // surrogate
      [0x61, 0xe2, 0x82], // valid byte + truncated 3-byte tail
      [0xe2, 0x28], // bad continuation
      [0xe0, 0x80], // first-continuation out of range for E0
      [0xf0, 0x90, 0x80], // truncated 4-byte sequence
      [0xf0, 0x80, 0x80, 0x80], // overlong 4-byte
      [0xf5], // beyond U+10FFFF lead
      [0xc2], // truncated 2-byte
      [0x80],
      [0xbf],
      [0x61, 0xf0, 0x9f, 0x94, 0x90, 0x62], // valid emoji between ASCII
    ];
    for (const v of vectors) {
      expect(utf8Decode(new Uint8Array(v))).toBe(nativeDecode(new Uint8Array(v)));
    }
  });

  it('installs the fallback without shadowing natives', () => {
    const before = globalThis.TextEncoder;
    installTextCodecFallback();
    expect(globalThis.TextEncoder).toBe(before);
  });
});
