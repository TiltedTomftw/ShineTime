import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getOverallStats, getAllJobs } from '../services/storage';
import { useFocusEffect } from '@react-navigation/native';
import { vehicleTitle, vehicleDescription } from '../components/VehicleSummary';
import { useAuth } from '../context/AuthContext';

export default function HomeScreen({ navigation }) {
  const { activeOperationalRole, activeDealership, signOut } = useAuth();
  const isManager = (activeOperationalRole || '').toLowerCase() === 'manager';
  const [stats, setStats] = React.useState({
    completed: 0,
    inProgress: 0,
    avgTime: 0,
  });
  const [recentJobs, setRecentJobs] = React.useState([]);
  const [pausedCount, setPausedCount] = React.useState(0);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      const loadData = async () => {
        try {
          const overallStats = await getOverallStats();
          if (!active) return;
          setStats(overallStats);
          const allJobs = await getAllJobs();
          if (!active) return;
          setRecentJobs(allJobs.slice(0, 8));
          setPausedCount(allJobs.filter((j) => j.status === 'paused').length);
        } catch (error) {
          console.log('Could not load home data:', error?.message || error);
        }
      };
      loadData();
      // Cancel state updates if the screen blurs/unmounts mid-load.
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Shinetime</Text>
        <Text style={styles.subtitle}>
          {isManager ? `${activeDealership?.dealership?.name || 'Dealership'} Manager Dashboard` : 'Detailer Dashboard'}
        </Text>
      </View>

      <View style={styles.stats}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.completed}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => navigation.navigate('InProgress')}
        >
          <Text style={styles.statValue}>{stats.inProgress}</Text>
          <Text style={styles.statLabel}>{isManager ? 'Active' : 'In Progress'}</Text>
        </TouchableOpacity>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{isManager ? pausedCount : (Math.round(stats.avgTime / 60000) || '--')}</Text>
          <Text style={styles.statLabel}>{isManager ? 'Paused' : 'Avg Time (min)'}</Text>
        </View>
      </View>

      {!isManager && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('NewJob')}
        >
          <Text style={styles.primaryButtonText}>+ Start New Job</Text>
        </TouchableOpacity>
      )}

      {isManager && (
        <View style={styles.managerPanel}>
          <Text style={styles.managerTitle}>Recent Jobs</Text>
          {recentJobs.length === 0 ? (
            <Text style={styles.managerEmpty}>No jobs found yet.</Text>
          ) : (
            recentJobs.map((job) => (
              <TouchableOpacity
                key={job.jobId}
                style={styles.managerRow}
                onPress={() => navigation.navigate('JobDetail', { jobId: job.jobId })}
              >
                <View style={styles.managerRowLeft}>
                  <Text style={styles.managerVehicle}>{vehicleTitle(job)}</Text>
                  <Text style={styles.managerMeta}>{[vehicleDescription(job), job.detailerName || 'Unknown', job.status || 'queued'].filter(Boolean).join('  ·  ')}</Text>
                </View>
                <Text style={styles.managerChevron}>></Text>
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity
            style={styles.inviteButton}
            onPress={() => navigation.navigate('ManageInviteCodes')}
          >
            <Text style={styles.inviteButtonText}>+ Invite Team Member</Text>
          </TouchableOpacity>

          <View style={styles.managerActions}>
            <TouchableOpacity
              style={[styles.managerActionButton, styles.managerActionDanger]}
              onPress={signOut}
            >
              <Text style={styles.managerActionText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => navigation.navigate('History')}
      >
        <Text style={styles.secondaryButtonText}>{isManager ? 'View All Dealership Jobs' : 'View Job History'}</Text>
      </TouchableOpacity>

      {!isManager && (
        <TouchableOpacity
          style={styles.changeRoleButton}
          onPress={signOut}
        >
          <Text style={styles.changeRoleButtonText}>Log Out</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 30,
    paddingTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    marginTop: -30,
  },
  statCard: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  primaryButton: {
    backgroundColor: '#667eea',
    margin: 20,
    marginBottom: 10,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'white',
    margin: 20,
    marginTop: 0,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#667eea',
  },
  secondaryButtonText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '600',
  },
  changeRoleButton: {
    marginHorizontal: 20,
    marginTop: -8,
    marginBottom: 20,
    alignItems: 'center',
    paddingVertical: 10,
  },
  changeRoleButtonText: {
    color: '#667eea',
    fontWeight: '700',
    fontSize: 14,
  },
  managerPanel: {
    backgroundColor: 'white',
    marginHorizontal: 20,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  managerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  managerEmpty: {
    color: '#777',
  },
  managerRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  managerRowLeft: {
    flex: 1,
    marginRight: 8,
  },
  managerVehicle: {
    color: '#222',
    fontWeight: '600',
  },
  managerMeta: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  managerChevron: {
    color: '#667eea',
    fontWeight: '700',
    fontSize: 18,
  },
  inviteButton: {
    marginTop: 12,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  inviteButtonText: {
    color: '#4338ca',
    fontWeight: '700',
  },
  managerActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  managerActionButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  managerActionGhost: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  managerActionDanger: {
    backgroundColor: '#ef4444',
  },
  managerActionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  managerActionGhostText: {
    color: '#4338ca',
  },
});
