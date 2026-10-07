import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { Button, Field } from '../components/ui';
import { colors, spacing, type } from '../theme';

// Manager sign-in: the manager's own email + password.
export default function AuthScreen({ onBack }) {
  const { signIn, error } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [localError, setLocalError] = React.useState('');
  const passwordRef = React.useRef(null);

  const handleSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setLocalError('Enter your email and password.');
      return;
    }
    setLocalError('');
    setSubmitting(true);
    try {
      await signIn(normalizedEmail, password);
    } finally {
      setSubmitting(false);
    }
  };

  const shownError =
    localError ||
    (error && /invalid login/i.test(error) ? 'That email and password don’t match.' : error);

  return (
    <AuthLayout
      subtitle="Manager sign-in"
      footer={
        onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" style={styles.link} hitSlop={8}>
            <Text style={styles.linkText}>Detailer? Sign in with your code</Text>
          </Pressable>
        ) : null
      }
    >
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@dealership.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="email-input"
      />
      <Field
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        editable={!submitting}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        error={shownError}
        testID="password-input"
      />
      <Button title="Sign in" onPress={handleSubmit} loading={submitting} style={styles.submit} />
      <Text style={styles.help}>Forgot your password? Contact Shinetime support to reset it.</Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  submit: { marginTop: spacing.sm },
  help: { ...type.footnote, textAlign: 'center', marginTop: spacing.lg },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
  linkText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
});
