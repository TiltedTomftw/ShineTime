import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

// The employee entry point: an invite code, their name, and a PIN. Employees
// never see the dealership's email/password — the `employee-access` Edge
// Function validates the code, creates (or signs in) their own account, and
// redeems the code on their behalf.
//
// The same three fields cover a first-time join AND a later sign-in, including
// on a new device, because the function derives the same account either way.
export default function EmployeeAccessScreen({ onManagerSignIn }) {
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const canSubmit = code.trim().length >= 4 && name.trim().length > 0 && pin.trim().length >= 4;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-access', {
        body: { code: code.trim(), name: name.trim(), pin: pin.trim() },
      });

      // Non-2xx responses surface the function's message rather than a generic one.
      const message = data?.error || error?.context?.error;
      if (message) throw new Error(message);
      if (error) throw error;
      if (!data?.access_token) throw new Error('Could not start your session.');

      // Signing in flips AuthContext's onAuthStateChange, which loads memberships
      // and drops the app straight onto the detailer home screen.
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) throw sessionError;
    } catch (e) {
      Alert.alert('Could not sign in', e?.message || 'Please check your code, name and PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Shinetime</Text>
        <Text style={styles.subtitle}>Enter the invite code from your manager.</Text>

        <TextInput
          style={[styles.input, styles.codeInput]}
          value={code}
          onChangeText={(t) =>
            setCode(
              t
                .replace(/[^a-zA-Z0-9]/g, '')
                .toUpperCase()
                .slice(0, 12),
            )
          }
          placeholder="Invite code"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!submitting}
        />
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(t) => setName(t.slice(0, 50))}
          placeholder="Your name"
          autoCapitalize="words"
          autoCorrect={false}
          editable={!submitting}
        />
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
          placeholder="Create a PIN (4-6 digits)"
          keyboardType="number-pad"
          secureTextEntry
          editable={!submitting}
        />

        <TouchableOpacity
          style={[styles.primaryButton, (!canSubmit || submitting) && styles.disabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          <Text style={styles.primaryButtonText}>
            {submitting ? 'Please wait...' : 'Start Detailing'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Returning? Enter the same code, name and PIN to sign back in.
        </Text>

        {onManagerSignIn && (
          <TouchableOpacity style={styles.linkBtn} onPress={onManagerSignIn}>
            <Text style={styles.linkText}>Manager sign-in</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#667eea' },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#e0e7ff', textAlign: 'center', marginBottom: 24 },
  input: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  codeInput: { fontSize: 18, letterSpacing: 2, textAlign: 'center' },
  primaryButton: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: '#667eea', fontWeight: 'bold', fontSize: 16 },
  hint: { color: '#e0e7ff', fontSize: 13, textAlign: 'center', marginTop: 14 },
  linkBtn: { marginTop: 22, alignItems: 'center' },
  linkText: { color: '#fff', fontWeight: '600' },
});
