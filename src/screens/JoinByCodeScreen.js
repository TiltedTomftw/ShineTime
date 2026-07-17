import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Self-serve: a signed-in user redeems an invite code to join a dealership.
// After success, refreshMemberships() drives the existing AppEntry flow.
export default function JoinByCodeScreen({ onDone, onBack }) {
  const { refreshMemberships, signOut } = useAuth();
  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 4) {
      Alert.alert('Invalid code', 'Enter the invite code from your manager.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('redeem_invite_code', { p_code: normalized });
      // A thrown error means signed-out or rate-limited; a null result is any
      // bad/expired/exhausted code, kept deliberately indistinguishable.
      if (error) throw error;
      if (!data) throw new Error('Invalid or expired invite code');
      await refreshMemberships();
      if (onDone) onDone();
    } catch (error) {
      Alert.alert('Could not join', error?.message || 'Invalid or expired invite code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <Text style={styles.title}>Join Dealership</Text>
        <Text style={styles.subtitle}>Enter the invite code your manager gave you.</Text>

        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12))}
          placeholder="Invite code"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!submitting}
        />

        <TouchableOpacity
          style={[styles.primaryButton, (code.trim().length < 4 || submitting) && styles.disabled]}
          onPress={handleSubmit}
          disabled={code.trim().length < 4 || submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? 'Joining...' : 'Join'}</Text>
        </TouchableOpacity>

        {onBack && (
          <TouchableOpacity style={styles.linkBtn} onPress={onBack}>
            <Text style={styles.linkText}>Need to create a dealership? Create</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.linkBtn} onPress={signOut}>
          <Text style={styles.linkText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#667eea' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#e0e7ff', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: '#fff', padding: 14, borderRadius: 10, fontSize: 18, letterSpacing: 2, textAlign: 'center', marginBottom: 12 },
  primaryButton: { backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 6 },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: '#667eea', fontWeight: 'bold', fontSize: 16 },
  linkBtn: { marginTop: 14, alignItems: 'center' },
  linkText: { color: '#fff', fontWeight: '600' },
});
