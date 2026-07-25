import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { subscribeSyncStatus } from '../services/storage';
import { describeSyncStatus } from '../services/jobLogic';

// Global, non-blocking notice that work hasn't reached the server yet. Sync
// failures were previously console-only, so a detailer could complete a car
// believing it was saved. Renders nothing when everything is synced.
export default function SyncStatusBanner() {
  const [status, setStatus] = React.useState({ pendingCount: 0, lastError: null });

  React.useEffect(() => subscribeSyncStatus(setStatus), []);

  const info = describeSyncStatus(status);
  if (!info) return null;

  return (
    <View
      style={[styles.banner, info.tone === 'error' ? styles.error : styles.warning]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{info.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  warning: { backgroundColor: '#f59e0b' },
  error: { backgroundColor: '#ef4444' },
  text: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
