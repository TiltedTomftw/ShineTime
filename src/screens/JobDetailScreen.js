import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Image, Platform, FlatList, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getJobById, pauseJob, resumeJob, completeJob, addJobNote, addJobPhoto } from '../services/storage';
import config from '../config/api';
import { useFocusEffect } from '@react-navigation/native';

export default function JobDetailScreen({ route, navigation }) {
  const { jobId } = route.params;
  const [job, setJob] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [showCompleteModal, setShowCompleteModal] = React.useState(false);
  const [noteText, setNoteText] = React.useState('');
  const [photoLoading, setPhotoLoading] = React.useState(false);
  const [showPauseNoteModal, setShowPauseNoteModal] = React.useState(false);
  const [pauseNoteText, setPauseNoteText] = React.useState('');
  const [showPhotoModal, setShowPhotoModal] = React.useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);

  const photoUrls = (job?.photos || []).map(photo => `${config.ASSET_BASE_URL}${photo.url}`);

  const loadJob = async () => {
    const jobData = await getJobById(jobId);
    setJob(jobData);
  };

  useFocusEffect(
    React.useCallback(() => {
      loadJob();
    }, [jobId])
  );

  const handlePause = async () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Pause Job',
        'Add a note (optional)',
        async (text) => {
          setLoading(true);
          try {
            await pauseJob(jobId, text || '');
            await loadJob();
            Alert.alert('Success', 'Job paused');
          } catch (error) {
            Alert.alert('Error', error.message);
          }
          setLoading(false);
        },
        'plain-text'
      );
    } else {
      setPauseNoteText('');
      setShowPauseNoteModal(true);
    }
  };

  const handlePauseWithNote = async () => {
    setLoading(true);
    try {
      await pauseJob(jobId, pauseNoteText || '');
      await loadJob();
      setShowPauseNoteModal(false);
      Alert.alert('Success', 'Job paused');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await resumeJob(jobId);
      await loadJob();
      Alert.alert('Success', 'Job resumed');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleComplete = async () => {
    console.log('Complete button clicked');
    setLoading(true);
    try {
      console.log('Calling completeJob with jobId:', jobId);
      await completeJob(jobId);
      console.log('Job completed successfully, navigating back');
      setShowCompleteModal(false);
      navigation.goBack();
    } catch (error) {
      console.error('Error completing job:', error);
      Alert.alert('Error', error.message);
      setLoading(false);
      setShowCompleteModal(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      Alert.alert('Note Required', 'Please enter a note.');
      return;
    }
    setLoading(true);
    try {
      await addJobNote(jobId, noteText);
      setNoteText('');
      await loadJob();
    } catch (error) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleAddPhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Required', 'Please allow camera access to add photos.');
        return;
      }

      setPhotoLoading(true);
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
      });

      if (result.canceled) {
        setPhotoLoading(false);
        return;
      }

      const asset = result.assets && result.assets[0];
      if (!asset || !asset.base64) {
        setPhotoLoading(false);
        Alert.alert('Photo Failed', 'No image data found.');
        return;
      }

      const response = await addJobPhoto(jobId, {
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
      });

      if (response.warning) {
        Alert.alert('Storage Warning', response.warning);
      }

      await loadJob();
    } catch (error) {
      Alert.alert('Photo Failed', error.message);
    }
    setPhotoLoading(false);
  };

  const handleOpenPhoto = (photoUrl, index) => {
    setActivePhotoIndex(index);
    setShowPhotoModal(true);
  };

  if (!job) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  const now = Date.now();
  const lastPause = job.pauseEvents && job.pauseEvents.length > 0
    ? job.pauseEvents[job.pauseEvents.length - 1]
    : null;
  const currentPauseDuration = job.status === 'paused' && lastPause && lastPause.type === 'pause'
    ? now - lastPause.timestamp
    : 0;
  const elapsedTime = now - job.startTime - job.totalPauseTime - currentPauseDuration;
  const isPaused = job.status === 'paused';
  const isCompleted = job.status === 'completed';

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <View style={styles.statusHeader}>
          <View style={[styles.statusBadge, 
            isCompleted ? styles.statusCompleted : 
            isPaused ? styles.statusPaused : 
            styles.statusInProgress
          ]}>
            <Text style={styles.statusText}>
              {isCompleted ? '✓ Completed' : isPaused ? '⏸ Paused' : '⏱ In Progress'}
            </Text>
          </View>
        </View>

        {/* Vehicle Info */}
        {job.stockNumber ? <Text style={styles.vehicleText}>Stock #: {job.stockNumber}</Text> : null}
        {job.make || job.model ? (
          <Text style={styles.infoText}>{job.make} {job.model} {job.year ? `(${job.year})` : ''}{job.color ? ` • ${job.color}` : ''}</Text>
        ) : null}
        
        {/* Job Info */}
        <View style={styles.divider} />
        <Text style={styles.infoText}>
          Detailer{job.detailers && job.detailers.length > 1 ? 's' : ''}: {' '}
          <Text style={styles.boldText}>
            {job.detailers && job.detailers.length > 1 
              ? job.detailers.join(' → ') 
              : (job.detailerName || 'Unknown')}
          </Text>
        </Text>
        <Text style={styles.infoText}>Started: {new Date(job.startTime).toLocaleString()}</Text>
        {isCompleted && job.endTime ? (
          <Text style={styles.infoText}>Completed: {new Date(job.endTime).toLocaleString()}</Text>
        ) : null}
        
        {/* Time Tracking */}
        <View style={styles.divider} />
        {isCompleted ? (
          <Text style={styles.timeText}>Total Time: {formatTime(job.totalActiveTime)}</Text>
        ) : (
          <Text style={styles.timeText}>Elapsed: {formatTime(elapsedTime)}</Text>
        )}
        {job.totalPauseTime > 0 && (
          <Text style={styles.infoText}>Pause Time: {formatTime(job.totalPauseTime)}</Text>
        )}
        
        {job.detailerTimeTracking && Object.keys(job.detailerTimeTracking).length > 1 && (
          <View style={styles.detailerTimeBreakdown}>
            <Text style={styles.smallLabel}>Time per Detailer:</Text>
            {Object.entries(job.detailerTimeTracking).map(([detailer, time]) => (
              <Text key={detailer} style={styles.detailerTimeText}>
                • {detailer}: {formatTime(time)}
              </Text>
            ))}
          </View>
        )}
      </View>

      {!isCompleted && (
        <View style={styles.actions}>
          {loading ? (
            <ActivityIndicator size="large" color="#667eea" />
          ) : (
            <>
              {isPaused ? (
                <TouchableOpacity style={styles.resumeButton} onPress={handleResume}>
                  <Text style={styles.buttonText}>▶ Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pauseButton} onPress={handlePause}>
                  <Text style={styles.buttonText}>⏸ Pause</Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity style={styles.completeButton} onPress={() => setShowCompleteModal(true)}>
                <Text style={styles.buttonText}>✓ Complete Job</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notes</Text>
        {!isCompleted && (
          <View style={styles.noteInputRow}>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Add a note"
              multiline={false}
              maxLength={500}
              returnKeyType="done"
              onSubmitEditing={handleAddNote}
              blurOnSubmit
            />
            <TouchableOpacity style={styles.noteButton} onPress={handleAddNote} disabled={loading}>
              <Text style={styles.noteButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
        )}
        {job.notes && job.notes.length > 0 ? (
          job.notes.map((note, index) => (
            <View key={`${note.timestamp}-${index}`} style={styles.noteItem}>
              <Text style={styles.noteMeta}>
                {formatTimestamp(note.timestamp)} · {note.detailerName || 'Unknown'}
              </Text>
              <Text style={styles.noteText}>{note.text}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No notes yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photos</Text>
        {!isCompleted && (
          <TouchableOpacity style={styles.photoButton} onPress={handleAddPhoto} disabled={photoLoading}>
            {photoLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.photoButtonText}>Add Photo</Text>
            )}
          </TouchableOpacity>
        )}
        {job.photos && job.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
            {job.photos.map((photo, index) => {
              const thumbUrl = photo.thumbUrl || photo.url;
              return (
                <TouchableOpacity
                  key={`${photo.timestamp}-${index}`}
                  onPress={() => handleOpenPhoto(`${config.ASSET_BASE_URL}${photo.url}`, index)}
                >
                  <Image
                    source={{ uri: `${config.ASSET_BASE_URL}${thumbUrl}` }}
                    style={styles.photoThumb}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <Text style={styles.emptyText}>No photos yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chain of Custody</Text>
        {job.custodyEvents && job.custodyEvents.length > 0 ? (
          [...job.custodyEvents]
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((event, index) => (
              <View key={`${event.timestamp}-${index}`} style={styles.custodyItem}>
                <Text style={styles.custodyMeta}>
                  {formatTimestamp(event.timestamp)} · {event.detailerName || 'Unknown'}
                </Text>
                <Text style={styles.custodyText}>Action: {formatCustodyAction(event.type)}</Text>
                {event.type !== 'resume' && event.type !== 'start' && event.type !== 'complete' && event.note ? (
                  <Text style={styles.custodyNote}>Note: {event.note}</Text>
                ) : null}
              </View>
            ))
        ) : (
          <Text style={styles.emptyText}>No custody history yet.</Text>
        )}
      </View>

      <Modal
        visible={showCompleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCompleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Complete Job?</Text>
            <Text style={styles.modalText}>Mark this job as completed?</Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalButtonCancel} 
                onPress={() => setShowCompleteModal(false)}
                disabled={loading}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.modalButtonConfirm} 
                onPress={handleComplete}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonTextConfirm}>Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPauseNoteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPauseNoteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pause Job</Text>
            <Text style={styles.modalText}>Add a note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              value={pauseNoteText}
              onChangeText={setPauseNoteText}
              placeholder="Pause note"
              multiline
              maxLength={500}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowPauseNoteModal(false)}
                disabled={loading}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonConfirm}
                onPress={handlePauseWithNote}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonTextConfirm}>Pause</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPhotoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPhotoModal(false)}
      >
        <View style={styles.photoModalOverlay}>
          <TouchableOpacity
            style={styles.photoModalClose}
            onPress={() => setShowPhotoModal(false)}
          >
            <Text style={styles.photoModalCloseText}>×</Text>
          </TouchableOpacity>
          <FlatList
            data={photoUrls}
            horizontal
            pagingEnabled
            initialScrollIndex={activePhotoIndex}
            showsHorizontalScrollIndicator={false}
            style={styles.photoModalList}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: Dimensions.get('window').width,
              offset: Dimensions.get('window').width * index,
              index,
            })}
            keyExtractor={(item, index) => `${item}-${index}`}
            onMomentumScrollEnd={(event) => {
              const width = Dimensions.get('window').width;
              const index = Math.round(event.nativeEvent.contentOffset.x / width);
              setActivePhotoIndex(index);
            }}
            renderItem={({ item }) => (
              <View style={styles.photoModalPage}>
                <Image source={{ uri: item }} style={styles.photoModalImage} resizeMode="contain" />
              </View>
            )}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

function formatTime(ms) {
  if (!ms) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString();
}

function formatCustodyAction(type) {
  switch (type) {
    case 'start':
      return 'Started';
    case 'pause':
      return 'Paused';
    case 'resume':
      return 'Resumed';
    case 'complete':
      return 'Completed';
    default:
      return type || 'Unknown';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  statusHeader: {
    alignItems: 'center',
    marginBottom: 15,
  },
  statusBadge: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  statusInProgress: {
    backgroundColor: '#667eea',
  },
  statusPaused: {
    backgroundColor: '#f59e0b',
  },
  statusCompleted: {
    backgroundColor: '#10b981',
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  vehicleText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#667eea',
    marginBottom: 5,
  },
  infoText: {
    fontSize: 16,
    color: '#666',
    marginTop: 6,
  },
  boldText: {
    fontWeight: 'bold',
    color: '#333',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  timeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#667eea',
    marginBottom: 5,
  },
  smallLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  actions: {
    padding: 15,
    gap: 15,
  },
  pauseButton: {
    backgroundColor: '#f59e0b',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  resumeButton: {
    backgroundColor: '#10b981',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#667eea',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  detailerTimeBreakdown: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  detailerTimeText: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 10,
    marginTop: 5,
  },
  noteInputRow: {
    marginBottom: 12,
  },
  noteInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  noteButton: {
    backgroundColor: '#667eea',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  noteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  noteItem: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    marginTop: 10,
  },
  noteMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  noteText: {
    fontSize: 14,
    color: '#111827',
  },
  custodyItem: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    marginTop: 10,
  },
  custodyMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  custodyText: {
    fontSize: 14,
    color: '#111827',
  },
  custodyNote: {
    fontSize: 13,
    color: '#374151',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  photoButton: {
    backgroundColor: '#667eea',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  photoButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  photoRow: {
    flexDirection: 'row',
  },
  photoThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#e5e7eb',
  },
  photoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalImage: {
    width: '100%',
    height: '100%',
  },
  photoModalList: {
    width: '100%',
    height: '100%',
  },
  photoModalPage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalCloseText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 25,
    width: '85%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 25,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButtonCancel: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  modalButtonConfirm: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#667eea',
    alignItems: 'center',
  },
  modalButtonTextCancel: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextConfirm: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
