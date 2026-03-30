import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import config from '../config/api';

// Sanitize input to prevent XSS and injection attacks
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  // Remove any HTML tags, scripts, and dangerous characters
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 200); // Max 200 characters
};

const STORAGE_KEYS = {
  JOBS: '@detailtracker_jobs',
  DEVICE_ID: '@detailtracker_device_id',
  DETAILER_NAME: '@detailtracker_detailer_name',
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const addCustodyEvent = (job, type, detailerName, note) => {
  const custodyEvents = ensureArray(job.custodyEvents);
  custodyEvents.push({
    type,
    timestamp: Date.now(),
    detailerName: detailerName || 'Unknown',
    note: note || '',
  });
  job.custodyEvents = custodyEvents;
};

// Generate unique device ID
export const getDeviceId = async () => {
  let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  return deviceId;
};

// Store detailer name
export const setDetailerName = async (name) => {
  await AsyncStorage.setItem(STORAGE_KEYS.DETAILER_NAME, name);
};

export const getDetailerName = async () => {
  return await AsyncStorage.getItem(STORAGE_KEYS.DETAILER_NAME);
};

// Sync jobs from server
export const syncJobsFromServer = async () => {
  try {
    const detailerName = await getDetailerName();
    const response = await axios.get(config.JOBS, { timeout: 5000 });
    const serverJobs = response.data;
    
    // Filter to only this detailer's jobs
    const myJobs = serverJobs.filter(job => job.detailerName === detailerName);
    
    // Save to local storage
    await saveLocalJobs(myJobs);
    console.log(`Synced ${myJobs.length} jobs from server`);
    return myJobs;
  } catch (error) {
    console.log('Could not sync from server:', error.message);
    // Return local jobs as fallback
    return await getLocalJobs();
  }
};

// Get all jobs from local storage
export const getLocalJobs = async () => {
  try {
    const jobsJson = await AsyncStorage.getItem(STORAGE_KEYS.JOBS);
    return jobsJson ? JSON.parse(jobsJson) : [];
  } catch (error) {
    console.error('Error getting local jobs:', error);
    return [];
  }
};

// Save jobs to local storage
export const saveLocalJobs = async (jobs) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(jobs));
  } catch (error) {
    console.error('Error saving local jobs:', error);
  }
};

// Create new job
export const createJob = async (vehicleData) => {
  const deviceId = await getDeviceId();
  const detailerName = await getDetailerName();
  const now = Date.now();
  
  // Sanitize all vehicle data inputs
  const sanitizedVehicleData = {
    stockNumber: sanitizeInput(vehicleData.stockNumber),
    make: sanitizeInput(vehicleData.make),
    model: sanitizeInput(vehicleData.model),
    year: sanitizeInput(vehicleData.year),
    color: sanitizeInput(vehicleData.color),
  };

  const jobId = `job_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const detailers = detailerName ? [detailerName] : [];

  const newJob = {
    jobId,
    deviceId,
    detailerName: detailerName || 'Unknown',
    detailers,
    startTime: now,
    currentDetailerStartTime: now,
    totalPauseTime: 0,
    totalActiveTime: 0,
    status: 'in_progress',
    pauseEvents: [],
    notes: [],
    latestNote: '',
    custodyEvents: [],
    detailerTimeTracking: {},
    createdAt: now,
    updatedAt: now,
    ...sanitizedVehicleData,
  };

  addCustodyEvent(newJob, 'start', detailerName, '');

  const jobs = await getLocalJobs();
  jobs.unshift(newJob);
  await saveLocalJobs(jobs);
  await syncJobToServer(newJob);
  return newJob;
};

// Get active jobs - syncs from server first
export const getActiveJobs = async () => {
  const jobs = await syncJobsFromServer();
  return jobs.filter(j => j.status === 'in_progress');
};

// Get completed jobs - syncs from server first
export const getCompletedJobs = async (filterDate = null) => {
  const jobs = await syncJobsFromServer();
  let completed = jobs.filter(j => j.status === 'completed');
  
  if (filterDate) {
    completed = completed.filter(j => {
      const jobDate = new Date(j.createdAt);
      const filterDateObj = new Date(filterDate);
      return jobDate.toDateString() === filterDateObj.toDateString();
    });
  }
  
  return completed.sort((a, b) => b.createdAt - a.createdAt);
};

// Pause job
export const pauseJob = async (jobId, noteText = '') => {
  const pauseTime = Date.now();
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);
  
  if (job && job.status === 'in_progress') {
    // Track current detailer's time before pausing
    if (!job.detailerTimeTracking) job.detailerTimeTracking = {};
    const detailerTime = job.detailerTimeTracking[job.detailerName] || 0;
    const sessionTime = pauseTime - (job.currentDetailerStartTime || job.startTime);
    job.detailerTimeTracking[job.detailerName] = detailerTime + sessionTime;
    
    job.pauseEvents.push({ 
      type: 'pause', 
      timestamp: pauseTime,
      detailerName: job.detailerName 
    });
    job.status = 'paused';
    const detailerName = await getDetailerName();
    const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);
    if (sanitizedNote) {
      const notes = ensureArray(job.notes);
      notes.unshift({
        timestamp: Date.now(),
        detailerName: detailerName || 'Unknown',
        text: sanitizedNote,
      });
      job.notes = notes;
      job.latestNote = sanitizedNote;
    }
    addCustodyEvent(job, 'pause', detailerName, sanitizedNote);
    await saveLocalJobs(jobs);
    await syncJobToServer(job);
    return job;
  }
  
  return null;
};

// Resume job
export const resumeJob = async (jobId) => {
  const resumeTime = Date.now();
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);
  
  if (job && job.status === 'paused') {
    const lastPause = job.pauseEvents[job.pauseEvents.length - 1];
    if (lastPause && lastPause.type === 'pause') {
      const pauseDuration = resumeTime - lastPause.timestamp;
      job.totalPauseTime += pauseDuration;
    }
    
    job.pauseEvents.push({ 
      type: 'resume', 
      timestamp: resumeTime,
      detailerName: job.detailerName 
    });
    job.status = 'in_progress';
    job.currentDetailerStartTime = resumeTime; // Reset start time for current detailer
    addCustodyEvent(job, 'resume', job.detailerName, '');
    await saveLocalJobs(jobs);
    await syncJobToServer(job);
    return job;
  }
  
  return null;
};

// Complete job
export const completeJob = async (jobId) => {
  console.log('Completing job:', jobId);
  const endTime = Date.now();
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);
  
  if (!job) {
    console.error('Job not found:', jobId);
    throw new Error('Job not found');
  }
  
  console.log('Found job:', job);
  
  // If job was paused, calculate final pause time
  if (job.status === 'paused') {
    const lastPause = job.pauseEvents[job.pauseEvents.length - 1];
    if (lastPause && lastPause.type === 'pause') {
      const pauseDuration = endTime - lastPause.timestamp;
      job.totalPauseTime += pauseDuration;
    }
  }
  
  // Track final detailer's time
  if (!job.detailerTimeTracking) job.detailerTimeTracking = {};
  const detailerTime = job.detailerTimeTracking[job.detailerName] || 0;
  const sessionTime = endTime - (job.currentDetailerStartTime || job.startTime);
  job.detailerTimeTracking[job.detailerName] = detailerTime + sessionTime;
  
  job.endTime = endTime;
  job.totalActiveTime = endTime - job.startTime - job.totalPauseTime;
  job.status = 'completed';
  addCustodyEvent(job, 'complete', job.detailerName, '');
  
  console.log('Saving completed job:', job);
  console.log('Detailer time breakdown:', job.detailerTimeTracking);
  await saveLocalJobs(jobs);
  await syncJobToServer(job);
  console.log('Job completed successfully');
  return job;
};

// Add a note to an in-progress job
export const addJobNote = async (jobId, noteText) => {
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status === 'completed') {
    throw new Error('Cannot add notes to a completed job');
  }

  const detailerName = await getDetailerName();
  const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);

  if (!sanitizedNote) {
    throw new Error('Note cannot be empty');
  }

  const notes = ensureArray(job.notes);
  notes.unshift({
    timestamp: Date.now(),
    detailerName: detailerName || 'Unknown',
    text: sanitizedNote,
  });

  job.notes = notes;
  job.latestNote = sanitizedNote;

  await saveLocalJobs(jobs);
  await syncJobToServer(job);
  return job;
};

// Add a photo to a job (stored on server)
export const addJobPhoto = async (jobId, image) => {
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status === 'completed') {
    throw new Error('Cannot add photos to a completed job');
  }

  const payload = image.dataUrl
    ? { dataUrl: image.dataUrl, note: image.note || '' }
    : { imageBase64: image.base64, mimeType: image.mimeType, note: image.note || '' };

  const response = await axios.post(config.JOB_PHOTOS(jobId), payload, {
    timeout: 20000,
  });

  const updatedJob = response.data.job || job;
  const index = jobs.findIndex(j => j.jobId === jobId);
  if (index !== -1) {
    jobs[index] = updatedJob;
    await saveLocalJobs(jobs);
  }

  if (response.data.storageWarning) {
    return { job: updatedJob, warning: response.data.storageWarning };
  }

  return { job: updatedJob };
};

// Sync single job to server
export const syncJobToServer = async (job) => {
  try {
    await axios.post(config.JOBS, job, {
      timeout: 5000,
    });
    return true;
  } catch (error) {
    console.log('Could not sync to server (offline?):', error.message);
    return false;
  }
};

// Sync all local jobs to server
export const syncAllJobs = async () => {
  try {
    const jobs = await getLocalJobs();
    if (jobs.length === 0) return { success: true, synced: 0 };
    
    const response = await axios.post(config.JOBS_SYNC, { jobs }, {
      timeout: 10000,
    });
    
    return response.data;
  } catch (error) {
    console.log('Could not sync all jobs:', error.message);
    return { success: false, synced: 0, error: error.message };
  }
};

// Check server connection
export const checkServerConnection = async () => {
  try {
    await axios.get(config.HEALTH, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
};

// Get all jobs (for history) - syncs from server first
export const getAllJobs = async () => {
  const jobs = await syncJobsFromServer();
  // Sort by most recent first
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
};

// Get job by ID
export const getJobById = async (jobId) => {
  const jobs = await getLocalJobs();
  return jobs.find(j => j.jobId === jobId);
};

// Get today's stats - syncs from server first
export const getOverallStats = async () => {
  const jobs = await syncJobsFromServer();

  const completed = jobs.filter(j => j.status === 'completed');
  const inProgress = jobs.filter(j => j.status === 'in_progress' || j.status === 'paused');

  const totalTime = completed.reduce((sum, j) => sum + (j.totalActiveTime || 0), 0);
  const avgTime = completed.length > 0 ? totalTime / completed.length : 0;

  return {
    total: jobs.length,
    completed: completed.length,
    inProgress: inProgress.length,
    avgTime,
    totalTime,
  };
};
