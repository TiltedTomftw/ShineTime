import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createJob } from '../services/storage';
import { scanVehicleFromImage } from '../services/ocr';

export default function NewJobScreen({ navigation }) {
  const [vehicle, setVehicle] = React.useState({
    stockNumber: '',
    make: '',
    model: '',
    year: '',
    color: '',
  });
  const [loading, setLoading] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [scanAttempted, setScanAttempted] = React.useState(false);

  React.useEffect(() => {
    if (!scanAttempted) {
      handleScanKeytag();
    }
  }, [scanAttempted]);

  const handleScanKeytag = async () => {
    try {
      setScanAttempted(true);

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Required', 'Please allow camera access to scan keytags.');
        return;
      }

      setScanning(true);
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
      });

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

      const ocrData = await scanVehicleFromImage({
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
      });

      setVehicle({
        stockNumber: (ocrData.stockNumber || '').toUpperCase().slice(0, 50),
        make: (ocrData.make || '').slice(0, 50),
        model: (ocrData.model || '').slice(0, 50),
        year: (ocrData.year || '').slice(0, 4),
        color: (ocrData.color || '').slice(0, 30),
      });
    } catch (error) {
      const message = error?.response?.data?.error || error.message || 'Scan failed';
      Alert.alert('Scan Failed', message, [
        { text: 'Retry', onPress: handleScanKeytag },
        { text: 'Manual Entry', style: 'cancel' },
      ]);
    } finally {
      setScanning(false);
    }
  };

  const handleStartJob = async () => {
    console.log('Start job clicked');
    console.log('Current vehicle state:', vehicle);
    console.log('Stock empty?', !vehicle.stockNumber);
    
    if (!vehicle.stockNumber) {
      console.log('❌ VALIDATION FAILED: Please enter Stock Number');
      Alert.alert('Required', 'Please enter Stock Number');
      return;
    }

    try {
      console.log('Validation passed - creating job with vehicle:', vehicle);
      setLoading(true);
      const job = await createJob(vehicle);
      console.log('Job created:', job);
      navigation.replace('JobDetail', { jobId: job.jobId });
    } catch (error) {
      console.error('Error creating job:', error);
      Alert.alert('Error', 'Failed to start job: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.scanButton, scanning && styles.scanButtonDisabled]}
          onPress={handleScanKeytag}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.scanButtonText}>📸 Scan Keytag</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Vehicle Details</Text>
        
        <Text style={styles.label}>Stock Number</Text>
        <TextInput
          style={styles.input}
          value={vehicle.stockNumber}
          onChangeText={(text) => setVehicle({...vehicle, stockNumber: text.toUpperCase().slice(0, 50)})}
          autoCapitalize="characters"
          maxLength={50}
        />
        
        <Text style={styles.label}>Make</Text>
        <TextInput
          style={styles.input}
          value={vehicle.make}
          onChangeText={(text) => setVehicle({...vehicle, make: text.slice(0, 50)})}
          maxLength={50}
        />

        <Text style={styles.label}>Model</Text>
        <TextInput
          style={styles.input}
          value={vehicle.model}
          onChangeText={(text) => setVehicle({...vehicle, model: text.slice(0, 50)})}
          maxLength={50}
        />

        <View style={styles.row}>
          <View style={styles.halfInput}>
            <Text style={styles.label}>Year</Text>
            <TextInput
              style={styles.input}
              value={vehicle.year}
              onChangeText={(text) => setVehicle({...vehicle, year: text})}
              keyboardType="numeric"
              maxLength={4}
            />
          </View>

          <View style={styles.halfInput}>
            <Text style={styles.label}>Color</Text>
            <TextInput
              style={styles.input}
              value={vehicle.color}
              onChangeText={(text) => setVehicle({...vehicle, color: text.slice(0, 30)})}
              maxLength={30}
            />
          </View>
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.startButton, loading && styles.startButtonDisabled]} 
        onPress={handleStartJob}
        disabled={loading || scanning}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.startButtonText}>🚗 Begin Detailing</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: 'white',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  scanButton: {
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  scanButtonDisabled: {
    opacity: 0.6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  orText: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 15,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    flex: 1,
    marginHorizontal: 5,
  },
  startButton: {
    backgroundColor: '#667eea',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
});
