#!/usr/bin/env bash
# Add a phone's on-device age recipient to the NixOS sops config and
# re-wrap the vault data key so the phone can decrypt.
#
# Usage:
#   scripts/add-mobile-key.sh age1...            # edit .sops.yaml + sops updatekeys
#   scripts/add-mobile-key.sh age1... --dry-run  # edit only (no updatekeys)
#
# Env:
#   NIXOS_DIR   path to the nixos flake (default /persistent/etc/nixos)
#   SECRET      vault path relative to NIXOS_DIR (default secrets/passwords.enc.yaml)
set -euo pipefail

RECIPIENT="${1:-}"
MODE="${2:-}"
NIXOS_DIR="${NIXOS_DIR:-/persistent/etc/nixos}"
SECRET="${SECRET:-secrets/passwords.enc.yaml}"

usage() {
  echo "usage: $0 age1<...> [--dry-run]" >&2
  exit 1
}

[ -n "$RECIPIENT" ] || usage
if ! printf '%s' "$RECIPIENT" | grep -qE '^age1[0-9a-z]{20,}$'; then
  echo "error: '$RECIPIENT' does not look like an age X25519 recipient (age1...)" >&2
  exit 1
fi

SOPS_YAML="$NIXOS_DIR/.sops.yaml"
[ -f "$SOPS_YAML" ] || { echo "error: no .sops.yaml at $SOPS_YAML" >&2; exit 1; }

if grep -qF "$RECIPIENT" "$SOPS_YAML"; then
  echo "recipient already present in $SOPS_YAML — nothing to add"
else
  cp "$SOPS_YAML" "$SOPS_YAML.bak"
  python3 - "$SOPS_YAML" "$RECIPIENT" <<'PY'
import sys

path, rec = sys.argv[1], sys.argv[2]
with open(path) as f:
    lines = f.read().splitlines(keepends=True)

# 1) add the anchor to the keys list: prefer right after &desktop, else after
#    the last "  - &anchor" line.
anchor_line = f"  - &phone {rec}\n"
assert not any(anchor_line.rstrip("\n") in l for l in lines), "anchor already present"
insert_key = None
for i, l in enumerate(lines):
    if l.strip().startswith("- &desktop"):
        insert_key = i + 1
if insert_key is None:
    for i, l in enumerate(lines):
        if l.strip().startswith("- &"):
            insert_key = i + 1
assert insert_key is not None, "no '  - &anchor' line found in keys section"
lines.insert(insert_key, anchor_line)

# 2) reference *phone in the age list of the creation rule: after the last
#    deeply-indented "          - *anchor" line.
insert_ref = None
for i, l in enumerate(lines):
    if l.lstrip().startswith("- *"):
        insert_ref = i + 1
assert insert_ref is not None, "no '          - *anchor' entries found to extend"
lines.insert(insert_ref, "          - *phone\n")

with open(path, "w") as f:
    f.write("".join(lines))
print(f"added '&phone {rec}' and its '*phone' reference")
PY
  echo "edited $SOPS_YAML (backup: $SOPS_YAML.bak)"
fi

if [ "$MODE" = "--dry-run" ]; then
  echo "dry-run: skipping 'sops updatekeys'"; exit 0
fi

command -v sops >/dev/null || { echo "error: sops not on PATH (try: nix shell nixpkgs#sops)" >&2; exit 1; }
echo "==> re-wrapping the vault data key with 'sops updatekeys $SECRET'"
echo "    (a YubiKey touch may be prompted; set SOPS_AGE_KEY_FILE if sops needs an identity file)"
(cd "$NIXOS_DIR" && sops updatekeys "$SECRET")
echo
echo "==> done. Verify and commit from the nixos repo:"
echo "    cd $NIXOS_DIR"
echo "    sops -d $SECRET | head        # sanity: still decryptable"
echo "    git add .sops.yaml $SECRET && git commit -m 'sops: add phone age recipient' && git push"
