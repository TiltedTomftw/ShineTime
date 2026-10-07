import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { EmptyState, Notice, StatusPill } from '../components/ui';
import { vehicleDescription, vehicleTitle } from '../components/VehicleSummary';
import { fetchHistory } from '../services/jobs';
import { formatDuration, formatWhen, groupByDay } from '../services/timeMath';
import { colors, radius, spacing, type } from '../theme';

// Past and current jobs, grouped by day, with stock/make/model search.
// Pages from Supabase 30 at a time instead of loading everything.
export default function HistoryScreen({ navigation }) {
  const { isManager } = useAuth();
  const [jobs, setJobs] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestId = React.useRef(0);

  const load = React.useCallback(async (term) => {
    const id = (requestId.current += 1);
    setError('');
    try {
      const page = await fetchHistory({ search: term });
      if (id !== requestId.current) return; // a newer search replaced this one
      setJobs(page.jobs);
      setCursor(page.nextCursor);
    } catch (e) {
      if (id === requestId.current) setError(e?.message || 'Could not load history.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Debounced search: one request after typing stops, not one per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchHistory({ search, cursor });
      setJobs((list) => list.concat(page.jobs));
      setCursor(page.nextCursor);
    } catch {
      // keep what we have; scrolling again retries
    } finally {
      setLoadingMore(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load(search);
    setRefreshing(false);
  };

  const sections = React.useMemo(() => groupByDay(jobs, (j) => j.endTime || j.startTime), [jobs]);

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={(t) => {
            setLoading(true);
            setSearch(t);
          }}
          placeholder="Search stock #, make or model"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search history"
          clearButtonMode="while-editing"
        />
      </View>
      {error ? (
        <View style={styles.pad}>
          <Notice tone="error" action="Retry" onAction={() => load(search)}>
            {error}
          </Notice>
        </View>
      ) : null}
      {loading && jobs.length === 0 ? (
        <ActivityIndicator style={styles.spinner} color={colors.accent} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.jobId}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader} accessibilityRole="header">
              {`${section.title} · ${section.data.length}`}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <Pressable
              onPress={() => navigation.navigate('JobDetail', { jobId: item.jobId })}
              accessibilityRole="button"
              accessibilityLabel={`${vehicleTitle(item)}, ${vehicleDescription(item)}`}
              style={({ pressed }) => [
                styles.row,
                index === 0 && styles.rowFirst,
                index === section.data.length - 1 && styles.rowLast,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.stock} numberOfLines={1}>
                  {vehicleTitle(item)}
                </Text>
                <Text style={styles.desc} numberOfLines={1}>
                  {[vehicleDescription(item), isManager ? item.detailerName : null]
                    .filter(Boolean)
                    .join(' · ') || ' '}
                </Text>
              </View>
              <View style={styles.rowSide}>
                <StatusPill status={item.status} size="sm" />
                <Text style={styles.time}>
                  {item.status === 'completed'
                    ? `${formatDuration(item.totalActiveTime)} · ${formatWhen(item.endTime)}`
                    : `Started ${formatWhen(item.startTime)}`}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="time-outline"
              title={search ? 'No matches' : 'No jobs yet'}
              body={search ? `Nothing matches “${search}”.` : 'Cars you work on will show up here.'}
            />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.spinner} color={colors.accent} /> : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: spacing.lg },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  search: { flex: 1, ...type.callout, paddingVertical: spacing.sm },
  spinner: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  sectionHeader: {
    ...type.label,
    backgroundColor: colors.bg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowFirst: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: 0 },
  rowLast: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  rowMain: { flex: 1, minWidth: 0 },
  rowSide: { alignItems: 'flex-end', gap: 4 },
  stock: { ...type.headline },
  desc: { ...type.footnote, marginTop: 2 },
  time: { ...type.footnote, fontVariant: ['tabular-nums'] },
});
