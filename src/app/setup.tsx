import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { Button, Card, CopyButton, Field, Header, Mono, Note, Screen } from '../ui/kit';
import { colors, space, type as typography } from '../ui/theme';

export default function SetupScreen() {
  const app = useApp();
  const router = useRouter();
  const [generated, setGenerated] = useState<{ recipient: string; identity: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importValue, setImportValue] = useState('');
  const [showImport, setShowImport] = useState(false);

  if (!app.ready) {
    return (
      <Screen>
        <Header title="Set up" onBack={() => router.back()} />
        <View style={{ padding: space.lg }}>
          <Text style={typography.subtitle}>Loading…</Text>
        </View>
      </Screen>
    );
  }
  if (app.identity && !generated) return <Redirect href="/" />;

  const doGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const kp = await app.generateKey();
      setGenerated(kp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await app.importKey(importValue);
      router.replace('/');
    } catch (e) {
      setError(`Not a valid age identity: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const recipient = generated?.recipient ?? app.recipient;

  return (
    <Screen>
      <Header title="Set up this device" subtitle="age key → sops recipient" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
        <Card>
          <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>On-device key</Text>
          <Note>
            sops-pass will generate an age key pair right here on the phone. The private half never leaves the device;
            the public half (below) is added to your nixos repo's <Text style={styles.bold}>.sops.yaml</Text> so the
            password store gets encrypted to this device as well.
          </Note>
          {!recipient ? (
            <Button title="Generate key on this device" onPress={() => void doGenerate()} loading={busy} style={{ marginTop: space.lg }} />
          ) : null}
        </Card>

        {recipient ? (
          <Card>
            <Text style={{ ...typography.label, marginBottom: space.sm }}>This device's public key</Text>
            <View style={styles.monoBox}>
              <Mono numberOfLines={3}>{recipient}</Mono>
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <CopyButton value={recipient} label="Copy key" />
            </View>
            <View style={styles.steps}>
              <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>
                Then, on the desktop:
              </Text>
              <Step n={1}>
                Run <Code>~/Documents/git/sops-pass-mobile/scripts/add-mobile-key.sh {'<key>'}</Code> — it adds this key
                to <Code>/persistent/etc/nixos/.sops.yaml</Code>.
              </Step>
              <Step n={2}>
                <Code>cd /persistent/etc/nixos && sops updatekeys secrets/passwords.enc.yaml</Code> (touch your YubiKey
                if asked).
              </Step>
              <Step n={3}>
                <Code>git add -A && git commit -m "sops: add mobile key" && git push</Code>
              </Step>
              <Step n={4}>
                Back here: Settings → paste a GitHub token → <Text style={styles.bold}>Sync</Text>.
              </Step>
            </View>
            <Button title="Continue" onPress={() => router.replace('/')} style={{ marginTop: space.md }} />
          </Card>
        ) : null}

        {!recipient ? (
          <Card>
            {!showImport ? (
              <Button title="I already have a key (restore)" kind="ghost" onPress={() => setShowImport(true)} />
            ) : (
              <>
                <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>Import an age identity</Text>
                <Field
                  placeholder="AGE-SECRET-KEY-1…"
                  value={importValue}
                  onChangeText={setImportValue}
                  multiline
                  numberOfLines={2}
                  style={{ marginBottom: space.sm }}
                />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button title="Import" onPress={() => void doImport()} loading={busy} disabled={!importValue.trim()} />
                  <Button title="Cancel" kind="ghost" onPress={() => setShowImport(false)} />
                </View>
              </>
            )}
          </Card>
        ) : null}

        {error ? (
          <Card style={{ borderColor: colors.danger }}>
            <Note tone="danger">{error}</Note>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: space.sm }}>
      <Text style={{ color: colors.accent, fontWeight: '700', width: 20 }}>{n}.</Text>
      <Text style={{ flex: 1, color: colors.dim, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: typography.mono.fontFamily, color: colors.text, fontSize: 12.5 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700', color: colors.text },
  monoBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  steps: { marginTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
});
