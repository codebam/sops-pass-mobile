/**
 * Minimal UTF-8 codec used by the sops decryptor and installed as a guarded
 * global fallback (Hermes ≥ RN 0.85 has native TextEncoder/TextDecoder, but the
 * crypto stack must never depend on engine versions).
 *
 * Correct for all valid UTF-8; invalid sequences decode to U+FFFD (loose mode).
 */

export function utf8Encode(input: string): Uint8Array {
  // count bytes first (surrogate pairs → 4 bytes)
  let len = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) len += 1;
    else if (c < 0x800) len += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const c2 = input.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        len += 4;
        i++;
      } else len += 3;
    } else len += 3;
  }
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const c2 = input.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (c2 - 0xdc00) + 0x10000;
        i++;
      } else {
        c = 0xfffd; // lone surrogate
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      c = 0xfffd; // lone low surrogate
    }
    if (c < 0x80) out[p++] = c;
    else if (c < 0x800) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    } else {
      out[p++] = 0xf0 | (c >> 18);
      out[p++] = 0x80 | ((c >> 12) & 0x3f);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    }
  }
  return out;
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i++;
      continue;
    }
    let need: number;
    let leadMask: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      leadMask = 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      leadMask = 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      leadMask = 0x07;
    } else {
      out += '\ufffd'; // invalid lead byte / continuation byte
      i++;
      continue;
    }
    // Check continuation bytes, with the per-lead first-byte ranges from the
    // WHATWG UTF-8 decoder (prevents overlongs and surrogates up front).
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++) {
      if (j >= n) {
        ok = false;
        break;
      }
      const b = bytes[j];
      let inRange = (b & 0xc0) === 0x80;
      if (inRange && k === 0) {
        if (b0 === 0xe0) inRange = b >= 0xa0 && b <= 0xbf;
        else if (b0 === 0xed) inRange = b >= 0x80 && b <= 0x9f;
        else if (b0 === 0xf0) inRange = b >= 0x90 && b <= 0xbf;
        else if (b0 === 0xf4) inRange = b >= 0x80 && b <= 0x8f;
      }
      if (!inRange) {
        ok = false;
        break;
      }
      j++;
    }
    if (!ok) {
      out += '\ufffd'; // one replacement for the maximal subpart; resume at j
      i = j;
      continue;
    }
    let cp = b0 & leadMask;
    for (let k = i + 1; k < j; k++) cp = (cp << 6) | (bytes[k] & 0x3f);
    out += String.fromCodePoint(cp);
    i = j;
  }
  return out;
}

/** Install the fallbacks only when the engine lacks them (never shadows native). */
export function installTextCodecFallback(): void {
  const g = globalThis as {
    TextEncoder?: unknown;
    TextDecoder?: unknown;
  };
  if (typeof g.TextEncoder === 'undefined') {
    g.TextEncoder = class TextEncoderPolyfill {
      readonly encoding = 'utf-8';
      encode(input?: string): Uint8Array {
        return utf8Encode(input ?? '');
      }
    };
  }
  if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = class TextDecoderPolyfill {
      readonly encoding = 'utf-8';
      readonly fatal = false;
      readonly ignoreBOM = false;
      decode(input?: Uint8Array): string {
        return utf8Decode(input ?? new Uint8Array(0));
      }
    };
  }
}
