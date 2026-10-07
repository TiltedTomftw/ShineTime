import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { alertMessage, confirmAction } from '../components/alerts';
import { Button, Card, Notice, SectionLabel } from '../components/ui';
import { formatWhen } from '../services/timeMath';
import { colors, radius, spacing, type } from '../theme';

// Managers mint invite codes for staff, share them, and revoke unused ones.
const ROLES = [
  { key: 'detailer', label: 'Detailer' },
  { key: 'manager', label: 'Manager' },
];

const shareText = (dealershipName, code, expiresAt) =>
  `Join ${dealershipName} on Shinetime: open the app, tap "I'm new here", and enter code ${code}.` +
  (expiresAt ? ` The code works until ${new Date(expiresAt).toLocaleDateString()}.` : '');

export default function ManageInviteCodesScreen() {
  const { activeDealership } = useAuth();
  const dealershipId = activeDealership?.dealershipId;
  const dealershipName = activeDealership?.dealership?.name || 'our dealership';
  const [role, setRole] = React.useState('detailer');
  const [latest, setLatest] = React.useState(null); // { code, role, expiresAt }
  const [codes, setCodes] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState('');

  const loadCodes = React.useCallback(async () => {
    if (!dealershipId) return;
    const { data, error: loadError } = await supabase
      .from('dealership_invite_codes')
      .select('id, code, role, expires_at, used_count, max_uses, created_at')
      .eq('dealership_id', dealershipId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    if (loadError) {
      setError("Couldn't load your open codes.");
      return;
    }
    setError('');
    setCodes(data || []);
  }, [dealershipId]);

  useFocusEffect(
    React.useCallback(() => {
      loadCodes();
    }, [loadCodes]),
  );

  const generate = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const { data, error: rpcError } = await supabase.rpc('generate_invite_code', {
        p_dealership_id: dealershipId,
        p_role: role,
      });
      if (rpcError) throw rpcError;
      setLatest({ code: data, role, expiresAt: Date.now() + 7 * 86400000 });
      loadCodes();
    } catch (e) {
      alertMessage("Couldn't make a code", e?.message || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code) => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
    } catch {
      alertMessage('Copy failed', `The code is ${code}.`);
    }
  };

  const share = async (code, expiresAt) => {
    try {
      await Share.share({ message: shareText(dealershipName, code, expiresAt) });
    } catch {
      copy(code);
    }
  };

  const revoke = (item) => {
    confirmAction({
      title: `Turn off ${item.code}?`,
      message: 'Nobody new can join with it. People who already joined are not affected.',
      confirmText: 'Turn off',
      destructive: true,
      onConfirm: async () => {
        const { error: updateError } = await supabase
          .from('dealership_invite_codes')
          .update({ is_active: false })
          .eq('id', item.id);
        if (updateError) alertMessage("Couldn't turn it off", updateError.message);
        if (latest?.code === item.code) setLatest(null);
        loadCodes();
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Each person joins with a code, their own name and their own PIN. Codes work for 7 days and
        can be used by several people.
      </Text>

      <SectionLabel>New code for a</SectionLabel>
      <View style={styles.roles} accessibilityRole="radiogroup">
        {ROLES.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => setRole(r.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: role === r.key }}
            style={[styles.role, role === r.key && styles.roleOn]}
          >
            <Text style={[styles.roleText, role === r.key && styles.roleTextOn]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      {role === 'manager' ? (
        <Notice tone="warning">Managers can see every job and invite others.</Notice>
      ) : null}
      <Button
        title="Make a code"
        icon="key-outline"
        onPress={generate}
        loading={busy}
        style={styles.gap}
      />

      {latest ? (
        <Card style={styles.codeCard}>
          <Text
            style={styles.codeLabel}
          >{`${latest.role === 'manager' ? 'Manager' : 'Detailer'} code`}</Text>
          <Text
            selectable
            style={styles.code}
            accessibilityLabel={`Code ${latest.code.split('').join(' ')}`}
          >
            {latest.code}
          </Text>
          <View style={styles.row}>
            <Button
              title={copied ? 'Copied' : 'Copy'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              variant="secondary"
              onPress={() => copy(latest.code)}
              style={styles.flex}
            />
            <Button
              title="Share"
              icon="share-outline"
              onPress={() => share(latest.code, latest.expiresAt)}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : null}

      <SectionLabel>{`Open codes · ${codes.length}`}</SectionLabel>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {codes.length === 0 ? (
        <Text style={styles.empty}>No open codes.</Text>
      ) : (
        <Card style={styles.list}>
          {codes.map((item, index) => (
            <View key={item.id} style={[styles.listRow, index > 0 && styles.divider]}>
              <View style={styles.flex}>
                <Text style={styles.listCode}>{item.code}</Text>
                <Text style={styles.listMeta}>
                  {`${item.role} · used ${item.used_count}${item.max_uses ? ` of ${item.max_uses}` : ''} · until ${formatWhen(Date.parse(item.expires_at))}`}
                </Text>
              </View>
              <Button
                title="Share"
                size="sm"
                variant="ghost"
                onPress={() => share(item.code, item.expires_at)}
              />
              <Button title="Turn off" size="sm" variant="ghost" onPress={() => revoke(item)} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...type.subhead },
  flex: { flex: 1 },
  gap: { marginTop: spacing.md },
  roles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  role: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  roleText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  roleTextOn: { color: colors.accent },
  codeCard: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.sm },
  codeLabel: { ...type.label },
  code: {
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: 6,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  empty: { ...type.subhead, paddingHorizontal: spacing.xs },
  list: { paddingVertical: spacing.xs },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  listCode: { ...type.headline, letterSpacing: 2 },
  listMeta: { ...type.footnote, textTransform: 'none' },
});
