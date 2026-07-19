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
import { useAuth } from '../context/AuthContext';

export default function ProfileSetupScreen() {
  const { profile, setProfileName, signOut } = useAuth();
  const [name, setName] = React.useState(profile?.full_name || '');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    const sanitized = name.trim();
    if (!sanitized) {
      Alert.alert('Name required', 'Enter your full name to continue.');
      return;
    }

    setSaving(true);
    try {
      await setProfileName(sanitized);
    } catch (error) {
      Alert.alert('Could not save profile', error?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Create User</Text>
        <Text style={styles.subtitle}>Create your detailer profile for this dealership.</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(text) => setName(text.slice(0, 50))}
          placeholder="Full name"
          autoCapitalize="words"
          editable={!saving}
        />

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleSave}
          disabled={saving || !name.trim()}
        >
          <Text style={styles.primaryButtonText}>{saving ? 'Creating...' : 'Create User'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={signOut} disabled={saving}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
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
  },
  input: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    fontSize: 16,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#667eea',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
