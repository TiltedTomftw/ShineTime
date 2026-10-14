// Shared building blocks so every screen looks and behaves the same, and every
// control is a real, labelled, 48px+ button for screen readers and gloves.

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type, shadow, TOUCH, statusMeta } from '../theme';

const VARIANTS = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  secondary: { bg: colors.card, fg: colors.accent, border: colors.accent },
  quiet: { bg: colors.accentSoft, fg: colors.accent, border: colors.accentSoft },
  pause: { bg: colors.card, fg: colors.pause, border: colors.pause },
  run: { bg: colors.run, fg: colors.white, border: colors.run },
  danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
  dangerSolid: { bg: colors.danger, fg: colors.white, border: colors.danger },
  inverse: { bg: colors.white, fg: colors.accent, border: colors.white },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  size = 'md',
  style,
  accessibilityHint,
  testID,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const inactive = disabled || loading;
  const height = size === 'lg' ? 60 : size === 'sm' ? 40 : 52;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: Math.max(height, size === 'sm' ? 40 : TOUCH),
          backgroundColor: v.bg,
          borderColor: v.border,
        },
        variant === 'ghost' && styles.ghost,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={size === 'lg' ? 22 : 18} color={v.fg} /> : null}
          <Text
            style={[styles.buttonText, { color: v.fg }, size === 'lg' && styles.buttonTextLg]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = colors.accent, size = 24, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, style]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children, style, right }) {
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export function StatusPill({ status, size = 'md' }) {
  const meta = statusMeta(status);
  return (
    <View
      style={[styles.pill, { backgroundColor: meta.soft }, size === 'sm' && styles.pillSm]}
      accessibilityLabel={`Status: ${meta.label}`}
    >
      <Ionicons name={meta.icon} size={size === 'sm' ? 11 : 13} color={meta.color} />
      <Text style={[styles.pillText, { color: meta.color }, size === 'sm' && styles.pillTextSm]}>
        {meta.label}
      </Text>
    </View>
  );
}

// A labelled text field. The label stays visible after typing (placeholders
// alone made fields lose their meaning).
export const Field = React.forwardRef(function Field(
  { label, hint, error, style, inputStyle, dark = false, ...props },
  ref,
) {
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.fieldLabel, dark && styles.fieldLabelDark]} nativeID={props.nativeID}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        style={[styles.fieldInput, error && styles.fieldInputError, inputStyle]}
        {...props}
      />
      {error ? (
        <Text
          style={[styles.fieldError, dark && styles.fieldErrorDark]}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, dark && styles.fieldHintDark]}>{hint}</Text>
      ) : null}
    </View>
  );
});

export function EmptyState({ icon, title, body, children }) {
  return (
    <View style={styles.empty}>
      {icon ? <Ionicons name={icon} size={40} color={colors.textTertiary} /> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {children}
    </View>
  );
}

export function Notice({ tone = 'info', children, action, onAction }) {
  const palette = {
    info: { bg: colors.accentSoft, fg: colors.accent, icon: 'information-circle' },
    warning: { bg: colors.pauseSoft, fg: colors.pause, icon: 'cloud-offline' },
    error: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle' },
    success: { bg: colors.runSoft, fg: colors.run, icon: 'checkmark-circle' },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]} accessibilityLiveRegion="polite">
      <Ionicons name={palette.icon} size={20} color={palette.fg} />
      <Text style={[styles.noticeText, { color: palette.fg }]}>{children}</Text>
      {action ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={10}
          style={styles.noticeAction}
        >
          <Text style={[styles.noticeActionText, { color: palette.fg }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { borderWidth: 0 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { fontSize: 17, fontWeight: '600' },
  buttonTextLg: { fontSize: 18 },
  pressed: { opacity: 0.75 },
  inactive: { opacity: 0.45 },
  iconButton: {
    minWidth: TOUCH,
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.85 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionLabel: { ...type.label },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 13, fontWeight: '700' },
  pillTextSm: { fontSize: 12 },
  field: { marginBottom: spacing.md },
  fieldLabel: { ...type.footnote, fontWeight: '600', color: colors.text, marginBottom: 6 },
  fieldLabelDark: { color: colors.white },
  fieldInput: {
    ...type.body,
    minHeight: TOUCH + 4,
    backgroundColor: colors.fieldBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  fieldInputError: { borderColor: colors.danger, borderWidth: 1.5 },
  fieldHint: { ...type.footnote, marginTop: 6 },
  fieldHintDark: { color: colors.onAccentMuted },
  fieldError: { ...type.footnote, color: colors.danger, marginTop: 6, fontWeight: '600' },
  fieldErrorDark: { color: colors.white },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { ...type.headline, textAlign: 'center' },
  emptyBody: { ...type.subhead, textAlign: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontSize: 15, fontWeight: '600' },
  noticeAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.xs },
  noticeActionText: { fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
});
