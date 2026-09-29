/**
 * On-device diagnostic: proves that the identity stored in secure storage can
 * actually decrypt files addressed to its displayed recipient. The challenge
 * below is a real `age` encryption (single X25519 stanza) to the phone
 * recipient in the nixos .sops.yaml — if decryption fails here, the stored
 * key genuinely does not correspond to that recipient (or the crypto path
 * is broken on this runtime); if it succeeds, the device key is fine and any
 * vault-sync failure lies in the fetched file content.
 */
import * as age from 'age-encryption';
import { decryptToBytes, makeAgeIdentity, recipientForIdentity } from './age';
import { utf8Decode } from './utf8';

export const SELF_TEST_RECIPIENT = 'age189wm4hu8m82mmantwfnxpj3p4687e6q49aqg2yvzr3v3p7v0zgrsg0t4rx';

// `printf 'sops-pass self-test v1' | age -a -r $SELF_TEST_RECIPIENT`
const CHALLENGE = `-----BEGIN AGE ENCRYPTED FILE-----
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSBpQ2lVa2srV0I1bVBUYy9F
Wk9Pb1Rrak1WNE1yMTcxMm0xR1NXSUN1cHdzCmxsalJuU3JlTnpnbk42ZldwUnhQ
NnFlR1diM25GQnRhTlFUc3NSWmF3MU0KLS0tIGxoQ2k5SWhraUExMzJ0Rkx1YlUv
NmU5WUdXMThKQXEyc29uMmRpRSsybFEKaWFo0NEV/55jdGO4ZntA7+3dnJ7TifRH
Fk682PNQ588tDuShuebEaqsE3c+uMOrFLRnEmima
-----END AGE ENCRYPTED FILE-----`;

const PLAINTEXT = 'sops-pass self-test v1';

export interface SelfTestResult {
  ok: boolean;
  derivedRecipient: string;
  message: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function deviceKeySelfTest(identity: string): Promise<SelfTestResult> {
  const derivedRecipient = await recipientForIdentity(identity);
  const matchesAddress = derivedRecipient === SELF_TEST_RECIPIENT;

  let blob: Uint8Array;
  try {
    blob = age.armor.decode(CHALLENGE);
  } catch (e) {
    return {
      ok: false,
      derivedRecipient,
      message: `FAIL — the bundled test file would not even parse on this runtime (${errMsg(e)}). Report this error.`,
    };
  }

  try {
    const d = new age.Decrypter();
    d.addIdentity(makeAgeIdentity(identity));
    const out = utf8Decode(await decryptToBytes(d, blob));
    if (out !== PLAINTEXT) throw new Error(`unexpected plaintext ${JSON.stringify(out.slice(0, 40))}`);
    return {
      ok: true,
      derivedRecipient,
      message:
        `PASS — this device's stored key decrypted a test file addressed to ${SELF_TEST_RECIPIENT.slice(0, 16)}…` +
        (matchesAddress ? ' and its recipient matches that address.' : ` ⚠ though it derives to ${derivedRecipient}.`),
    };
  } catch (e) {
    return {
      ok: false,
      derivedRecipient,
      message:
        `FAIL — stored key could not decrypt the test file (${errMsg(e)}). ` +
        `Derived recipient from the stored key: ${derivedRecipient} — ` +
        (matchesAddress
          ? 'it matches the address, so this is a runtime crypto failure, not a key mismatch.'
          : 'it does NOT match the address the file was encrypted to.'),
    };
  }
}
