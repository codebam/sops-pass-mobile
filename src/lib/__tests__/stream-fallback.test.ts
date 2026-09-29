/**
 * Regression: React Native's fetch polyfill cannot consume ReadableStream
 * bodies in `Response` — it stringifies them — so age-encryption's `readAll()`
 * read-out (`new Uint8Array(await new Response(stream).arrayBuffer())`) yields
 * the literal ASCII "[object ReadableStream]" instead of the plaintext. That
 * silently broke data-key unwrapping (23-byte "key" → length check fail →
 * misreported as "not a recipient"). The decryptor must never depend on
 * `new Response(stream)`; this test breaks the global Response the way RN does
 * and expects a full, MAC-verified decrypt anyway.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptSopsYaml } from '../sops';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures');

function readIdentity(path: string): string {
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1'));
  if (!line) throw new Error(`no age identity in ${path} — run \`npm run fixtures\``);
  return line;
}

describe('React Native fetch-polyfill compatibility', () => {
  const originalResponse = globalThis.Response;
  afterEach(() => {
    globalThis.Response = originalResponse;
  });

  it('simulation matches the RN failure string', () => {
    // Proves String(stream) is exactly what the phone surfaced.
    expect(String(new ReadableStream({ start: (c) => c.close() }))).toBe('[object ReadableStream]');
  });

  it('decrypts and MAC-verifies with a Response that cannot consume streams', async () => {
    class RNLikeResponse {
      private readonly bodyText: string;
      constructor(body: unknown) {
        this.bodyText = String(body);
      }
      async arrayBuffer(): Promise<ArrayBuffer> {
        return new TextEncoder().encode(this.bodyText).buffer;
      }
      async text(): Promise<string> {
        return this.bodyText;
      }
    }
    globalThis.Response = RNLikeResponse as unknown as typeof Response;

    const enc = readFileSync(join(FIX, 'encrypted.yaml'), 'utf8');
    const res = await decryptSopsYaml(enc, readIdentity(join(FIX, 'testkey-b.txt')));
    expect(res.macVerified).toBe(true);
    expect((res.data as Record<string, unknown>).multiline).toBe('line one\nline two\n');
  });
});
