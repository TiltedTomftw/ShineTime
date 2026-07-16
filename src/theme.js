// Shared design tokens — an iOS/Apple-flavored system so every screen looks
// like one app. React Native uses San Francisco on iOS by default, so we lean
// on weight/size/spacing rather than custom fonts.

export const colors = {
  bg: '#F2F2F7',          // iOS grouped background
  card: '#FFFFFF',
  cardBorder: '#E5E5EA',
  separator: '#E5E5EA',
  text: '#1C1C1E',        // primary label
  textSecondary: '#6E6E73',
  textTertiary: '#A1A1A6',
  accent: '#667EEA',      // brand
  accentSoft: '#EEF0FE',
  onAccent: '#FFFFFF',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  fieldBg: '#F2F2F7',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: 0.2, color: colors.text },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  headline: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 17, fontWeight: '400', color: colors.text },
  subhead: { fontSize: 15, fontWeight: '400', color: colors.textSecondary },
  footnote: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, color: colors.textSecondary },
  mono: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
};
