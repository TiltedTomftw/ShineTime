import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { alertMessage } from '../components/alerts';
import { Button, Card, EmptyState, Notice, SectionLabel, StatusPill } from '../components/ui';
import Sheet from '../components/Sheet';
import PhotoViewer from '../components/PhotoViewer';
import { vehicleDescription, vehicleTitle } from '../components/VehicleSummary';
import { fetchJob, performJobAction, addJobPhoto } from '../services/jobs';
import { outbox } from '../services/outbox';
import { computeLiveElapsed, ensureArray, PAUSE_REASONS } from '../services/jobLogic';
import { formatClock, formatDuration, formatWhen } from '../services/timeMath';
import { colors, radius, spacing, type } from '../theme';

const CUSTODY_LABEL = {
  start: 'Started',
  pause: 'Paused',
  resume: 'Resumed',
  complete: 'Completed',
  rework: 'Sent back for rework',
  rework_start: 'Started rework',
  handoff: 'Reassigned',
};

const OTHER_REASON = 'Other';

const haptic = () => {
  if (Platform.OS !== 'web')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

export default function JobDetailScreen({ route, navigation }) {
  const { jobId } = route.params;
  const headerHeight = useHeaderHeight();
  const [job, setJob] = React.useState(null);
  const [photos, setPhotos] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  // Separate busy flags so saving a note never hides Pause / Complete.
  const [busyAction, setBusyAction] = React.useState(null);
  const [noteText, setNoteText] = React.useState('');
  const [noteBusy, setNoteBusy] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [pauseReason, setPauseReason] = React.useState('');
  const [pauseNote, setPauseNote] = React.useState('');
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const result = await fetchJob(jobId);
      setJob(result.job);
      setPhotos(result.photos);
      setOffline(result.offline);
      setLoadError('');
    } catch (e) {
      setLoadError(e?.message || 'Could not load this job.');
    } finally {
      setLoaded(true);
    }
  }, [jobId]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  // When something for this job finishes sending, refresh from Supabase so
  // "Waiting to send" clears and uploaded photos get their real links.
  const pendingRef = React.useRef(null);
  React.useEffect(
    () =>
      outbox.subscribe(() => {
        const count = outbox.pendingFor(jobId).length;
        if (pendingRef.current !== null && count < pendingRef.current) load();
        pendingRef.current = count;
      }),
    [jobId, load],
  );

  React.useEffect(() => {
    if (job) navigation.setOptions({ title: vehicleTitle(job) });
  }, [job?.stockNumber, navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (job?.status !== 'in_progress') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job?.status]);

  const act = async (type, data) => {
    setBusyAction(type);
    try {
      const updated = await performJobAction(job, type, data);
      setJob(updated);
      haptic();
      return updated;
    } catch (e) {
      alertMessage("That didn't work", e?.message || 'Try again.');
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const confirmPause = async () => {
    // "Other" means the typed text IS the reason, so it reads naturally later
    // ("Paused: test drive").
    const reason = pauseReason === OTHER_REASON ? pauseNote.trim() : pauseReason;
    const updated = await act('pause', { reason });
    if (updated) {
      setPauseOpen(false);
      setPauseReason('');
      setPauseNote('');
    }
  };

  const confirmComplete = async () => {
    const updated = await act('complete');
    if (updated) {
      setCompleteOpen(false);
      navigation.navigate('Home', {
        justCompleted: { stock: updated.stockNumber || '', durationMs: updated.totalActiveTime },
      });
    }
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setNoteBusy(true);
    try {
      setJob(await performJobAction(job, 'note', { text }));
      setNoteText('');
    } catch (e) {
      alertMessage("Couldn't add the note", e?.message || 'Try again.');
    } finally {
      setNoteBusy(false);
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        alertMessage('Camera is off', 'Allow camera access in Settings to add photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      setPhotoBusy(true);
      await addJobPhoto(job, result.assets[0]);
      await load(); // shows it right away with an "uploading" badge
      haptic();
    } catch (e) {
      alertMessage("Couldn't save the photo", e?.message || 'Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          title={offline ? "Can't load this job offline" : 'This job is no longer available'}
          body={
            loadError ||
            (offline ? 'Try again when you have signal.' : 'It may have been removed by a manager.')
          }
        >
          <Button
            title={offline ? 'Try again' : 'Back to my cars'}
            onPress={offline ? load : () => navigation.goBack()}
          />
        </EmptyState>
      </View>
    );
  }

  const status = job.status;
  const elapsed = status === 'completed' ? job.totalActiveTime : computeLiveElapsed(job, now);
  const reworkNote = ensureArray(job.custodyEvents)
    .filter((e) => e.type === 'rework')
    .pop();
  const lastPause = ensureArray(job.pauseEvents)
    .filter((e) => e.type === 'pause')
    .pop();
  const timeline = [...ensureArray(job.custodyEvents)].sort((a, b) => b.timestamp - a.timestamp);
  const perDetailer = Object.entries(job.detailerTimeTracking || {});
  const description = vehicleDescription(job);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {offline ? (
          <Notice tone="warning">Offline. Changes are saved on this phone until they send.</Notice>
        ) : null}

        {/* Hero: the timer is what a detailer looks at. */}
        <Card style={styles.hero}>
          <StatusPill status={status} />
          <Text
            style={[styles.timer, { color: status === 'in_progress' ? colors.run : colors.text }]}
            accessibilityLabel={`Time worked ${formatDuration(elapsed)}`}
            accessibilityLiveRegion="none"
          >
            {formatClock(elapsed)}
          </Text>
          {description ? <Text style={styles.vehicle}>{description}</Text> : null}
          {job.vin ? <Text style={styles.vin}>VIN {job.vin}</Text> : null}
          <Text style={styles.meta}>
            {job.detailerName}
            {` · started ${formatWhen(job.startTime, now)}`}
          </Text>
          {job.pendingCount > 0 ? (
            <View style={styles.pending}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.pause} />
              <Text style={styles.pendingText}>
                {offline ? 'Saved on this phone · will send when online' : 'Sending…'}
              </Text>
            </View>
          ) : null}
        </Card>

        {status === 'paused' && lastPause ? (
          <Notice tone="warning">
            {`Paused ${formatWhen(lastPause.timestamp, now)}${lastPause.reason ? ` · ${lastPause.reason}` : ''}`}
          </Notice>
        ) : null}
        {status === 'needs_rework' ? (
          <Notice tone="error">
            {reworkNote?.note
              ? `Sent back: “${reworkNote.note}” — ${reworkNote.detailerName || 'Manager'}`
              : 'A manager sent this car back for rework.'}
          </Notice>
        ) : null}
        {status === 'completed' ? (
          <Notice tone="success">
            {`Completed ${formatWhen(job.endTime, now)} · ${formatDuration(job.totalActiveTime)} worked`}
          </Notice>
        ) : null}

        {status !== 'completed' ? (
          <View style={styles.actions}>
            {status === 'in_progress' ? (
              <Button
                title="Pause"
                icon="pause"
                variant="pause"
                size="lg"
                onPress={() => setPauseOpen(true)}
                disabled={!!busyAction}
                style={styles.flex}
              />
            ) : (
              <Button
                title={status === 'needs_rework' ? 'Start rework' : 'Resume'}
                icon="play"
                variant="run"
                size="lg"
                onPress={() => act('resume')}
                loading={busyAction === 'resume'}
                disabled={!!busyAction && busyAction !== 'resume'}
                style={styles.flex}
              />
            )}
            {status !== 'needs_rework' ? (
              <Button
                title="Complete"
                icon="checkmark"
                size="lg"
                onPress={() => setCompleteOpen(true)}
                disabled={!!busyAction}
                style={styles.flexWide}
              />
            ) : null}
          </View>
        ) : null}

        <SectionLabel>{`Photos · ${photos.length}`}</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photos}
        >
          {status !== 'completed' ? (
            <Pressable
              onPress={takePhoto}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
              style={({ pressed }) => [styles.addPhoto, pressed && { opacity: 0.7 }]}
            >
              {photoBusy ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <Ionicons name="camera" size={26} color={colors.accent} />
                  <Text style={styles.addPhotoText}>Add</Text>
                </>
              )}
            </Pressable>
          ) : null}
          {photos.map((p, i) => (
            <Pressable
              key={p.key}
              onPress={() => setViewerIndex(i)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo ${i + 1}${p.pending ? ', uploading' : ''}`}
            >
              <Image source={{ uri: p.url }} style={styles.thumb} />
              {p.pending ? (
                <View style={styles.thumbBadge}>
                  <Ionicons name="cloud-upload" size={13} color={colors.white} />
                </View>
              ) : null}
            </Pressable>
          ))}
          {photos.length === 0 && status === 'completed' ? (
            <Text style={styles.empty}>No photos.</Text>
          ) : null}
        </ScrollView>

        <SectionLabel>Notes</SectionLabel>
        {status !== 'completed' ? (
          <View style={styles.noteBox}>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Add a note (damage, stains, odor…)"
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={500}
              accessibilityLabel="Note"
            />
            <Button
              title="Add note"
              size="sm"
              variant="quiet"
              onPress={addNote}
              loading={noteBusy}
              disabled={!noteText.trim()}
              style={styles.noteButton}
            />
          </View>
        ) : null}
        {ensureArray(job.notes).length === 0 ? (
          <Text style={styles.empty}>No notes yet.</Text>
        ) : (
          <Card style={styles.list}>
            {job.notes.map((note, index) => (
              <View
                key={`${note.timestamp}-${index}`}
                style={[styles.listItem, index > 0 && styles.listDivider]}
              >
                <Text style={styles.listMeta}>
                  {formatWhen(note.timestamp, now)} · {note.detailerName || 'Unknown'}
                </Text>
                <Text style={styles.listText}>{note.text}</Text>
              </View>
            ))}
          </Card>
        )}

        {perDetailer.length > 1 ? (
          <>
            <SectionLabel>Time by detailer</SectionLabel>
            <Card style={styles.list}>
              {perDetailer.map(([name, ms], index) => (
                <View key={name} style={[styles.listRow, index > 0 && styles.listDivider]}>
                  <Text style={styles.listText}>{name}</Text>
                  <Text style={styles.listText}>{formatDuration(ms)}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionLabel>History</SectionLabel>
        <Card style={styles.list}>
          {timeline.map((event, index) => (
            <View
              key={`${event.timestamp}-${index}`}
              style={[styles.listItem, index > 0 && styles.listDivider]}
            >
              <Text style={styles.listText}>
                {CUSTODY_LABEL[event.type] || event.type}
                <Text style={styles.listMeta}>{`  ${event.detailerName || 'Unknown'}`}</Text>
              </Text>
              <Text style={styles.listMeta}>
                {formatWhen(event.timestamp, now)}
                {event.note && event.type !== 'pause' ? ` · ${event.note}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      <Sheet visible={pauseOpen} title="Why are you pausing?" onClose={() => setPauseOpen(false)}>
        <View style={styles.chips}>
          {[...PAUSE_REASONS, OTHER_REASON].map((reason) => {
            const on = pauseReason === reason;
            return (
              <Pressable
                key={reason}
                onPress={() => setPauseReason(on ? '' : reason)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{reason}</Text>
              </Pressable>
            );
          })}
        </View>
        {pauseReason === OTHER_REASON ? (
          <TextInput
            style={styles.sheetInput}
            value={pauseNote}
            onChangeText={setPauseNote}
            placeholder="What's the reason?"
            placeholderTextColor={colors.placeholder}
            maxLength={60}
            autoFocus
            accessibilityLabel="Other reason"
          />
        ) : null}
        <Button
          title="Pause job"
          icon="pause"
          variant="pause"
          size="lg"
          onPress={confirmPause}
          loading={busyAction === 'pause'}
        />
      </Sheet>

      <Sheet
        visible={completeOpen}
        title={`Finish ${vehicleTitle(job)}?`}
        onClose={() => setCompleteOpen(false)}
      >
        <View style={styles.summary}>
          <SummaryItem label="Time worked" value={formatDuration(elapsed)} />
          <SummaryItem label="Photos" value={String(photos.length)} />
          <SummaryItem label="Notes" value={String(ensureArray(job.notes).length)} />
        </View>
        {photos.length === 0 ? (
          <Notice
            tone="warning"
            action="Add photo"
            onAction={() => {
              setCompleteOpen(false);
              takePhoto();
            }}
          >
            No photos yet. Most managers want an after photo.
          </Notice>
        ) : null}
        <Text style={styles.sheetHint}>
          Completed jobs are locked. A manager can reopen it if needed.
        </Text>
        <Button
          title="Complete job"
          icon="checkmark"
          size="lg"
          onPress={confirmComplete}
          loading={busyAction === 'complete'}
        />
        <Button title="Not yet" variant="ghost" onPress={() => setCompleteOpen(false)} />
      </Sheet>

      <PhotoViewer
        key={viewerIndex ?? 'closed'}
        photos={photos}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </KeyboardAvoidingView>
  );
}

function SummaryItem({ label, value }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexWide: { flex: 1.4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.sm },
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  timer: { ...type.timer, marginTop: spacing.sm },
  vehicle: { ...type.headline, textAlign: 'center' },
  vin: { ...type.footnote },
  meta: { ...type.footnote, marginTop: spacing.xs },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  pendingText: { ...type.footnote, color: colors.pause, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  photos: { gap: spacing.sm, paddingVertical: spacing.xs },
  addPhoto: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: { color: colors.accent, fontWeight: '600', marginTop: 2 },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.separator },
  thumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.pause,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { ...type.subhead, paddingHorizontal: spacing.xs },
  noteBox: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  noteInput: { ...type.callout, minHeight: 64, textAlignVertical: 'top', padding: spacing.xs },
  noteButton: { alignSelf: 'flex-end', paddingHorizontal: spacing.xl },
  list: { paddingVertical: spacing.xs },
  listItem: { paddingVertical: spacing.md, gap: 2 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  listDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  listMeta: { ...type.footnote },
  listText: { ...type.callout },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.pause, backgroundColor: colors.pauseSoft },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.pause },
  sheetInput: {
    ...type.callout,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  sheetHint: { ...type.footnote },
  summary: { flexDirection: 'row', gap: spacing.sm },
  summaryItem: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: { ...type.footnote, marginTop: 2 },
});
