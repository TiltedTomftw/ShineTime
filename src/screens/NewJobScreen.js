import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createJob } from '../services/storage';
import { scanVehicleFromImage } from '../services/ocr';
import { colors, spacing, radius, type, shadow } from '../theme';

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.fieldInput} placeholderTextColor={colors.textTertiary} {...props} />
    </View>
  );
}

export default function NewJobScreen({ navigation }) {
  const [vehicle, setVehicle] = React.useState({
    stockNumber: '',
    year: '',
    make: '',
    model: '',
    color: '',
    vin: '',
  });
  const [loading, setLoading] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [scanAttempted, setScanAttempted] = React.useState(false);

  const handleScanKeytag = async () => {
    try {
      setScanAttempted(true);

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Required', 'Please allow camera access to scan keytags.');
        return;
      }

      setScanning(true);
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      if (result.canceled) {
        setScanning(false);
        return;
      }

      const asset = result.assets && result.assets[0];
      if (!asset || !asset.base64) {
        setScanning(false);
        Alert.alert('Scan Failed', 'No image data found. Try again?');
        return;
      }

      const ocr = await scanVehicleFromImage({
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      setVehicle({
        stockNumber: (ocr.stockNumber || '').toUpperCase().slice(0, 50),
        year: (ocr.year || '').slice(0, 4),
        make: (ocr.make || '').slice(0, 50),
        model: (ocr.model || '').slice(0, 50),
        color: (ocr.color || '').slice(0, 30),
        vin: (ocr.vin || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 17),
      });
    } catch (error) {
      const message = error?.message || 'Scan failed';
      Alert.alert('Scan Failed', message, [
        { text: 'Retry', onPress: handleScanKeytag },
        { text: 'Manual Entry', style: 'cancel' },
      ]);
    } finally {
      setScanning(false);
    }
  };

  // Auto-launch the keytag scan once on mount (declared after handleScanKeytag
  // so the effect references an already-initialized function).
  React.useEffect(() => {
    if (!scanAttempted) {
      handleScanKeytag();
    }
  }, [scanAttempted]);

  const set = (key, transform) => (text) =>
    setVehicle((v) => ({ ...v, [key]: transform ? transform(text) : text }));

  const handleStartJob = async () => {
    if (!vehicle.stockNumber.trim()) {
      Alert.alert('Stock Number Required', 'Enter a stock number to start the job.');
      return;
    }
    try {
      setLoading(true);
      const job = await createJob(vehicle);
      navigation.replace('JobDetail', { jobId: job.jobId });
    } catch (error) {
      Alert.alert('Error', 'Could not start job: ' + (error?.message || 'Unknown error'));
      setLoading(false);
    }
  };

  const canStart = vehicle.stockNumber.trim().length > 0 && !loading && !scanning;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity
        style={[styles.scanButton, scanning && styles.scanButtonBusy]}
        onPress={handleScanKeytag}
        disabled={scanning}
        activeOpacity={0.85}
      >
        {scanning ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.scanButtonText}>Scan Keytag</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.hint}>
        Point at the keytag or window sticker, or enter details below.
      </Text>

      <View style={styles.card}>
        <Field
          label="Stock #"
          value={vehicle.stockNumber}
          onChangeText={set('stockNumber', (t) => t.toUpperCase().slice(0, 50))}
          autoCapitalize="characters"
          placeholder="Required"
          returnKeyType="next"
        />
        <View style={styles.separator} />
        <Field
          label="Year"
          value={vehicle.year}
          onChangeText={set('year', (t) => t.replace(/[^0-9]/g, '').slice(0, 4))}
          keyboardType="number-pad"
          placeholder="—"
        />
        <View style={styles.separator} />
        <Field
          label="Make"
          value={vehicle.make}
          onChangeText={set('make', (t) => t.slice(0, 50))}
          placeholder="—"
        />
        <View style={styles.separator} />
        <Field
          label="Model"
          value={vehicle.model}
          onChangeText={set('model', (t) => t.slice(0, 50))}
          placeholder="—"
        />
        <View style={styles.separator} />
        <Field
          label="Color"
          value={vehicle.color}
          onChangeText={set('color', (t) => t.slice(0, 30))}
          placeholder="—"
        />
      </View>

      <Text style={styles.groupLabel}>OPTIONAL</Text>
      <View style={styles.card}>
        <Field
          label="VIN"
          value={vehicle.vin}
          onChangeText={set('vin', (t) =>
            t
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 17),
          )}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="17 characters"
        />
      </View>

      <TouchableOpacity
        style={[styles.startButton, !canStart && styles.startButtonDisabled]}
        onPress={handleStartJob}
        disabled={!canStart}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.startButtonText}>Begin Detailing</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  scanButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadow.card,
  },
  scanButtonBusy: { opacity: 0.7 },
  scanButtonText: { color: colors.onAccent, fontSize: 17, fontWeight: '600' },
  hint: { ...type.footnote, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  groupLabel: {
    ...type.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  fieldLabel: { ...type.body, color: colors.textSecondary, width: 84 },
  fieldInput: { ...type.body, flex: 1, paddingVertical: 12, textAlign: 'right' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: 84,
  },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: spacing.xl,
    ...shadow.card,
  },
  startButtonDisabled: {
    backgroundColor: colors.textTertiary,
    ...{ shadowOpacity: 0, elevation: 0 },
  },
  startButtonText: { color: colors.onAccent, fontSize: 17, fontWeight: '600' },
});
