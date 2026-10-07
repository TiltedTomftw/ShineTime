import React from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { alertMessage } from '../components/alerts';
import JobCard from '../components/JobCard';
import { Button, EmptyState, Notice, SectionLabel } from '../components/ui';
import { fetchOpenJobs, fetchTodayStats, performJobAction } from '../services/jobs';
import { formatDuration } from '../services/timeMath';
import { colors, radius, spacing, type, shadow } from '../theme';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://tiltedtomftw.github.io/shinetime-dashboard/';

const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export default function HomeScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { userName, activeDealership, isManager } = useAuth();
  const [jobs, setJobs] = React.useState([]);
  const [stats, setStats] = React.useState(null);
  const [offline, setOffline] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    try {
      const open = await fetchOpenJobs();
      setJobs(open.jobs);
      setOffline(open.offline);
      setLoadError('');
      if (!open.offline) {
        fetchTodayStats()
          .then(setStats)
          .catch(() => {});
      }
    } catch (e) {
      setLoadError(e?.message || 'Could not load your cars.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  // "Done · 52 min" after completing a car, cleared after a few seconds.
  const flash = route.params?.justCompleted || null;
  React.useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => navigation.setParams({ justCompleted: undefined }), 6000);
    return () => clearTimeout(t);
  }, [flash, navigation]);

  const anyRunning = jobs.some((j) => j.status === 'in_progress');
  React.useEffect(() => {
    if (!anyRunning) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resume = async (job) => {
    try {
      const updated = await performJobAction(job, 'resume');
      setJobs((list) => list.map((j) => (j.jobId === job.jobId ? updated : j)));
      navigation.navigate('JobDetail', { jobId: job.jobId });
    } catch (e) {
      alertMessage("Couldn't resume", e?.message || 'Try again.');
    }
  };

  const working = jobs.filter((j) => j.status === 'in_progress' || j.status === 'paused');
  const rework = jobs.filter((j) => j.status === 'needs_rework');
  const dealershipName = activeDealership?.dealership?.name || 'Your dealership';
  const firstName = (userName || '').split(' ')[0] || 'My';

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerText}>
        <Text style={styles.dealership} numberOfLines={1}>
          {dealershipName}
        </Text>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {isManager ? 'Shop floor' : `${firstName}'s cars`}
        </Text>
      </View>
      <Pressable
        onPress={() => navigation.navigate('Account')}
        accessibilityRole="button"
        accessibilityLabel="Account and sign out"
        style={styles.avatar}
        hitSlop={6}
      >
        <Text style={styles.avatarText}>{initials(userName)}</Text>
      </Pressable>
    </View>
  );

  const notices = (
    <>
      {flash ? (
        <Notice tone="success">
          {`Done: #${flash.stock}${flash.durationMs ? ` · ${formatDuration(flash.durationMs)}` : ''}`}
        </Notice>
      ) : null}
      {offline ? <Notice tone="warning">Offline. Showing what this phone last saw.</Notice> : null}
      {loadError ? (
        <Notice tone="error" action="Retry" onAction={load}>
          {loadError}
        </Notice>
      ) : null}
    </>
  );

  if (isManager) {
    const counts = {
      running: jobs.filter((j) => j.status === 'in_progress').length,
      paused: jobs.filter((j) => j.status === 'paused').length,
      rework: rework.length,
    };
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {header}
        <View style={styles.gap}>{notices}</View>
        <View style={styles.statsRow}>
          <Stat label="Done today" value={stats ? stats.completed : '–'} />
          <Stat label="Running" value={counts.running} color={colors.run} />
          <Stat label="Paused" value={counts.paused} color={colors.pause} />
          <Stat label="Rework" value={counts.rework} color={colors.rework} />
        </View>
        <Button
          title="Open the web dashboard"
          icon="open-outline"
          onPress={() =>
            Linking.openURL(`${DASHBOARD_URL}?d=${activeDealership?.dealershipId || ''}`)
          }
          style={styles.gapTop}
          accessibilityHint="Full reports, team and PIN resets open in your browser"
        />
        <View style={styles.row}>
          <Button
            title="Invite team"
            icon="person-add-outline"
            variant="secondary"
            onPress={() => navigation.navigate('ManageInviteCodes')}
            style={styles.flex}
          />
          <Button
            title="History"
            icon="time-outline"
            variant="secondary"
            onPress={() => navigation.navigate('History')}
            style={styles.flex}
          />
        </View>
        <SectionLabel>{`Open jobs · ${jobs.length}`}</SectionLabel>
        {loaded && jobs.length === 0 ? (
          <EmptyState
            icon="car-outline"
            title="No open jobs"
            body="Cars appear here as detailers start them."
          />
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              now={now}
              showDetailer
              onPress={() => navigation.navigate('JobDetail', { jobId: job.jobId })}
            />
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {header}
      <View style={styles.gap}>{notices}</View>

      <Pressable
        onPress={() => navigation.navigate('NewJob')}
        accessibilityRole="button"
        accessibilityLabel="Scan keytag to start a new car"
        style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.accentPressed }]}
      >
        <Ionicons name="scan" size={28} color={colors.onAccent} />
        <View>
          <Text style={styles.ctaTitle}>Scan keytag</Text>
          <Text style={styles.ctaSub}>Start a new car</Text>
        </View>
      </Pressable>

      {rework.length > 0 ? (
        <>
          <SectionLabel>{`Sent back for rework · ${rework.length}`}</SectionLabel>
          {rework.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              now={now}
              onPress={() => navigation.navigate('JobDetail', { jobId: job.jobId })}
              onResume={() => resume(job)}
            />
          ))}
        </>
      ) : null}

      <SectionLabel>{`Working now · ${working.length}`}</SectionLabel>
      {loaded && working.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title="No cars in progress"
          body="Scan a keytag to start one. Paused cars wait here too."
        />
      ) : (
        working.map((job) => (
          <JobCard
            key={job.jobId}
            job={job}
            now={now}
            onPress={() => navigation.navigate('JobDetail', { jobId: job.jobId })}
            onResume={() => resume(job)}
          />
        ))
      )}

      <Pressable
        onPress={() => navigation.navigate('History')}
        accessibilityRole="button"
        accessibilityLabel="Open history"
        style={styles.today}
      >
        <Text style={styles.todayText}>
          {stats
            ? stats.completed > 0
              ? `Today: ${stats.completed} done · avg ${formatDuration(stats.avgMs)}`
              : 'Nothing finished yet today'
            : 'Today'}
        </Text>
        <View style={styles.historyLink}>
          <Text style={styles.historyText}>History</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </View>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value, color = colors.text }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },
  gap: { gap: spacing.sm, marginBottom: spacing.sm },
  gapTop: { marginTop: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, marginRight: spacing.md },
  dealership: { ...type.footnote, fontWeight: '600' },
  title: { ...type.largeTitle, fontSize: 30 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    minHeight: 84,
    ...shadow.card,
  },
  ctaTitle: { color: colors.onAccent, fontSize: 20, fontWeight: '700' },
  ctaSub: { color: colors.onAccentMuted, fontSize: 15, marginTop: 2 },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  todayText: { ...type.subhead, flex: 1 },
  historyLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  historyText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    ...shadow.card,
  },
  statValue: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { ...type.footnote, marginTop: 2, textAlign: 'center' },
});
