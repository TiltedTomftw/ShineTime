import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { outbox, subscribeOnline, flushOutbox } from '../services/outbox';
import { describeOutbox } from '../services/jobLogic';
import { colors, spacing } from '../theme';

const TONES = {
  info: { bg: colors.accent, icon: 'cloud-upload-outline' },
  warning: { bg: colors.pause, icon: 'cloud-offline-outline' },
  error: { bg: colors.danger, icon: 'alert-circle-outline' },
};

// Sits below the screens (in the layout, not over them) and tells the detailer
// when work hasn't reached Supabase yet — or couldn't be saved at all.
export default function OutboxBanner() {
  const insets = useSafeAreaInsets();
  const [state, setState] = React.useState(outbox.getState());
  const [online, setOnline] = React.useState(true);
  // Don't flash "Sending…" for the half-second a normal send takes: only show
  // pending work once something has been waiting for 1.5s.
  const [settled, setSettled] = React.useState(false);

  React.useEffect(() => {
    let timer = null;
    const unsubscribe = outbox.subscribe((next) => {
      setState(next);
      if (next.pending === 0) {
        clearTimeout(timer);
        timer = null;
        setSettled(false);
      } else if (!timer) {
        timer = setTimeout(() => setSettled(true), 1500);
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  React.useEffect(() => subscribeOnline(setOnline), []);

  const info = describeOutbox({
    pending: settled ? state.pending : 0,
    failures: state.failures,
    online,
  });
  if (!info) return null;
  const tone = TONES[info.tone] || TONES.info;

  const onAction = () => {
    if (info.tone === 'error') outbox.dismissFailure(state.failures[0]?.id);
    else flushOutbox().catch(() => {});
  };

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: tone.bg, paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={tone.icon} size={20} color={colors.white} />
      <Text style={styles.text}>{info.message}</Text>
      {info.action && (online || info.tone === 'error') ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={10} style={styles.action}>
          <Text style={styles.actionText}>{info.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  text: { flex: 1, color: colors.white, fontSize: 15, fontWeight: '600' },
  action: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  actionText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
