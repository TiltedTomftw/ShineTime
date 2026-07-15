import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function UserPinScreen({ onBackRole }) {
  const { activeOperationalRole, completeDealershipUserAccess, signOut } = useAuth();
  const [mode, setMode] = React.useState('login');
  const [name, setName] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await completeDealershipUserAccess({
        mode,
        name,
        pin,
      });
    } catch (error) {
      Alert.alert('User Access Failed', error?.message || 'Unknown error');
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
        <Text style={styles.title}>{mode === 'create' ? 'Create User' : 'User Login'}</Text>
        <Text style={styles.subtitle}>Role: {activeOperationalRole || 'unknown'}</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(text) => setName(text.slice(0, 50))}
          placeholder="User name"
          autoCapitalize="words"
          editable={!submitting}
        />

        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 8))}
          placeholder="PIN"
          keyboardType="number-pad"
          secureTextEntry
          editable={!submitting}
        />

        <TouchableOpacity
          style={[styles.primaryButton, (!name.trim() || pin.length < 4 || submitting) && styles.primaryDisabled]}
          onPress={handleSubmit}
          disabled={!name.trim() || pin.length < 4 || submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? 'Please wait...' : (mode === 'create' ? 'Create User' : 'Login')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={() => setMode(mode === 'create' ? 'login' : 'create')}>
          <Text style={styles.linkText}>{mode === 'create' ? 'Have a user already? Login' : 'Need a new user? Create one'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={onBackRole}>
          <Text style={styles.linkText}>Change role</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={signOut}>
          <Text style={styles.linkText}>Sign out dealership</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#667eea',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#e0e7ff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    textTransform: 'capitalize',
  },
  input: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#667eea',
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  linkText: {
    color: '#fff',
    fontWeight: '600',
  },
});