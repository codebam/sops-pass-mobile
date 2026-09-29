import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { findOtpauthUri, parseOtpauth, totp } from '../lib/totp';
import { Badge, Button, Card, CopyButton, Header, Mono, Note, Screen } from '../ui/kit';
import { colors, radii, space, type as typography } from '../ui/theme';

export default function EntryScreen() {
  const params = useLocalSearchParams<{ path?: string }>();
  const router = useRouter();
  const app = useApp();
  const fullPath = typeof params.path === 'string' ? params.path : '';

  const entry = useMemo(() => app.vault?.entries.find((e) => e.path === fullPath), [app.vault, fullPath]);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const otp = useMemo(() => {
    if (!entry) return null;
    const uri = findOtpauthUri(entry.value);
    return uri ? parseOtpauth(uri) : null;
  }, [entry]);

  useEffect(() => {
    if (!otp) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [otp]);

  const autoClear = app.settings.autoClearClipboard ? 45_000 : undefined;
  const totpRes = otp ? totp(otp, now) : null;

  if (!entry) {
    return (
      <Screen>
        <Header title="Not found" onBack={() => router.back()} />
        <View style={{ padding: space.lg }}>
          <Card>
            <Note>This entry isn't in the current vault snapshot. Sync first, then try again.</Note>
            <Button title="Sync now" onPress={() => void app.refresh()} small style={{ marginTop: space.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  const masked = '•'.repeat(Math.min(Math.max(entry.value.replace(/\n/g, '').length, 4), 20));
  const isMultiline = entry.value.includes('\n');

  return (
    <Screen>
      <Header title={entry.path} subtitle={isMultiline ? 'multiline entry' : undefined} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
        {totpRes && otp ? (
          <Card style={{ alignItems: 'center' }}>
            <Text style={typography.label}>One-time code {otp.issuer ? `· ${otp.issuer}` : ''}</Text>
            <Text style={styles.otp}>{totpRes.code.slice(0, Math.ceil(totpRes.digits / 2)) + ' ' + totpRes.code.slice(Math.ceil(totpRes.digits / 2))}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(totpRes.secondsRemaining / totpRes.period) * 100}%` }]} />
            </View>
            <Text style={{ ...typography.subtitle, marginTop: space.sm }}>expires in {totpRes.secondsRemaining}s</Text>
            <CopyButton value={totpRes.code} label="Copy code" small style={{ marginTop: space.md }} />
          </Card>
        ) : null}

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
            <Text style={typography.label}>Password</Text>
            {isMultiline ? <Badge text="multiline" tone="accent" /> : null}
          </View>
          <View style={styles.valueBox}>
            {revealed ? (
              <Mono>{entry.value}</Mono>
            ) : (
              <Text style={{ ...typography.mono, letterSpacing: 1 }}>{masked}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button title={revealed ? 'Hide' : 'Reveal'} kind="secondary" small onPress={() => setRevealed((r) => !r)} />
            <CopyButton value={entry.value} label="Copy" autoClearMs={autoClear} small />
          </View>
          {app.settings.autoClearClipboard ? (
            <Text style={{ ...typography.subtitle, marginTop: space.sm, fontSize: 12 }}>
              Clipboard is cleared automatically 45s after copying.
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text style={typography.label}>Entry</Text>
          <View style={{ marginTop: space.sm, gap: space.xs }}>
            <Mono numberOfLines={2}>{entry.path}</Mono>
            <CopyButton value={entry.path} label="Copy path" kind="ghost" small />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  otp: {
    fontFamily: typography.mono.fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    marginVertical: space.sm,
    letterSpacing: 2,
  },
  progressTrack: {
    height: 4,
    width: '100%',
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: space.xs,
  },
  progressFill: { height: 4, backgroundColor: colors.accent },
  valueBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    minHeight: 52,
    justifyContent: 'center',
  },
});
