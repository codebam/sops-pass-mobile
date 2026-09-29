import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { colors, radii, space, type as typography } from './theme';

/** Copy to clipboard; optionally wipe the clipboard again after `autoClearMs`. */
export async function copyText(text: string, autoClearMs?: number): Promise<void> {
  await Clipboard.setStringAsync(text);
  if (autoClearMs && autoClearMs > 0) {
    setTimeout(() => {
      Clipboard.setStringAsync('').catch(() => {});
    }, autoClearMs);
  }
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
            <Text style={{ color: colors.accent, fontSize: 17 }}>‹ Back</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={typography.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={typography.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    kind === 'primary' ? colors.accent : kind === 'danger' ? colors.dangerSoft : kind === 'secondary' ? colors.bgElevated : 'transparent';
  const fg = kind === 'primary' ? '#0b0e14' : kind === 'danger' ? colors.danger : kind === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function CopyButton({
  value,
  label = 'Copy',
  autoClearMs,
  small,
  style,
  kind = 'primary',
}: {
  value: string;
  label?: string;
  autoClearMs?: number;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPress = useCallback(() => {
    copyText(value, autoClearMs).catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }, [value, autoClearMs]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      title={copied ? 'Copied ✓' : label}
      onPress={onPress}
      kind={copied ? 'secondary' : kind}
      small={small}
      style={style}
    />
  );
}

export function Mono({ children, style, numberOfLines }: { children: React.ReactNode; style?: any; numberOfLines?: number }) {
  return (
    <Text style={[typography.mono, style]} numberOfLines={numberOfLines} selectable>
      {children}
    </Text>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginBottom: space.md }, style]}>
      {label ? <Text style={[typography.label, { marginBottom: space.xs }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

export function Badge({ text, tone = 'dim' }: { text: string; tone?: 'dim' | 'ok' | 'warn' | 'danger' | 'accent' }) {
  const map = {
    dim: { bg: colors.bgElevated, fg: colors.dim },
    ok: { bg: '#1d2f1d', fg: colors.ok },
    warn: { bg: '#33291a', fg: colors.warn },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    accent: { bg: colors.accentSoft, fg: colors.accent },
  } as const;
  const c = map[tone];
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' }}>
      <Text style={{ color: c.fg, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Note({ children, tone = 'dim' }: { children: React.ReactNode; tone?: 'dim' | 'warn' | 'danger' }) {
  const color = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : colors.dim;
  return <Text style={{ color, fontSize: 13, lineHeight: 19 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { marginRight: space.md, paddingVertical: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
  },
  button: {
    borderRadius: radii.sm,
    paddingVertical: 11,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 7, paddingHorizontal: space.md },
  buttonText: { fontSize: 15, fontWeight: '600' },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 15,
  },
});
