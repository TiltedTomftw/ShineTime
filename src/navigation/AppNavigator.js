import React from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OutboxBanner from '../components/OutboxBanner';
import HomeScreen from '../screens/HomeScreen';
import NewJobScreen from '../screens/NewJobScreen';
import HistoryScreen from '../screens/HistoryScreen';
import JobDetailScreen from '../screens/JobDetailScreen';
import ManageInviteCodesScreen from '../screens/ManageInviteCodesScreen';
import AccountScreen from '../screens/AccountScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.separator,
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="dark" />
      <View style={styles.root}>
        <View style={styles.root}>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.accent,
              headerTitleStyle: { color: colors.text, fontWeight: '600' },
              headerShadowVisible: false,
              headerBackTitle: 'Back',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="NewJob"
              component={NewJobScreen}
              options={{ title: 'Start a car' }}
            />
            <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: '' }} />
            <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
            <Stack.Screen
              name="ManageInviteCodes"
              component={ManageInviteCodesScreen}
              options={{ title: 'Invite your team' }}
            />
            <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
          </Stack.Navigator>
        </View>
        {/* In the layout (not floating over buttons): tells the detailer when
            work hasn't reached Supabase yet, or couldn't be saved. */}
        <OutboxBanner />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
