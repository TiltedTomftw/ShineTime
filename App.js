import React from 'react';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';

export default function App() {
  const [isOnboarded, setIsOnboarded] = React.useState(null);

  React.useEffect(() => {
    checkOnboarding();
  }, []);

  const checkOnboarding = async () => {
    const name = await AsyncStorage.getItem('@detailtracker_detailer_name');
    setIsOnboarded(!!name);
  };

  if (isOnboarded === null) {
    return null; // Loading
  }

  if (!isOnboarded) {
    return (
      <>
        <OnboardingScreen onComplete={() => setIsOnboarded(true)} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <AppNavigator />
      <StatusBar style="light" />
    </>
  );
}
