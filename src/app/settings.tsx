import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { Button, Card, CopyButton, Field, Header, Mono, Note, Screen } from '../ui/kit';
import { colors, space, type as typography } from '../ui/theme';

export default function SettingsScreen() {
  const app = useApp();
  const router = useRouter();

  const [owner, setOwner] = useState(app.settings.sync.owner);
  const [repo, setRepo] = useState(app.settings.sync.repo);
  const [branch, setBranch] = useState(app.settings.sync.branch);
  const [path, setPath] = useState(app.settings.sync.path);
  const [tokenInput, setTokenInput] = useState(app.token);
  const [showToken, setShowToken] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setOwner(app.settings.sync.owner);
    setRepo(app.settings.sync.repo);
    setBranch(app.settings.sync.branch);
    setPath(app.settings.sync.path);
  }, [app.settings.sync.owner, app.settings.sync.repo, app.settings.sync.branch, app.settings.sync.path]);

  useEffect(() => {
    setTokenInput(app.token);
  }, [app.token]);

  const saveSync = async () => {
    setNote('Saved — syncing…');
    await app.updateSyncConfig({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim(), path: path.trim() });
    await app.updateToken(tokenInput.trim());
    await app.refresh();
    setNote('Saved.');
  };

  const confirmReset = () => {
    Alert.alert(
      'Reset this app?',
      'The on-device key, GitHub token, settings and cached vault will be deleted from this device. Your passwords and the repo are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void app.wipe().then(() => router.replace('/'));
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Header title="Settings" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
        <Card>
          <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>Sync source</Text>
          <Note>
            The encrypted store is fetched from a <Text style={styles.bold}>private GitHub repo</Text> via the contents
            API and decrypted locally. The token needs read-only access (fine-grained: Contents → Read).
          </Note>
          <View style={{ marginTop: space.md }}>
            <Field label="owner" value={owner} onChangeText={setOwner} placeholder="codebam" />
            <Field label="repo" value={repo} onChangeText={setRepo} placeholder="nixos" />
            <Field label="branch" value={branch} onChangeText={setBranch} placeholder="main" />
            <Field label="path" value={path} onChangeText={setPath} placeholder="secrets/passwords.enc.yaml" />
            <Field
              label="github token (fine-grained PAT, Contents: Read)"
              value={tokenInput}
              onChangeText={setTokenInput}
              placeholder="github_pat_…"
              secureTextEntry={!showToken}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs }}>
              <Button title="Save & sync" onPress={() => void saveSync()} loading={app.syncing} />
              <Button title="Sync now" kind="secondary" onPress={() => void app.refresh()} loading={app.syncing} />
              <Button title={showToken ? 'Hide token' : 'Show token'} kind="ghost" onPress={() => setShowToken((s) => !s)} />
            </View>
            {note ? <Text style={{ ...typography.subtitle, marginTop: space.sm }}>{note}</Text> : null}
            {app.syncError ? (
              <Text style={{ color: colors.danger, fontSize: 13, marginTop: space.sm, lineHeight: 19 }}>{app.syncError}</Text>
            ) : null}
          </View>
        </Card>

        <Card>
          <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>Security</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={typography.body}>Require unlock</Text>
              <Text style={typography.subtitle}>Biometric / device-credential prompt on open and when the app returns from the background.</Text>
            </View>
            <Switch
              value={app.settings.lockEnabled}
              onValueChange={(v) => void app.updateSettings({ lockEnabled: v })}
              trackColor={{ false: colors.border, true: colors.accentSoft }}
              thumbColor={app.settings.lockEnabled ? colors.accent : colors.faint}
            />
          </View>
          <View style={[styles.switchRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: space.md, paddingTop: space.md }]}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={typography.body}>Auto-clear clipboard</Text>
              <Text style={typography.subtitle}>Wipe the clipboard 45 s after copying a secret.</Text>
            </View>
            <Switch
              value={app.settings.autoClearClipboard}
              onValueChange={(v) => void app.updateSettings({ autoClearClipboard: v })}
              trackColor={{ false: colors.border, true: colors.accentSoft }}
              thumbColor={app.settings.autoClearClipboard ? colors.accent : colors.faint}
            />
          </View>
        </Card>

        <Card>
          <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>Device key</Text>
          {app.recipient ? (
            <>
              <Text style={typography.label}>public key (age recipient)</Text>
              <View style={styles.monoBox}>
                <Mono numberOfLines={3}>{app.recipient}</Mono>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' }}>
                <CopyButton value={app.recipient} label="Copy public key" small />
                <Button
                  title={showIdentity ? 'Hide private key' : 'Reveal private key'}
                  kind={showIdentity ? 'secondary' : 'ghost'}
                  small
                  onPress={() => setShowIdentity((s) => !s)}
                />
              </View>
            </>
          ) : (
            <Note>No key on this device yet.</Note>
          )}
          {showIdentity && app.identity ? (
            <View style={{ marginTop: space.md }}>
              <Note tone="warn">
                Secret — anyone with this string can read every file encrypted to this device. Use it only to back the
                key up into *your* password manager.
              </Note>
              <View style={[styles.monoBox, { marginTop: space.sm, borderColor: colors.danger }]}>
                <Mono numberOfLines={4}>{app.identity}</Mono>
              </View>
              <CopyButton value={app.identity} label="Copy private key" kind="danger" small style={{ marginTop: space.sm }} />
            </View>
          ) : null}
          <View style={{ marginTop: space.lg }}>
            <Button title="Reset app (wipe key & data)" kind="danger" onPress={confirmReset} />
          </View>
        </Card>

        <Card>
          <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>About</Text>
          <Note>
            sops-pass mobile — decrypts a sops (age + AES-256-GCM) YAML password store entirely on-device. The age
            private key is generated here and kept in Android Keystore-backed secure storage. No plaintext ever leaves
            the device.
          </Note>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  monoBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginTop: space.xs,
  },
});
