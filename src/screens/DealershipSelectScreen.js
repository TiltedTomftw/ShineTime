import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function DealershipSelectScreen({ memberships, onSelect, onSignOut }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Dealership</Text>
      <Text style={styles.subtitle}>Choose where you are working today.</Text>

      <FlatList
        data={memberships}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => onSelect(item.dealershipId)}>
            <Text style={styles.name}>{item.dealership?.name || 'Unnamed Dealership'}</Text>
            <Text style={styles.meta}>Role: {item.role}</Text>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    color: '#666',
    marginTop: 4,
    marginBottom: 18,
  },
  list: {
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  meta: {
    marginTop: 4,
    color: '#666',
    textTransform: 'capitalize',
  },
  signOutBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: {
    color: '#667eea',
    fontWeight: '700',
  },
});