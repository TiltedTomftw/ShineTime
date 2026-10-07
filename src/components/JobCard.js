import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, StatusPill, Button } from './ui';
import { vehicleTitle, vehicleDescription } from './VehicleSummary';
import { colors, spacing, type, statusMeta } from '../theme';
import { displayDuration, ensureArray } from '../services/jobLogic';
import { formatClock, formatDuration, formatWhen } from '../services/timeMath';

// Why a paused car is paused, or what the manager said when sending it back.
const holdReason = (job) => {
  if (job.status === 'needs_rework') {
    const rework = ensureArray(job.custodyEvents)
      .filter((e) => e.type === 'rework')
      .pop();
    return rework?.note
      ? `“${rework.note}” · ${rework.detailerName || 'Manager'}`
      : 'Sent back by a manager';
  }
  if (job.status === 'paused') {
    const pause = ensureArray(job.pauseEvents)
      .filter((e) => e.type === 'pause')
      .pop();
    const why = pause?.reason || 'Paused';
    return pause?.timestamp ? `${why} · since ${formatWhen(pause.timestamp)}` : why;
  }
  return null;
};

export default function JobCard({ job, now, onPress, onResume, showDetailer = false }) {
  const meta = statusMeta(job.status);
  const open = job.status !== 'completed';
  const reason = holdReason(job);
  const desc = vehicleDescription(job);
  const elapsed = displayDuration(job, now);
  const label = `${vehicleTitle(job)}, ${desc ? `${desc}, ` : ''}${meta.label}`;

  return (
    // The card's tappable area and the Resume button are siblings: a button
    // nested inside another button is invalid and hides it from screen readers.
    <Card style={[styles.card, job.status === 'needs_rework' && styles.reworkCard]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <View style={styles.top}>
          <Text style={styles.stock} numberOfLines={1}>
            {vehicleTitle(job)}
          </Text>
          <StatusPill status={job.status} size="sm" />
        </View>
        {!!desc && (
          <Text style={styles.desc} numberOfLines={1}>
            {desc}
          </Text>
        )}
        {showDetailer && (
          <Text style={styles.meta} numberOfLines={1}>
            {job.detailerName || 'Unknown'}
          </Text>
        )}
        {reason ? (
          <Text style={styles.meta} numberOfLines={2}>
            {reason}
          </Text>
        ) : null}

        <View style={styles.bottom}>
          {open ? (
            <Text
              style={[
                styles.timer,
                { color: job.status === 'in_progress' ? colors.run : colors.textSecondary },
              ]}
              accessibilityLabel={`Time worked ${formatDuration(elapsed)}`}
            >
              {formatClock(elapsed)}
            </Text>
          ) : (
            <Text style={styles.metaStrong}>
              {formatDuration(job.totalActiveTime)}
              {job.endTime ? (
                <Text style={styles.meta}>{`  ·  finished ${formatWhen(job.endTime, now)}`}</Text>
              ) : null}
            </Text>
          )}
          {job.pendingCount > 0 ? (
            <View style={styles.pending} accessibilityLabel="Waiting to send">
              <Ionicons name="cloud-upload-outline" size={16} color={colors.pause} />
              <Text style={styles.pendingText}>Waiting to send</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {onResume && (job.status === 'paused' || job.status === 'needs_rework') ? (
        <Button
          title={job.status === 'needs_rework' ? 'Start rework' : 'Resume'}
          icon="play"
          size="sm"
          variant={job.status === 'needs_rework' ? 'danger' : 'secondary'}
          onPress={onResume}
          style={styles.resume}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  main: { gap: 4 },
  pressed: { opacity: 0.7 },
  reworkCard: { borderLeftWidth: 4, borderLeftColor: colors.rework },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stock: { ...type.headline, fontSize: 18, flexShrink: 1 },
  desc: { ...type.subhead },
  meta: { ...type.footnote },
  metaStrong: { ...type.callout, fontWeight: '600' },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  timer: { ...type.timerSmall },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingText: { ...type.footnote, color: colors.pause, fontWeight: '600' },
  resume: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.xl },
});
