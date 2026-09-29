import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state/AppContext';
import { colors } from '../ui/theme';

// The navigator's own backdrop is visible during push/pop transitions — the
// default (light) navigation theme flashes white on Android while going back,
// so every theme color here has to be the app background.
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

export default function RootLayout() {
  useEffect(() => {
    // Root view / window background on Android — the area behind screens during
    // transitions. Matches android:windowBackground written at prebuild time.
    if (Platform.OS !== 'web') void SystemUI.setBackgroundColorAsync(colors.bg);
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <AppProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'slide_from_right',
            }}
          />
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
