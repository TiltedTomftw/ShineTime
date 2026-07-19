import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { getAllJobs, getDetailerName } from '../services/storage';
import { useFocusEffect } from '@react-navigation/native';
import { VehicleSummary } from '../components/VehicleSummary';

export default function HistoryScreen({ navigation }) {
  const [jobs, setJobs] = React.useState([]);

  const loadJobs = async () => {
    const allJobs = await getAllJobs();
    const currentUser = await getDetailerName();
    // Filter to only show current user's jobs
    const userJobs = allJobs.filter((job) => job.detailerName === currentUser);
    setJobs(userJobs);
  };

  useFocusEffect(
    React.useCallback(() => {
      loadJobs();
    }, []),
  );

  return (
    <View style={styles.container}>
      {jobs.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Jobs Yet</Text>
          <Text style={styles.emptyText}>Your jobs will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.jobId}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.jobCard}
              onPress={() => navigation.navigate('JobDetail', { jobId: item.jobId })}
            >
              <View style={styles.jobHeader}>
                <VehicleSummary job={item} style={{ flex: 1, marginRight: 8 }} />
                <View
                  style={[
                    styles.statusBadge,
                    item.status === 'completed'
                      ? styles.statusCompleted
                      : item.status === 'paused'
                        ? styles.statusPaused
                        : styles.statusInProgress,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {item.status === 'completed' ? '✓' : item.status === 'paused' ? '⏸' : '⏱'}
                  </Text>
                </View>
              </View>
              <Text style={styles.jobDetail}>{item.detailerName || 'Unknown detailer'}</Text>
              <Text style={styles.jobDetail}>
                {item.status === 'completed'
                  ? `Completed: ${formatTime(item.totalActiveTime)}`
                  : `In progress: ${formatTime(getElapsedTime(item))}`}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function getElapsedTime(job) {
  const now = Date.now();
  const lastPause =
    job.pauseEvents && job.pauseEvents.length > 0
      ? job.pauseEvents[job.pauseEvents.length - 1]
      : null;
  const currentPauseDuration =
    job.status === 'paused' && lastPause && lastPause.type === 'pause'
      ? now - lastPause.timestamp
      : 0;
  return now - job.startTime - job.totalPauseTime - currentPauseDuration;
}

function formatTime(ms) {
  if (!ms) return '--';
  const minutes = Math.floor(ms / 60000);
  return `${minutes} min`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  jobCard: {
    backgroundColor: 'white',
    margin: 15,
    marginBottom: 10,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  statusBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  jobDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 3,
  },
});
