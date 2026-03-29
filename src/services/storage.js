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

// Check for existing active job by stock number
export const findActiveJobByStockNumber = async (stockNumber) => {
  try {
    const response = await axios.get(config.JOBS, { timeout: 5000 });
    const allJobs = response.data;
    return allJobs.find(job =>
      job.stockNumber === stockNumber &&
      (job.status === 'paused' || job.status === 'in_progress')
    );
  } catch (error) {
    console.log('Could not check server for active jobs:', error.message);
    return null;
  }
};

// Create new job (or resume existing paused job)
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
  
  // Check if there's an active job with this stock number
  const existingJob = await findActiveJobByStockNumber(sanitizedVehicleData.stockNumber);
  
  if (existingJob && existingJob.status === 'paused') {
    // Resume existing job with new detailer
    const resumeEvent = {
      type: 'resume',
      timestamp: now,
      detailerName: detailerName,
      detailerChange: true
    };
    
    // Add new detailer to detailers array if not already there
    const detailers = existingJob.detailers || [existingJob.detailerName];
    if (!detailers.includes(detailerName)) {
      detailers.push(detailerName);
    }
    
    // Initialize detailer time tracking if not present
    if (!existingJob.detailerTimeTracking) {
      existingJob.detailerTimeTracking = {};
    }
    
    // Calculate pause duration
    const lastPauseEvent = existingJob.pauseEvents[existingJob.pauseEvents.length - 1];
    const pauseDuration = now - lastPauseEvent.timestamp;
    existingJob.totalPauseTime += pauseDuration;
    
    // Update job
    existingJob.pauseEvents.push(resumeEvent);
    existingJob.status = 'in_progress';
    existingJob.currentDetailerStartTime = now; // Track when current detailer started
    existingJob.detailerName = detailerName; // Current detailer
    existingJob.detailers = detailers; // All detailers who worked on it
    existingJob.deviceId = deviceId; // Current device
    addCustodyEvent(existingJob, 'resume', detailerName, '');
    
    // Save locally and sync
    const jobs = await getLocalJobs();
    const localIndex = jobs.findIndex(j => j.jobId === existingJob.jobId);
    if (localIndex >= 0) {
      jobs[localIndex] = existingJob;
    } else {
      jobs.push(existingJob);
    }
    await saveLocalJobs(jobs);
    await syncJobToServer(existingJob);
    
    return existingJob;
  } else if (existingJob && existingJob.status === 'in_progress') {
    throw new Error('A job with this stock number is already in progress.');
  } else {
    // Create new job
    const job = {
      jobId: `job_${now}_${Math.random().toString(36).substr(2, 9)}`,
      deviceId,
      detailerName,
      detailers: [detailerName], // Track all detailers
      detailerTimeTracking: {}, // Track time per detailer
      currentDetailerStartTime: now, // When current detailer started working
      ...sanitizedVehicleData,
      startTime: now,
      endTime: null,
      totalPauseTime: 0,
      totalActiveTime: null,
      status: 'in_progress',
      pauseEvents: [],
      notes: [],
      photos: [],
      custodyEvents: [],
      latestNote: '',
      createdAt: now,
    };

    addCustodyEvent(job, 'start', detailerName, '');

    const jobs = await getLocalJobs();
    jobs.push(job);
    await saveLocalJobs(jobs);
    
    // Try to sync immediately
    await syncJobToServer(job);
    
    return job;
  }
};

// Update job
export const updateJob = async (jobId, updates) => {
  const jobs = await getLocalJobs();
  const index = jobs.findIndex(j => j.jobId === jobId);
  
  if (index !== -1) {
    jobs[index] = { ...jobs[index], ...updates };
    await saveLocalJobs(jobs);
    
    // Try to sync updated job
    await syncJobToServer(jobs[index]);
    
    return jobs[index];
  }
  
  return null;
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
export const pauseJob = async (jobId) => {
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
    addCustodyEvent(job, 'pause', job.detailerName, job.latestNote);
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
export const getTodayStats = async () => {
  const jobs = await syncJobsFromServer();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayJobs = jobs.filter(j => j.createdAt >= today.getTime());
  const completed = todayJobs.filter(j => j.status === 'completed');
  const inProgress = todayJobs.filter(j => j.status === 'in_progress' || j.status === 'paused');
  
  const totalTime = completed.reduce((sum, j) => sum + (j.totalActiveTime || 0), 0);
  const avgTime = completed.length > 0 ? totalTime / completed.length : 0;
  
  return {
    total: todayJobs.length,
    completed: completed.length,
    inProgress: inProgress.length,
    avgTime,
    totalTime,
  };
};
