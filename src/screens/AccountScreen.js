import React from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { outbox, flushOutbox } from '../services/outbox';
import { Button, Card, Notice } from '../components/ui';
import { colors, spacing, type } from '../theme';

// Managers do their managing on the web dashboard (they work at a desk); the
// app is the same "my cars" tool for everyone.
const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://tiltedtomftw.github.io/shinetime-dashboard/';

const ROLE_LABEL = { manager: 'Manager', detailer: 'Detailer', sales: 'Sales' };

// Who you are, where you're signed in, and sign-out — kept off the home screen
// so nobody logs out by accident (employees need their code + PIN to return).
export default function AccountScreen() {
  const {
    userName,
    activeDealership,
    activeOperationalRole,
    memberships,
    signOut,
    switchDealership,
    isManager,
  } = useAuth();
  const [pending, setPending] = React.useState(outbox.getState().pending);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => outbox.subscribe((s) => setPending(s.pending)), []);

  const doSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () => {
    const warning =
      pending > 0
        ? `${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached Shinetime yet. Signing out deletes ${pending === 1 ? 'it' : 'them'} from this phone.`
        : "You'll need your code, name and PIN to sign back in.";
    if (Platform.OS === 'web') {
      if (window.confirm(`Sign out?\n\n${warning}`)) doSignOut();
      return;
    }
    Alert.alert('Sign out?', warning, [
      { text: 'Cancel', style: 'cancel' },
      ...(pending > 0
        ? [{ text: 'Try sending first', onPress: () => flushOutbox().catch(() => {}) }]
        : []),
      { text: 'Sign out', style: 'destructive', onPress: doSignOut },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.name}>{userName}</Text>
        <Text style={styles.meta}>
          {`${ROLE_LABEL[activeOperationalRole] || activeOperationalRole} · ${activeDealership?.dealership?.name || ''}`}
        </Text>
      </Card>

      {isManager ? (
        <Notice tone="info">
          {`Team, rework, reports and invite codes are on the web dashboard: ${DASHBOARD_URL.replace(/^https?:\/\//, '')}`}
        </Notice>
      ) : null}

      {pending > 0 ? (
        <Notice tone="warning" action="Send now" onAction={() => flushOutbox().catch(() => {})}>
          {`${pending} change${pending === 1 ? '' : 's'} waiting to send.`}
        </Notice>
      ) : (
        <Notice tone="success">Everything is saved to Shinetime.</Notice>
      )}

      {memberships.length > 1 ? (
        <Button
          title="Switch dealership"
          icon="swap-horizontal"
          variant="secondary"
          onPress={switchDealership}
        />
      ) : null}

      <View style={styles.spacer} />
      <Button
        title="Sign out"
        icon="log-out-outline"
        variant="danger"
        onPress={confirmSignOut}
        loading={busy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.xs },
  name: { ...type.title },
  meta: { ...type.subhead },
  spacer: { height: spacing.xl },
});
