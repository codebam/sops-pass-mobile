import { Platform } from 'react-native';

export const colors = {
  bg: '#0b0e14',
  bgElevated: '#111725',
  card: '#151b26',
  border: '#232c3c',
  borderStrong: '#313d52',
  text: '#e7edf5',
  dim: '#8b98ab',
  faint: '#5b6678',
  accent: '#7aa2f7',
  accentSoft: '#1d2a44',
  danger: '#f7768e',
  dangerSoft: '#3a1f2a',
  ok: '#9ece6a',
  warn: '#e0af68',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radii = { sm: 8, md: 12, lg: 16 };

export const mono = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });

export const type = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  subtitle: { fontSize: 13, color: colors.dim },
  body: { fontSize: 15, color: colors.text },
  label: { fontSize: 12, color: colors.dim, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  mono: { fontFamily: mono, fontSize: 14, color: colors.text },
};

export const screenPadding = { padding: space.lg };
