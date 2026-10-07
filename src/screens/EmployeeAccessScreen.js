import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import AuthLayout from '../components/AuthLayout';
import { Button, Field } from '../components/ui';
import { colors, radius, spacing, type } from '../theme';

// The employee entry point. Employees never see a dealership login: the
// `employee-access` Edge Function checks the code, signs them in (or creates
// their account), and returns a session.
//
// Two modes so returning staff aren't asked to "create" anything, and so a new
// name is confirmed before an account is made — typing "Mike Smith" when you
// joined as "Mike" must not silently create a second person.
const MODES = {
  signin: {
    tab: "I've signed in before",
    codeLabel: 'Dealership code',
    codeHint: 'Any invite code from your dealership works, even an old one.',
    pinLabel: 'Your PIN',
    submit: 'Sign in',
  },
  join: {
    tab: "I'm new here",
    codeLabel: 'Invite code',
    codeHint: 'Your manager gives you this.',
    pinLabel: 'Choose a PIN (4–6 digits)',
    submit: 'Join',
  },
};

export default function EmployeeAccessScreen({ onManagerSignIn }) {
  const [mode, setMode] = React.useState('signin');
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirming, setConfirming] = React.useState(null); // { dealershipName, name }
  const nameRef = React.useRef(null);
  const pinRef = React.useRef(null);

  const copy = MODES[mode];
  const canSubmit = code.trim().length >= 4 && name.trim().length > 0 && pin.length >= 4;

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setConfirming(null);
  };

  const submit = async (confirmNew = false) => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('employee-access', {
        body: { code: code.trim(), name: name.trim(), pin, mode, confirmNew },
      });

      // Non-2xx responses carry the function's own message.
      let message = data?.error;
      if (!message && fnError?.context?.json) {
        try {
          message = (await fnError.context.json())?.error;
        } catch {
          // fall through to the generic message
        }
      }
      if (!message && fnError?.context?.error) message = fnError.context.error;
      if (message) throw new Error(message);
      if (fnError) throw new Error("Can't reach Shinetime. Check your signal and try again.");

      if (data?.needsConfirm) {
        setConfirming({
          dealershipName: data.dealership?.name || 'this dealership',
          name: data.name,
        });
        return;
      }
      if (!data?.access_token) throw new Error('Could not start your session. Try again.');

      // Signing in flips AuthContext's onAuthStateChange, which opens the app.
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) throw sessionError;
    } catch (e) {
      const message = e?.message || 'Please check your code, name and PIN.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (confirming) {
    return (
      <AuthLayout subtitle="One more check">
        <Text style={styles.confirmTitle}>
          Join {confirming.dealershipName} as {confirming.name}?
        </Text>
        <Text style={styles.confirmBody}>
          Use this exact name every time you sign in. If you&apos;ve used Shinetime here before
          under a different name, go back and sign in with that name instead.
        </Text>
        <Button
          title={`Yes, I'm ${confirming.name}`}
          onPress={() => submit(true)}
          loading={submitting}
          style={styles.submit}
        />
        <Button title="Go back" variant="ghost" onPress={() => setConfirming(null)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      subtitle="Sign in to start detailing"
      footer={
        onManagerSignIn ? (
          <Pressable
            onPress={onManagerSignIn}
            accessibilityRole="button"
            style={styles.managerLink}
            hitSlop={8}
          >
            <Text style={styles.managerLinkText}>Manager sign-in</Text>
          </Pressable>
        ) : null
      }
    >
      <View style={styles.tabs} accessibilityRole="tablist">
        {Object.entries(MODES).map(([key, m]) => (
          <Pressable
            key={key}
            onPress={() => switchMode(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === key }}
            style={[styles.tab, mode === key && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === key && styles.tabTextActive]}>{m.tab}</Text>
          </Pressable>
        ))}
      </View>

      <Field
        label={copy.codeLabel}
        hint={copy.codeHint}
        value={code}
        onChangeText={(t) =>
          setCode(
            t
              .replace(/[^a-zA-Z0-9]/g, '')
              .toUpperCase()
              .slice(0, 12),
          )
        }
        placeholder="e.g. K7M3QPX"
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!submitting}
        inputStyle={styles.codeInput}
        returnKeyType="next"
        onSubmitEditing={() => nameRef.current?.focus()}
        testID="code-input"
      />
      <Field
        ref={nameRef}
        label="Your name"
        hint={
          mode === 'signin' ? 'Exactly as you entered it when you joined.' : 'First and last name.'
        }
        value={name}
        onChangeText={(t) => setName(t.slice(0, 50))}
        placeholder="e.g. Mike Smith"
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="name"
        textContentType="name"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => pinRef.current?.focus()}
        testID="name-input"
      />
      <Field
        ref={pinRef}
        label={copy.pinLabel}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
        placeholder="••••"
        keyboardType="number-pad"
        secureTextEntry
        editable={!submitting}
        returnKeyType="go"
        onSubmitEditing={() => submit(false)}
        error={error}
        testID="pin-input"
      />

      <Button
        title={copy.submit}
        onPress={() => submit(false)}
        disabled={!canSubmit}
        loading={submitting}
        style={styles.submit}
        testID="submit"
      />
      {mode === 'signin' ? (
        <Text style={styles.help}>Forgot your PIN? Your manager can reset it.</Text>
      ) : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.xl,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  tabTextActive: { color: colors.text },
  codeInput: { letterSpacing: 3, fontWeight: '600' },
  submit: { marginTop: spacing.sm },
  help: { ...type.footnote, textAlign: 'center', marginTop: spacing.lg },
  confirmTitle: { ...type.title, marginBottom: spacing.md },
  confirmBody: { ...type.callout, color: colors.textSecondary, lineHeight: 22 },
  // Kept well away from the form: employees are the audience here.
  managerLink: {
    marginTop: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  managerLinkText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
});
