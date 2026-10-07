// Render tests for the employee entry screen — the first thing an employee
// sees. It must never expose a dealership login, must send the right mode to
// the Edge Function, must confirm a NEW name before creating an account, and
// must show failures instead of hanging.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockInvoke = jest.fn();
const mockSetSession = jest.fn();

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args) => mockInvoke(...args) },
    auth: { setSession: (...args) => mockSetSession(...args) },
  },
}));

import EmployeeAccessScreen from '../../src/screens/EmployeeAccessScreen';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const mount = (props = {}) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <EmployeeAccessScreen {...props} />
    </SafeAreaProvider>,
  );

const fill = async (code, name, pin) => {
  await act(async () => {
    if (code !== null) fireEvent.changeText(screen.getByTestId('code-input'), code);
    if (name !== null) fireEvent.changeText(screen.getByTestId('name-input'), name);
    if (pin !== null) fireEvent.changeText(screen.getByTestId('pin-input'), pin);
  });
};

const press = async (text) => {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
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
});

describe('EmployeeAccessScreen', () => {
  it('never shows a dealership email or password field', async () => {
    await mount();
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.queryByText(/^Password$/i)).toBeNull();
  });

  it('opens on "signed in before" so returning staff are not asked to create anything', async () => {
    await mount();
    expect(screen.getByText('Your PIN')).toBeTruthy();
    expect(screen.queryByText(/Choose a PIN/)).toBeNull();
  });

  it('labels stay visible (no placeholder-only fields)', async () => {
    await mount();
    expect(screen.getByText('Dealership code')).toBeTruthy();
    expect(screen.getByText('Your name')).toBeTruthy();
  });

  it('does not submit until code, name and a 4+ digit PIN are provided', async () => {
    await mount();
    await press('Sign in');
    expect(mockInvoke).not.toHaveBeenCalled();

    await fill('ABC1234', 'Alex', '12');
    await press('Sign in');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('sends a sign-in request and applies the returned session', async () => {
    await mount();
    await fill('abc1234', 'Alex', '1234');
    await press('Sign in');

    const [fn, options] = mockInvoke.mock.calls[0];
    expect(fn).toBe('employee-access');
    expect(options.body).toEqual({
      code: 'ABC1234',
      name: 'Alex',
      pin: '1234',
      mode: 'signin',
      confirmNew: false,
    });
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('asks a new person to confirm their name before an account is created', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { needsConfirm: true, dealership: { name: 'Ford Motors' }, name: 'Mike Smith' },
      error: null,
    });
    await mount();
    await press("I'm new here");
    await fill('ABC1234', 'Mike Smith', '1234');
    await press('Join');

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(screen.getByText('Join Ford Motors as Mike Smith?')).toBeTruthy();

    await press("Yes, I'm Mike Smith");
    const [, options] = mockInvoke.mock.calls[1];
    expect(options.body).toMatchObject({ mode: 'join', confirmNew: true });
    expect(mockSetSession).toHaveBeenCalled();
  });

  it("shows the function's error inline and does not sign in", async () => {
    mockInvoke.mockResolvedValue({ data: { error: "That code isn't valid." }, error: null });
    await mount();
    await fill('BADCODE', 'Alex', '1234');
    await press('Sign in');

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(screen.getByText("That code isn't valid.")).toBeTruthy();
  });

  it('normalises the code and keeps the PIN numeric', async () => {
    await mount();
    await fill('ab-c 12/34', 'Alex', '12ab34');
    expect(screen.getByTestId('code-input').props.value).toBe('ABC1234');
    expect(screen.getByTestId('pin-input').props.value).toBe('1234');
  });

  it('offers a manager sign-in link only when a handler is supplied', async () => {
    const onManagerSignIn = jest.fn();
    const view = await mount({ onManagerSignIn });
    await press('Manager sign-in');
    expect(onManagerSignIn).toHaveBeenCalled();
    await view.unmount();

    await mount();
    expect(screen.queryByText('Manager sign-in')).toBeNull();
  });
});
