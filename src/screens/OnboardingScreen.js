import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function OnboardingScreen({ onComplete }) {
  const [name, setName] = React.useState('');

  const handleSubmit = async () => {
    const sanitizedName = name.trim().slice(0, 50).replace(/<[^>]*>/g, '');
    if (sanitizedName) {
      await AsyncStorage.setItem('@detailtracker_detailer_name', sanitizedName);
      onComplete();
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Shinetime</Text>
        <Text style={styles.subtitle}>Let's get you set up</Text>
        
        <Text style={styles.label}>What's your name?</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(text) => setName(text.slice(0, 50))}
          placeholder="Enter your name"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          maxLength={50}
        />

        <TouchableOpacity 
          style={[styles.button, !name.trim() && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!name.trim()}
        >
          <Text style={styles.buttonText}>Get Started</Text>
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
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: '#e0e7ff',
    marginBottom: 60,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    fontSize: 18,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    backgroundColor: '#c7d2fe',
    opacity: 0.6,
  },
  buttonText: {
    color: '#667eea',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
