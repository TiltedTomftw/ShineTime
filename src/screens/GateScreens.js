// Small screens the auth gate shows while it can't open the app yet.
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AuthLayout from '../components/AuthLayout';
import { Button } from '../components/ui';
import { colors, spacing, type } from '../theme';

export function SplashScreen() {
  return (
    <View style={styles.splash} accessibilityLabel="Loading Shinetime">
      <StatusBar style="light" />
      <Text style={styles.splashBrand}>Shinetime</Text>
      <ActivityIndicator color={colors.white} size="large" />
    </View>
  );
}

// Shown when the account couldn't be loaded — instead of wrongly telling a
// detailer they have no dealership.
export function ConnectionErrorScreen({ message, onRetry, onSignOut }) {
  const [busy, setBusy] = React.useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout subtitle="Can't reach Shinetime">
      <Text style={styles.body}>
        Check your Wi-Fi or cell signal and try again. Anything you already recorded on this phone
        is kept until it sends.
      </Text>
      {message ? <Text style={styles.detail}>Details: {message}</Text> : null}
      <Button title="Try again" icon="refresh" onPress={retry} loading={busy} style={styles.gap} />
      <Button title="Sign out" variant="ghost" onPress={onSignOut} />
    </AuthLayout>
  );
}

export function NoAccessScreen({ onJoin, onSignOut }) {
  return (
    <AuthLayout subtitle="No active dealership">
      <Text style={styles.body}>
        Your account isn&apos;t active at a dealership right now. Ask your manager for a new invite
        code.
      </Text>
      <Button title="Enter an invite code" onPress={onJoin} style={styles.gap} />
      <Button title="Sign out" variant="ghost" onPress={onSignOut} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  splashBrand: { fontSize: 34, fontWeight: '800', color: colors.white },
  body: { ...type.callout, color: colors.text, lineHeight: 22 },
  detail: { ...type.footnote, marginTop: spacing.md },
  gap: { marginTop: spacing.xl, marginBottom: spacing.sm },
});
