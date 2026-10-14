import React from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import { Button, Field } from '../components/ui';
import { spacing } from '../theme';

// A signed-in person with no active dealership redeems a new invite code.
export default function JoinByCodeScreen({ onBack }) {
  const { refreshMemberships } = useAuth();
  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async () => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 4 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('redeem_invite_code', { p_code: normalized });
      if (rpcError) throw rpcError;
      await refreshMemberships();
    } catch {
      // The RPC deliberately returns one generic error for any bad code.
      setError("That code isn't valid or has expired. Ask your manager for a new one.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout subtitle="Join a dealership">
      <Field
        label="Invite code"
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
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        error={error}
        inputStyle={{ letterSpacing: 3, fontWeight: '600' }}
      />
      <Button
        title="Join"
        onPress={handleSubmit}
        disabled={code.trim().length < 4}
        loading={submitting}
        style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}
      />
      {onBack ? <Button title="Back" variant="ghost" onPress={onBack} /> : null}
    </AuthLayout>
  );
}
