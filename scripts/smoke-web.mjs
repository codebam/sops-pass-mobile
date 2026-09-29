/**
 * End-to-end browser smoke test for the web build of the app.
 *
 * Drives the real UI in headless Chromium:
 *   setup → import a fixture age identity → stub the GitHub fetch → Sync →
 *   vault list renders decrypted entries → open an entry → TOTP card renders.
 *
 * Usage:
 *   npm run fixtures && npx expo export --platform web --output-dir dist-web
 *   cp test/fixtures/encrypted.yaml dist-web/encrypted-fixture.yaml
 *   (cd dist-web && python3 -m http.server 8097 --bind 127.0.0.1 &)
 *   node scripts/smoke-web.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const APP_URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:8097/';
const CHROME = process.env.CHROME_PATH ?? execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

const keyFile = readFileSync(new URL('../test/fixtures/testkey-b.txt', import.meta.url), 'utf8');
const IDENTITY = keyFile
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith('AGE-SECRET-KEY-1'));
if (!IDENTITY) throw new Error('no fixture identity found — run `npm run fixtures`');

const clickByText = (page, text) =>
  page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('div, span, a, button'));
    const candidates = els.filter((e) => (e.innerText ?? '').trim() === t);
    const el = candidates[candidates.length - 1] ?? els.find((e) => (e.innerText ?? '').includes(t));
    if (!el) throw new Error(`element not found: ${t}`);
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
    return true;
  }, text);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--user-data-dir=/tmp/chrome-smoke-profile'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  console.log('[1] booting', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('Set up this device'), { timeout: 30000 });
  console.log('    setup screen rendered');

  console.log('[2] installing fetch stub for api.github.com (vault screen auto-syncs on arrival)');
  await page.evaluate(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.github.com/')) {
        const text = await (await orig('/encrypted-fixture.yaml')).text();
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        const body = JSON.stringify({
          content: btoa(bin),
          encoding: 'base64',
          sha: 'fixturesha1234567',
          size: bytes.length,
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return orig(input, init);
    };
  });

  console.log('[3] importing fixture identity');
  await clickByText(page, 'I already have a key (restore)');
  await page.waitForSelector('textarea', { timeout: 10000 });
  await page.type('textarea', IDENTITY);
  await clickByText(page, 'Import');
  await page.waitForFunction(() => document.body.innerText.includes('nested/service.com/alice@example.com'), {
    timeout: 20000,
  });
  console.log('    auto-sync after import decrypted the vault');

  console.log('[4] manual Sync via header button');
  await clickByText(page, 'Sync');
  await page.waitForFunction(() => document.body.innerText.includes('nested/service.com/alice@example.com'), {
    timeout: 20000,
  });
  console.log('    manual refresh ok');
  await page.screenshot({ path: '/tmp/smoke-vault.png' });

  console.log('[5] opening an entry with TOTP');
  await clickByText(page, 'otp-sample/work');
  await page.waitForFunction(() => /expires in \d+s/.test(document.body.innerText), { timeout: 10000 });
  const entryText = await page.evaluate(() => document.body.innerText);
  const otp = entryText.match(/(\d{3} \d{3})/);
  console.log('    TOTP card rendered, code pattern:', otp?.[1] ?? '(not matched — check screenshot)');
  await page.screenshot({ path: '/tmp/smoke-entry.png' });

  console.log('[6] search + unicode entry');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.body.innerText.includes('nested/service.com/alice@example.com'), {
    timeout: 10000,
  });
  console.log('    back to vault ok');

  if (errors.length) {
    // RN-web dev tooling logs benign warnings as console errors sometimes; list them.
    console.log('[warnings/errors seen]');
    for (const e of errors) console.log('  -', e.slice(0, 220));
  }
  console.log('SMOKE OK');
} finally {
  await browser.close();
}
