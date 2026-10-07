// Shared design tokens — one iOS-flavored system for every screen.
// React Native uses the platform system font, so hierarchy comes from
// weight/size/spacing rather than custom fonts.
//
// Contrast: every text/fill pair here meets WCAG AA (4.5:1) — detailers read
// these screens outdoors and under bright bay lights.

export const colors = {
  bg: '#F2F2F7', // grouped background
  card: '#FFFFFF',
  border: '#D1D1D6',
  separator: '#E5E5EA',
  text: '#1C1C1E',
  textSecondary: '#5E5E63', // 6.4:1 on white
  textTertiary: '#8A8A8E', // decorative/placeholder only
  placeholder: '#8A8A8E',

  // Brand. `accent` is the fill for buttons/headers (white text 5.5:1);
  // `brand` is the lighter signature tint for large surfaces and accents.
  accent: '#4F5BD5',
  accentPressed: '#4049B8',
  brand: '#667EEA',
  accentSoft: '#EEF0FE',
  onAccent: '#FFFFFF',
  onAccentMuted: '#EEF0FF', // on accent fill: 4.8:1

  // Job states — paired with text labels, never color alone.
  run: '#1A7334',
  runSoft: '#E6F4EA',
  pause: '#955700',
  pauseSoft: '#FFF3E0',
  rework: '#B42323',
  reworkSoft: '#FDECEC',
  done: '#3A3F4B',
  doneSoft: '#ECEDF1',

  danger: '#C42B2B',
  dangerSoft: '#FDECEC',
  fieldBg: '#FFFFFF',
  overlay: 'rgba(14,16,20,0.45)',
  black: '#000000',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

// Minimum touch target. Many detailers wear gloves.
export const TOUCH = 48;

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: 0.2, color: colors.text },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  headline: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 17, fontWeight: '400', color: colors.text },
  callout: { fontSize: 16, fontWeight: '400', color: colors.text },
  subhead: { fontSize: 15, fontWeight: '400', color: colors.textSecondary },
  footnote: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  timer: {
    fontSize: 56,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  timerSmall: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
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

// Status presentation used by every list, pill and header.
export const STATUS = {
  in_progress: { label: 'Running', color: colors.run, soft: colors.runSoft, icon: 'play' },
  paused: { label: 'Paused', color: colors.pause, soft: colors.pauseSoft, icon: 'pause' },
  needs_rework: { label: 'Rework', color: colors.rework, soft: colors.reworkSoft, icon: 'refresh' },
  completed: { label: 'Done', color: colors.done, soft: colors.doneSoft, icon: 'checkmark' },
  queued: { label: 'Queued', color: colors.done, soft: colors.doneSoft, icon: 'time' },
  cancelled: { label: 'Cancelled', color: colors.done, soft: colors.doneSoft, icon: 'close' },
};

export const statusMeta = (status) => STATUS[status] || STATUS.queued;
