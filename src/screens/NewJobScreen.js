import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import { Button, Notice } from '../components/ui';
import { alertMessage, confirmAction } from '../components/alerts';
import { createJob, findOpenJobByStock, prepareImage } from '../services/jobs';
import { scanVehicleFromImage } from '../services/ocr';
import { colors, spacing, radius, type, shadow } from '../theme';

const FIELDS = [
  { key: 'stockNumber', label: 'Stock #', placeholder: 'Required', caps: 'characters', max: 50 },
  { key: 'year', label: 'Year', placeholder: 'e.g. 2024', keyboard: 'number-pad', max: 4 },
  { key: 'make', label: 'Make', placeholder: 'e.g. Ford', caps: 'words', max: 50 },
  { key: 'model', label: 'Model', placeholder: 'e.g. F-150', caps: 'words', max: 50 },
  { key: 'color', label: 'Color', placeholder: 'e.g. Blue', caps: 'words', max: 30 },
];

const clean = {
  stockNumber: (t) => t.toUpperCase().slice(0, 50),
  year: (t) => t.replace(/[^0-9]/g, '').slice(0, 4),
  vin: (t) =>
    t
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 17),
};

const Row = React.forwardRef(function Row({ label, ...props }, ref) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        ref={ref}
        style={styles.rowInput}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );
});

export default function NewJobScreen({ navigation }) {
  const headerHeight = useHeaderHeight();
  const [vehicle, setVehicle] = React.useState({
    stockNumber: '',
    year: '',
    make: '',
    model: '',
    color: '',
    vin: '',
  });
  const [starting, setStarting] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [scanNote, setScanNote] = React.useState(null); // { tone, text }
  const refs = React.useRef({});

  const scan = React.useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setScanNote({ tone: 'warning', text: 'Camera access is off. Type the details below.' });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      setScanning(true);
      setScanNote(null);
      const image = await prepareImage(result.assets[0]);
      const ocr = await scanVehicleFromImage({ base64: image.base64, mimeType: image.mimeType });

      // Only fill what the scan actually read; never blank a field the
      // detailer already typed because the scan missed it.
      const read = {
        stockNumber: clean.stockNumber(ocr.stockNumber || ''),
        year: clean.year(String(ocr.year || '')),
        make: (ocr.make || '').slice(0, 50),
        model: (ocr.model || '').slice(0, 50),
        color: (ocr.color || '').slice(0, 30),
        vin: clean.vin(ocr.vin || ''),
      };
      const found = Object.entries(read).filter(([, v]) => v);
      setVehicle((v) => ({ ...v, ...Object.fromEntries(found) }));
      if (found.length === 0) {
        setScanNote({ tone: 'warning', text: "Couldn't read anything. Try again or type it in." });
      } else if (!read.stockNumber) {
        setScanNote({ tone: 'warning', text: 'Scanned, but no stock number. Please type it in.' });
      } else {
        setScanNote({ tone: 'success', text: 'Scanned. Check the details, then start.' });
      }
    } catch (error) {
      setScanNote({
        tone: 'error',
        text: error?.message || "Couldn't read the tag. Type it in instead.",
      });
    } finally {
      setScanning(false);
    }
  }, []);

  // Open the camera straight away on a phone: scanning is the fast path.
  // (On web the camera is a file picker, which would block typing.)
  // A short delay lets the screen finish sliding in before the camera opens.
  React.useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const t = setTimeout(scan, 350);
    return () => clearTimeout(t);
  }, [scan]);

  const start = async () => {
    if (!vehicle.stockNumber.trim() || starting) return;
    setStarting(true);
    try {
      const existing = await findOpenJobByStock(vehicle.stockNumber);
      if (existing) {
        setStarting(false);
        confirmAction({
          title: `#${vehicle.stockNumber.trim().toUpperCase()} is already open`,
          message: `${existing.detailerName || 'Someone'} has this car ${
            existing.status === 'needs_rework' ? 'waiting for rework' : 'in progress'
          }. Open that job instead of starting a second one?`,
          confirmText: 'Open it',
          onConfirm: () => navigation.replace('JobDetail', { jobId: existing.jobId }),
        });
        return;
      }
      const job = await createJob(vehicle);
      navigation.replace('JobDetail', { jobId: job.jobId });
    } catch (error) {
      setStarting(false);
      alertMessage("Couldn't start the job", error?.message || 'Try again.');
    }
  };

  const canStart = vehicle.stockNumber.trim().length > 0 && !scanning;
  const set = (key) => (text) =>
    setVehicle((v) => ({ ...v, [key]: clean[key] ? clean[key](text) : text.slice(0, 50) }));

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
        <Button
          title={scanning ? 'Reading tag…' : 'Scan keytag'}
          icon="scan"
          size="lg"
          onPress={scan}
          loading={scanning}
        />
        <Text style={styles.hint}>Point the camera at the keytag or window sticker.</Text>
        {scanNote ? <Notice tone={scanNote.tone}>{scanNote.text}</Notice> : null}

        <Text style={styles.groupLabel}>VEHICLE</Text>
        <View style={styles.card}>
          {FIELDS.map((f, i) => (
            <React.Fragment key={f.key}>
              {i > 0 ? <View style={styles.separator} /> : null}
              <Row
                ref={(r) => {
                  refs.current[f.key] = r;
                }}
                label={f.label}
                value={vehicle[f.key]}
                onChangeText={set(f.key)}
                placeholder={f.placeholder}
                autoCapitalize={f.caps || 'none'}
                autoCorrect={false}
                keyboardType={f.keyboard || 'default'}
                returnKeyType="next"
                onSubmitEditing={() => refs.current[FIELDS[i + 1]?.key || 'vin']?.focus()}
              />
            </React.Fragment>
          ))}
        </View>

        <Text style={styles.groupLabel}>OPTIONAL</Text>
        <View style={styles.card}>
          <Row
            ref={(r) => {
              refs.current.vin = r;
            }}
            label="VIN"
            value={vehicle.vin}
            onChangeText={set('vin')}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="17 characters"
            returnKeyType="go"
            onSubmitEditing={start}
          />
        </View>

        <Button
          title="Start the clock"
          icon="play"
          size="lg"
          onPress={start}
          disabled={!canStart}
          loading={starting}
          style={styles.start}
        />
        {!canStart && !starting ? (
          <Text style={styles.disabledHint}>
            {scanning ? 'Reading the tag…' : 'Enter a stock number to start.'}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  hint: { ...type.footnote, textAlign: 'center', marginBottom: spacing.xs },
  groupLabel: { ...type.label, marginTop: spacing.lg, marginLeft: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  rowLabel: { ...type.body, color: colors.textSecondary, width: 84 },
  rowInput: { ...type.body, flex: 1, paddingVertical: 12, textAlign: 'right' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: 84,
  },
  start: { marginTop: spacing.xl },
  disabledHint: { ...type.footnote, textAlign: 'center' },
});
