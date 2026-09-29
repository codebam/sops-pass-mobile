#!/usr/bin/env bash
# Regenerate vitest fixtures with the real sops + age CLIs.
#
# Creates two independent age identities (A = "desktop", B = "phone"), encrypts a
# YAML document with A only, then adds B via `sops updatekeys` (exactly what the
# onboarding flow does for the phone key) and produces ground-truth decryptions
# from the real sops binary for the tests to compare against.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

command -v sops >/dev/null || { echo "sops not found on PATH" >&2; exit 1; }
command -v age-keygen >/dev/null || { echo "age-keygen not found on PATH" >&2; exit 1; }

FIX=test/fixtures
rm -rf "$FIX"
mkdir -p "$FIX"

age-keygen -o "$FIX/testkey-a.txt" 2>/dev/null
age-keygen -o "$FIX/testkey-b.txt" 2>/dev/null
KEY_A=$(age-keygen -y "$FIX/testkey-a.txt")
KEY_B=$(age-keygen -y "$FIX/testkey-b.txt")
printf '%s\n' "$KEY_A" >"$FIX/testkey-a.pub"
printf '%s\n' "$KEY_B" >"$FIX/testkey-b.pub"

cat >"$FIX/.sops.yaml" <<EOF
creation_rules:
  - path_regex: .*\.yaml$
    unencrypted_suffix: _unencrypted
    key_groups:
      - age: [$KEY_A]
EOF

cat >"$FIX/plain.yaml" <<'EOF'
simple: hunter2
nested:
    service.com:
        alice@example.com: "p@ss:with,special[chars] # and hash"
        bob@example.com: correct horse battery staple
unicode:
    emoji: "🔐🗝️☂️"
    rtl: "كلمة المرور"
    accents: "café naïve ñoño"
multiline: |
    line one
    line two
empty: ""
suffixed_unencrypted: plaintext-value
number_int: 42
number_float: 3.14
bool_true: true
otp-sample:
    work: "otpauth://totp/Acme:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme"
EOF

cd "$FIX"
export SOPS_AGE_KEY_FILE="$PWD/testkey-a.txt"

# 1. single-recipient encryption (the state before the phone key is added)
sops --encrypt plain.yaml >encrypted.yaml
sops --decrypt encrypted.yaml >expected.yaml 2>/dev/null

# 2. add the second recipient and re-wrap the data key (what `sops updatekeys` does)
cat >.sops.yaml <<EOF
creation_rules:
  - path_regex: .*\.yaml$
    unencrypted_suffix: _unencrypted
    key_groups:
      - age: [$KEY_A, $KEY_B]
EOF
sops updatekeys --yes encrypted.yaml
sops --decrypt encrypted.yaml >expected.yaml 2>/dev/null

# 3. mac_only_encrypted variant (exercises the MAC initialization constant)
mkdir -p maconly
cp plain.yaml maconly/plain.yaml
cat >maconly/.sops.yaml <<EOF
creation_rules:
  - path_regex: .*\.yaml$
    unencrypted_suffix: _unencrypted
    mac_only_encrypted: true
    key_groups:
      - age: [$KEY_A]
EOF
cd maconly
sops --encrypt --config .sops.yaml plain.yaml >encrypted.yaml
sops --decrypt encrypted.yaml >expected.yaml 2>/dev/null

cd "$ROOT"
echo "fixtures written:"
find "$FIX" -type f | sort
