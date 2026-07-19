import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { getAllJobs, getDetailerName, getActiveOperationalUserId } from '../services/storage';
import { computeLiveElapsed, jobBelongsToOperator } from '../services/jobLogic';
import { formatDuration } from '../services/timeMath';
import { useFocusEffect } from '@react-navigation/native';
import { VehicleSummary } from '../components/VehicleSummary';

export default function HistoryScreen({ navigation }) {
  const [jobs, setJobs] = React.useState([]);

  const loadJobs = async () => {
    const allJobs = await getAllJobs();
    const [currentName, currentId] = await Promise.all([
      getDetailerName(),
      getActiveOperationalUserId(),
    ]);
    // Scope to the current operator by stable id (falls back to name for legacy jobs).
    const userJobs = allJobs.filter((job) => jobBelongsToOperator(job, currentId, currentName));
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
                  ? `Completed: ${formatDuration(item.totalActiveTime)}`
                  : `In progress: ${formatDuration(computeLiveElapsed(item))}`}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
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
