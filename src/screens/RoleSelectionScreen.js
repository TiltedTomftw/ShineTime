import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const roles = [
  { id: 'detailer', label: 'Detailer', description: 'Track and complete detailing jobs' },
  { id: 'manager', label: 'Manager', description: 'View dealership-wide jobs and oversight' },
  { id: 'sales', label: 'Sales', description: 'View handoff and delivery status' },
];

export default function RoleSelectionScreen({ onSelectRole, onSignOut }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Role</Text>
      <Text style={styles.subtitle}>Choose the role you are using for this shift.</Text>

      <View style={styles.list}>
        {roles.map((role) => (
          <TouchableOpacity key={role.id} style={styles.card} onPress={() => onSelectRole(role.id)}>
            <Text style={styles.cardTitle}>{role.label}</Text>
            <Text style={styles.cardText}>{role.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
        <Text style={styles.signOutText}>Sign out dealership</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 20,
    paddingTop: 64,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    marginTop: 6,
    color: '#666',
    marginBottom: 18,
  },
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  cardText: {
    marginTop: 4,
    color: '#666',
  },
  signOutButton: {
    marginTop: 22,
    alignItems: 'center',
  },
  signOutText: {
    color: '#667eea',
    fontWeight: '700',
  },
});