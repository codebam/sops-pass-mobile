import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { Badge, Button, Card, Header, Note, Screen } from '../ui/kit';
import { colors, radii, space, type as typography } from '../ui/theme';

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function VaultScreen() {
  const app = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (app.ready && app.identity) void app.refresh();
  }, [app.ready, app.identity]); // intentionally only on boot / key change

  const entries = useMemo(() => {
    const all = app.vault?.entries ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((e) => e.path.toLowerCase().includes(needle));
  }, [app.vault, q]);

  if (!app.ready) {
    return (
      <Screen>
        <Header title="sops-pass" />
        <View style={styles.center}>
          <Text style={typography.subtitle}>Loading…</Text>
        </View>
      </Screen>
    );
  }
  if (!app.identity) return <Redirect href="/setup" />;
  if (app.locked) return <LockScreen />;

  const vault = app.vault;
  const subtitle = vault
    ? `${vault.entries.length} entries · ${vault.fromCache ? 'cache' : 'synced'} ${timeAgo(vault.syncedAt)}` +
      (vault.sha ? ` · ${vault.sha.slice(0, 7)}` : '')
    : app.syncing
      ? 'syncing…'
      : 'no data yet';

  return (
    <Screen>
      <Header
        title="sops-pass"
        subtitle={subtitle}
        right={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title={app.syncing ? '…' : 'Sync'} onPress={() => void app.refresh()} small loading={app.syncing} kind="secondary" />
            <Button title="⚙" onPress={() => router.push('/settings')} small kind="ghost" />
          </View>
        }
      />

      {app.syncError ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Card style={{ borderColor: colors.danger, marginBottom: space.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '600', marginBottom: space.xs }}>Sync failed</Text>
            <Note tone="dim">{app.syncError}</Note>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="Retry" onPress={() => void app.refresh()} small kind="secondary" />
              <Button title="Settings" onPress={() => router.push('/settings')} small kind="ghost" />
            </View>
          </Card>
        </View>
      ) : null}

      {!vault && !app.syncing ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <Card>
            <Text style={{ ...typography.body, fontWeight: '600', marginBottom: space.sm }}>No vault yet</Text>
            <Note>
              The encrypted store is pulled from GitHub, decrypted on this device, and cached offline. Make sure this
              device's key was added with `sops updatekeys` first, then sync.
            </Note>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="Sync now" onPress={() => void app.refresh()} small />
              <Button title="Settings" onPress={() => router.push('/settings')} small kind="ghost" />
            </View>
          </Card>
        </View>
      ) : null}

      {vault ? (
        <>
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <View style={styles.searchBar}>
              <Text style={{ color: colors.faint, fontSize: 16 }}>⌕</Text>
              <SearchInput value={q} onChange={setQ} />
            </View>
          </View>
          <FlatList
            data={entries}
            keyExtractor={(item) => item.path}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgElevated }]}
                onPress={() => router.push({ pathname: '/entry', params: { path: item.path } })}
              >
                <Text style={styles.rowPath} numberOfLines={1}>
                  {item.path}
                </Text>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={{ paddingTop: space.xl }}>
                <Note>No entries match "{q}".</Note>
              </View>
            }
          />
          {vault.fromCache ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, flexDirection: 'row', gap: space.sm }}>
              <Badge text="offline cache — pull to sync" tone="warn" />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="search entries…"
      placeholderTextColor={colors.faint}
      style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 9 }}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

function LockScreen() {
  const app = useApp();
  useEffect(() => {
    void app.unlock();
  }, []);
  return (
    <Screen>
      <View style={styles.center}>
        <Text style={{ fontSize: 42, marginBottom: space.md }}>🔒</Text>
        <Text style={{ ...typography.title, marginBottom: space.xs }}>Locked</Text>
        <Text style={{ ...typography.subtitle, marginBottom: space.xl, textAlign: 'center', paddingHorizontal: space.xl }}>
          Unlock to view your password store.
        </Text>
        <Button title="Unlock" onPress={() => void app.unlock()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPath: { flex: 1, color: colors.text, fontSize: 15 },
  chev: { color: colors.faint, fontSize: 18, marginLeft: space.sm },
});
