import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import DealershipSelectScreen from './src/screens/DealershipSelectScreen';
import EmployeeAccessScreen from './src/screens/EmployeeAccessScreen';
import CreateDealershipScreen from './src/screens/CreateDealershipScreen';
import JoinByCodeScreen from './src/screens/JoinByCodeScreen';
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
  const { session, memberships, activeDealership, isLoading, signOut, selectActiveDealership } =
    useAuth();
  const [showJoin, setShowJoin] = React.useState(false);
  const [showManagerSignIn, setShowManagerSignIn] = React.useState(false);

  if (isLoading) {
    return null; // Loading
  }

  // Employees are the overwhelming majority of users and must never see the
  // dealership's credentials, so the invite-code screen is the default entry
  // point. Managers reach the email/password form via a small link.
  if (!session) {
    return showManagerSignIn ? (
      <AuthScreen onBack={() => setShowManagerSignIn(false)} />
    ) : (
      <EmployeeAccessScreen onManagerSignIn={() => setShowManagerSignIn(true)} />
    );
  }

  if (!memberships || memberships.length === 0) {
    // No dealership yet: create one (become owner) or join by invite code.
    return showJoin ? (
      <JoinByCodeScreen onBack={() => setShowJoin(false)} />
    ) : (
      <CreateDealershipScreen onBack={() => setShowJoin(true)} />
    );
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

  // No separate name+PIN step any more: the signed-in account IS the person, so
  // identity now follows them across devices instead of living on one phone.
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
