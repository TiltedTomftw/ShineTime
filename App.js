import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import DealershipSelectScreen from './src/screens/DealershipSelectScreen';
import EmployeeAccessScreen from './src/screens/EmployeeAccessScreen';
import JoinByCodeScreen from './src/screens/JoinByCodeScreen';
import { SplashScreen, ConnectionErrorScreen, NoAccessScreen } from './src/screens/GateScreens';
import { AuthProvider, useAuth } from './src/context/AuthContext';

// Gate: session → account loaded → dealership → app.
function AppEntry() {
  const {
    session,
    memberships,
    activeDealership,
    isLoading,
    servicesReady,
    loadError,
    retryLoad,
    signOut,
    selectActiveDealership,
  } = useAuth();
  const [showJoin, setShowJoin] = React.useState(false);
  const [showManagerSignIn, setShowManagerSignIn] = React.useState(false);

  if (isLoading) return <SplashScreen />;

  // Employees are the majority and must never see a dealership login, so the
  // code + name + PIN screen is the default. Managers use a small link.
  if (!session) {
    return showManagerSignIn ? (
      <AuthScreen onBack={() => setShowManagerSignIn(false)} />
    ) : (
      <EmployeeAccessScreen onManagerSignIn={() => setShowManagerSignIn(true)} />
    );
  }

  // Couldn't load the account (no signal, server trouble): say so and offer
  // Retry, rather than assuming the person has no dealership.
  if (loadError) {
    return <ConnectionErrorScreen message={loadError} onRetry={retryLoad} onSignOut={signOut} />;
  }

  if (!memberships || memberships.length === 0) {
    return showJoin ? (
      <JoinByCodeScreen onBack={() => setShowJoin(false)} />
    ) : (
      <NoAccessScreen onJoin={() => setShowJoin(true)} onSignOut={signOut} />
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

  if (!servicesReady) return <SplashScreen />;

  return <AppNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppEntry />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
