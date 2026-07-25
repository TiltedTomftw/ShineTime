// Render tests for the employee entry screen.
//
// This is the first thing an employee ever sees, and it must never expose the
// dealership login. What's verified here is the wiring the unit tests can't
// reach: the submit gate, what actually gets sent to the Edge Function, that a
// returned session is applied, and that failures surface instead of hanging.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockInvoke = jest.fn();
const mockSetSession = jest.fn();

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args) => mockInvoke(...args) },
    auth: { setSession: (...args) => mockSetSession(...args) },
  },
}));

import EmployeeAccessScreen from '../../src/screens/EmployeeAccessScreen';

const fill = async (code, name, pin) => {
  await act(async () => {
    if (code !== null) fireEvent.changeText(screen.getByPlaceholderText('Invite code'), code);
    if (name !== null) fireEvent.changeText(screen.getByPlaceholderText('Your name'), name);
    if (pin !== null) fireEvent.changeText(screen.getByPlaceholderText(/Create a PIN/), pin);
  });
};

const submit = async () => {
  await act(async () => {
    fireEvent.press(screen.getByText('Start Detailing'));
  });
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockSetSession.mockReset();
  mockInvoke.mockResolvedValue({
    data: { access_token: 'at', refresh_token: 'rt', dealership: { name: 'Ford' } },
    error: null,
  });
  mockSetSession.mockResolvedValue({ error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('EmployeeAccessScreen', () => {
  it('never shows a dealership email or password field', async () => {
    await render(<EmployeeAccessScreen />);
    expect(screen.queryByPlaceholderText(/email/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/^Password$/i)).toBeNull();
  });

  it('does not submit until code, name and PIN are all provided', async () => {
    await render(<EmployeeAccessScreen />);

    await submit(); // nothing filled in
    expect(mockInvoke).not.toHaveBeenCalled();

    await fill('ABC1234', '', '');
    await submit();
    expect(mockInvoke).not.toHaveBeenCalled();

    await fill(null, 'Alex', '12'); // PIN too short
    await submit();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('sends the code, name and PIN to the employee-access function', async () => {
    await render(<EmployeeAccessScreen />);
    await fill('abc1234', 'Alex', '1234');
    await submit();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fn, options] = mockInvoke.mock.calls[0];
    expect(fn).toBe('employee-access');
    expect(options.body).toEqual({ code: 'ABC1234', name: 'Alex', pin: '1234' });
  });

  it('applies the returned session so the app can continue', async () => {
    await render(<EmployeeAccessScreen />);
    await fill('ABC1234', 'Alex', '1234');
    await submit();

    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it("surfaces the function's error and does not sign in", async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'That invite code is not valid or has expired.' },
      error: null,
    });
    await render(<EmployeeAccessScreen />);
    await fill('BADCODE', 'Alex', '1234');
    await submit();

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Could not sign in',
      'That invite code is not valid or has expired.',
    );
  });

  it('normalises the code to uppercase and strips punctuation', async () => {
    await render(<EmployeeAccessScreen />);
    await fill('ab-c 12/34', 'Alex', '1234');
    expect(screen.getByPlaceholderText('Invite code').props.value).toBe('ABC1234');
  });

  it('keeps the PIN numeric only', async () => {
    await render(<EmployeeAccessScreen />);
    await fill('ABC1234', 'Alex', '12ab34');
    expect(screen.getByPlaceholderText(/Create a PIN/).props.value).toBe('1234');
  });

  it('offers a manager sign-in link only when a handler is supplied', async () => {
    const onManagerSignIn = jest.fn();
    const view = await render(<EmployeeAccessScreen onManagerSignIn={onManagerSignIn} />);
    await act(async () => {
      fireEvent.press(screen.getByText('Manager sign-in'));
    });
    expect(onManagerSignIn).toHaveBeenCalled();
    await view.unmount();

    await render(<EmployeeAccessScreen />);
    expect(screen.queryByText('Manager sign-in')).toBeNull();
  });
});
