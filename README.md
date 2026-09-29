# sops-pass-mobile

Mobile client for [sops-pass](../sops-pass) — browse, search, copy and generate TOTP
codes from the SOPS-encrypted password store in the private `codebam/nixos` repo,
**decrypted entirely on the phone** with a key generated on the device.

Runs in stock **Expo Go** on Android (SDK 57): every dependency is pure JS/TS — no
custom native modules.

## How it works

```
┌─ phone ────────────────────────────────┐      ┌─ github (private) ─┐
│ age keypair  (generated on-device)     │      │ codebam/nixos      │
│   private → expo-secure-store/Keystore │      │ secrets/           │
│   public  → .sops.yaml + updatekeys ───┼─────▶│  passwords.enc.yaml│
│ ciphertext cache (disk) + plaintext    │◀─────┤ (ciphertext only)  │
│ only in memory                         │      └────────────────────┘
└────────────────────────────────────────┘
```

- **On-device key** — the app generates an age X25519 keypair (`age-encryption` over
  @noble/@scure). The public recipient (`age1…`) is added to the nixos repo; the
  private identity (`AGE-SECRET-KEY-1…`) never leaves the phone.
- **Sync** — fetches `secrets/passwords.enc.yaml` via the GitHub contents API with a
  fine-grained PAT (Contents: Read on that repo). The ciphertext is cached on disk;
  plaintext never touches disk.
- **Decrypt** — a faithful pure-TS port of SOPS v3 (validated against sops CLI
  v3.13.3): age stanza unwrap → per-value AES-256-GCM with sops AADs → SHA-512 MAC
  verification over the plaintext, so a tampered vault fails closed.
- **TOTP** — parity with `pass otp` (RFC 6238; SHA-1, 6 digits, 30 s), parsed from
  `otpauth://` URIs inside entry values.
- **Extras** — search, clipboard auto-clear (45 s, on by default), opt-in biometric
  unlock, lock-on-background, wipe.

## Dev setup

```sh
npm install
npm run fixtures   # generate sops-CLI fixtures (throwaway keys) for the test suite
npm test           # 28 tests
npm run typecheck
npx expo start     # scan the QR with Expo Go (Android, SDK 57)
```

All Expo packages were installed with `npx expo install` (SDK-pinned) — keep it that way.

### Connecting the phone (firewall-aware)

The desktop firewall keeps LAN ports closed by design (`allowedTCPPorts = []`;
only `tailscale0` & co. are trusted), so the LAN `exp://192.168.x.x:PORT` URL and QR
code can never connect from the phone. Connect over the tailnet instead — the phone
(`pixel-10a`) is already on it:

```sh
# QR + URL encode the tailnet IP:
EXPO_PACKAGER_HOSTNAME=100.101.46.50 npx expo start --port 8082
# or keep the default start and in Expo Go use "Enter URL manually":
#   exp://100.101.46.50:8082      (MagicDNS: exp://nixos-desktop.tail7d7a2.ts.net:8082)
```

The dev server reflects the requesting host, so manifest, JS bundle and hot reload
all stay on `tailscale0` — no firewall changes needed. (Note port 8081 is taken by
SearXNG on localhost, so Expo prompts for another port; pick one and stay
consistent.)

## Onboarding the phone (one time)

1. Open the app → **Generate key on this device** → copy the `age1…` recipient
   (later visible under Settings → Device key).
2. On the computer, from this repo:

   ```sh
   scripts/add-mobile-key.sh age1…            # NIXOS_DIR defaults to /persistent/etc/nixos
   ```

   It adds `&phone` to the key list and `*phone` to the creation rule in
   `.sops.yaml`, then runs `sops updatekeys secrets/passwords.enc.yaml` to re-wrap
   the vault data key (values are not re-encrypted).

   `sops updatekeys` needs exactly one identity that can decrypt the file today:
   - **YubiKey route** — plug the key in:
     `SOPS_AGE_KEY_FILE=secrets/identities/yubikey-5c.txt sops updatekeys …`
     (touch prompted by age-plugin-yubikey)
   - **Root route** — the sops-nix key is root-only:
     `doas env SOPS_AGE_KEY_FILE=/persistent/var/lib/sops-nix/key.txt sops updatekeys …`

   Then commit + push the nixos repo — the phone mirrors the committed state:
   `git -C /persistent/etc/nixos commit -am 'sops: add phone age recipient' && git -C /persistent/etc/nixos push`
3. Create a read-only token: GitHub → Settings → Developer settings →
   **Fine-grained tokens** → only `codebam/nixos`, permission **Contents: Read**.
4. In the app: Settings → paste the token → Save. Tap **Sync** on the vault screen.
5. Browse, tap an entry → Reveal / Copy / one-time code. Done.

## Sync settings (defaults)

owner `codebam` · repo `nixos` · branch `main` · path `secrets/passwords.enc.yaml` —
all editable in Settings.

## Verification (what was actually tested)

- `npm test` — the decryptor is validated against real **sops CLI** output: a
  two-recipient file (the phone-cipher scenario), mac-only encryption, kmac/MAC
  tamper detection, wrong-identity rejection, unicode/multiline/typed/empty values,
  and exact plaintext equality with `sops -d`. TOTP vs RFC 6238 vectors; utf8 codec
  vs native `TextEncoder`/`TextDecoder` incl. malformed-input semantics.
- `npm run smoke` — headless-Chromium E2E of the real UI against the web export
  (boot → import fixture identity → stubbed GitHub fetch → decrypt → list → open
  TOTP entry). Requires `dist-web/` served (see script header).
- `npx expo export --platform android` — production Hermes bundle compiles clean
  (1430 modules).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `GitHub 404` | token lacks Contents: Read on `codebam/nixos`, or owner/repo/path/branch wrong |
| `GitHub 401` | token invalid/expired/revoked |
| decrypt error mentioning the identity | phone recipient not in `.sops.yaml`, or `updatekeys` not run/committed/pushed |
| `MAC mismatch` | file changed after encryption, or not the sops-encrypted vault |
| QR won't connect | Expected on LAN: the NixOS firewall blocks dev ports from `wlan0` by design. Connect over Tailscale — `EXPO_PACKAGER_HOSTNAME=100.101.46.50 npx expo start --port 8082`, or enter `exp://100.101.46.50:8082` manually |
| Expo Go shows "unsupported SDK" | update Expo Go from the Play Store (needs SDK 57) |

## Repo layout

```
src/lib/sops.ts       SOPS v3 decryptor (age unwrap, AES-GCM, MAC)
src/lib/age.ts        on-device age keygen + recipient derivation
src/lib/totp.ts       RFC 6238 TOTP + otpauth:// parsing (pass otp parity)
src/lib/utf8.ts       UTF-8 codec + guarded TextEncoder/TextDecoder fallback
src/lib/github.ts     contents-API vault fetch
src/lib/storage.ts    secure-store secrets + ciphertext cache
src/state/AppContext.tsx  app state, lock, refresh
src/ui/               theme + component kit
src/app/              Expo Router screens: index (vault), setup, entry, settings
scripts/make-fixtures.sh  sops-CLI fixtures for tests
scripts/smoke-web.mjs     browser E2E
scripts/add-mobile-key.sh nixos repo onboarding (recipient + updatekeys)
```

## Security notes

- Identity and PAT live in Keystore-backed secure storage; **Wipe everything** in
  Settings removes identity, token, settings and the cached ciphertext.
- The cached blob is ciphertext only; deleting the app removes it entirely.
- MAC verification happens before any entry is surfaced — tampered files fail closed.
- The PAT should be fine-grained to this one repo with Contents: Read; revoke it any
  time from GitHub (then update Settings).
- Plaintext values exist only in app memory (and the clipboard, which auto-clears).
