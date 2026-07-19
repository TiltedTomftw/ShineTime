import React from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Owner/manager tool: mint an invite code for the active dealership to share
// with staff. Depends on migration 004's generate_invite_code RPC.
const ROLES = ['detailer', 'sales', 'manager'];

export default function ManageInviteCodesScreen({ onBack }) {
  const { activeDealership } = useAuth();
  const [role, setRole] = React.useState('detailer');
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const dealershipId = activeDealership?.dealershipId;

  const handleGenerate = async () => {
    if (!dealershipId) {
      Alert.alert('No dealership', 'Select a dealership first.');
      return;
    }
    setLoading(true);
    setCode('');
    try {
      const { data, error } = await supabase.rpc('generate_invite_code', {
        p_dealership_id: dealershipId,
        p_role: role,
      });
      if (error) throw error;
      setCode(data);
    } catch (error) {
      Alert.alert('Could not generate code', error?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Invite Team</Text>
      <Text style={styles.subtitle}>{activeDealership?.dealership?.name || 'This dealership'}</Text>

      <Text style={styles.label}>Role for this code</Text>
      <View style={styles.roleRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
            onPress={() => setRole(r)}
            disabled={loading}
          >
            <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.disabled]}
        onPress={handleGenerate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#667eea" />
        ) : (
          <Text style={styles.primaryButtonText}>Generate Code</Text>
        )}
      </TouchableOpacity>

      {!!code && (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Share this code</Text>
          <Text selectable style={styles.codeValue}>
            {code}
          </Text>
          <Text style={styles.codeHint}>Expires in 7 days. Staff enter it on the Join screen.</Text>
        </View>
      )}

      {onBack && (
        <TouchableOpacity style={styles.linkBtn} onPress={onBack}>
          <Text style={styles.linkText}>Back</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#333', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, color: '#666', marginBottom: 8 },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  roleChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  roleChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  roleChipText: { color: '#555', textTransform: 'capitalize', fontWeight: '600' },
  roleChipTextActive: { color: '#fff' },
  primaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#667eea',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: '#667eea', fontWeight: 'bold', fontSize: 16 },
  codeCard: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  codeLabel: { fontSize: 12, color: '#666' },
  codeValue: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#333',
    letterSpacing: 4,
    marginVertical: 8,
  },
  codeHint: { fontSize: 12, color: '#999', textAlign: 'center' },
  linkBtn: { marginTop: 18, alignItems: 'center' },
  linkText: { color: '#667eea', fontWeight: '600' },
});
