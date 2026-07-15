import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import DealershipSelectScreen from './src/screens/DealershipSelectScreen';
import RoleSelectionScreen from './src/screens/RoleSelectionScreen';
import UserPinScreen from './src/screens/UserPinScreen';
import { AuthProvider, useAuth } from './src/context/AuthContext';

function NoAccessScreen({ onSignOut }) {
  return (
    <View style={styles.centeredContainer}>
      <Text style={styles.noAccessTitle}>No Dealership Access</Text>
      <Text style={styles.noAccessBody}>
        Your account is signed in but not assigned to an active dealership.
      </Text>
      <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function AppEntry() {
  const {
    session,
    memberships,
    activeDealership,
    activeOperationalRole,
    hasCompletedDetailerSetup,
    isLoading,
    signOut,
    selectActiveDealership,
    selectOperationalRole,
  } = useAuth();

  if (isLoading) {
    return null; // Loading
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!memberships || memberships.length === 0) {
    return <NoAccessScreen onSignOut={signOut} />;
  }

  if (!activeDealership) {
    return (
      <DealershipSelectScreen
        memberships={memberships}
        onSelect={selectActiveDealership}
        onSignOut={signOut}
      />
    );
  }

  if (!activeOperationalRole) {
    return (
      <RoleSelectionScreen
        onSelectRole={selectOperationalRole}
        onSignOut={signOut}
      />
    );
  }

  if (!hasCompletedDetailerSetup) {
    return <UserPinScreen onBackRole={() => selectOperationalRole('')} />;
  }

  return <AppNavigator />;
}

export default function App() {
  return (
    <>
      <AuthProvider>
        <AppEntry />
      </AuthProvider>
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  noAccessTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  noAccessBody: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  signOutButton: {
    marginTop: 22,
    backgroundColor: '#667eea',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  signOutButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
