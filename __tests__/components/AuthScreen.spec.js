// Render tests for the manager sign-in screen.
//
// This is now a secondary route (employees use EmployeeAccessScreen), reached
// via a link — so what matters is that it still authenticates correctly and that
// the way back to the employee flow is always available.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockSignIn = jest.fn();

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn, error: '' }),
}));

import AuthScreen from '../../src/screens/AuthScreen';

const fill = async (email, password) => {
  await act(async () => {
    if (email !== null)
      fireEvent.changeText(screen.getByPlaceholderText('Dealership email'), email);
    if (password !== null) fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
  });
};

const submit = async () => {
  await act(async () => {
    fireEvent.press(screen.getByText('Continue'));
  });
};

beforeEach(() => {
  mockSignIn.mockReset();
  mockSignIn.mockResolvedValue({ error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('AuthScreen (manager sign-in)', () => {
  it('asks for dealership email and password', async () => {
    await render(<AuthScreen />);
    expect(screen.getByPlaceholderText('Dealership email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('will not submit with an empty field', async () => {
    await render(<AuthScreen />);
    await submit();
    expect(mockSignIn).not.toHaveBeenCalled();

    await fill('manager@example.com', '');
    await submit();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('normalises the email before signing in', async () => {
    await render(<AuthScreen />);
    await fill('  Manager@Example.COM  ', 'hunter2');
    await submit();
    expect(mockSignIn).toHaveBeenCalledWith('manager@example.com', 'hunter2');
  });

  it('offers a way back to the employee invite flow', async () => {
    const onBack = jest.fn();
    await render(<AuthScreen onBack={onBack} />);
    await act(async () => {
      fireEvent.press(screen.getByText(/invite code/i));
    });
    expect(onBack).toHaveBeenCalled();
  });

  it('hides the back link when there is nowhere to go back to', async () => {
    await render(<AuthScreen />);
    expect(screen.queryByText(/invite code/i)).toBeNull();
  });
});
