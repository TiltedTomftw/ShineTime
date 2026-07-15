import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Self-serve: a signed-in user creates a dealership and becomes its owner.
// After success, refreshMemberships() drives the existing AppEntry flow
// (auto-selects the new dealership when it is the user's only one).
export default function CreateDealershipScreen({ onDone, onBack }) {
  const { refreshMemberships, signOut } = useAuth();
  const [name, setName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Enter a dealership name.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('create_dealership', { p_name: trimmed });
      if (error) throw error;
      await refreshMemberships();
      if (onDone) onDone();
    } catch (error) {
      Alert.alert('Could not create dealership', error?.message || 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <Text style={styles.title}>Create Dealership</Text>
        <Text style={styles.subtitle}>You'll be the owner and can invite your team.</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(t) => setName(t.slice(0, 80))}
          placeholder="Dealership name"
          autoCapitalize="words"
          editable={!submitting}
        />

        <TouchableOpacity
          style={[styles.primaryButton, (!name.trim() || submitting) && styles.disabled]}
          onPress={handleSubmit}
          disabled={!name.trim() || submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? 'Creating...' : 'Create Dealership'}</Text>
        </TouchableOpacity>

        {onBack && (
          <TouchableOpacity style={styles.linkBtn} onPress={onBack}>
            <Text style={styles.linkText}>Have an invite code instead? Join</Text>
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
  input: { backgroundColor: '#fff', padding: 14, borderRadius: 10, fontSize: 16, marginBottom: 12 },
  primaryButton: { backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 6 },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: '#667eea', fontWeight: 'bold', fontSize: 16 },
  linkBtn: { marginTop: 14, alignItems: 'center' },
  linkText: { color: '#fff', fontWeight: '600' },
});
