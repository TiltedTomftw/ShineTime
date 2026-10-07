// Render tests for the manager sign-in screen (a secondary route reached from
// the employee screen).

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockSignIn = jest.fn();
let mockError = '';

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn, error: mockError }),
}));

import AuthScreen from '../../src/screens/AuthScreen';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const mount = (props = {}) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AuthScreen {...props} />
    </SafeAreaProvider>,
  );

const fill = async (email, password) => {
  await act(async () => {
    if (email !== null) fireEvent.changeText(screen.getByTestId('email-input'), email);
    if (password !== null) fireEvent.changeText(screen.getByTestId('password-input'), password);
  });
};

const submit = async () => {
  await act(async () => {
    fireEvent.press(screen.getByText('Sign in'));
  });
};

beforeEach(() => {
  mockSignIn.mockReset();
  mockSignIn.mockResolvedValue({ error: null });
  mockError = '';
});

describe('AuthScreen (manager sign-in)', () => {
  it("is labelled as the manager's own sign-in, not a shared dealership login", async () => {
    await mount();
    expect(screen.getByText('Manager sign-in')).toBeTruthy();
    expect(screen.queryByText(/Dealership Login/i)).toBeNull();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
  });

  it('will not submit with an empty field and says why', async () => {
    await mount();
    await fill('manager@example.com', '');
    await submit();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your email and password.')).toBeTruthy();
  });

  it('normalises the email before signing in', async () => {
    await mount();
    await fill('  Manager@Example.COM  ', 'hunter2');
    await submit();
    expect(mockSignIn).toHaveBeenCalledWith('manager@example.com', 'hunter2');
  });

  it('rewords the auth error for people', async () => {
    mockError = 'Invalid login credentials';
    await mount();
    expect(screen.getByText('That email and password don’t match.')).toBeTruthy();
  });

  it('offers a way back to the employee flow only when there is one', async () => {
    const onBack = jest.fn();
    const view = await mount({ onBack });
    await act(async () => {
      fireEvent.press(screen.getByText(/Sign in with your code/i));
    });
    expect(onBack).toHaveBeenCalled();
    await view.unmount();

    await mount();
    expect(screen.queryByText(/Sign in with your code/i)).toBeNull();
  });
});
