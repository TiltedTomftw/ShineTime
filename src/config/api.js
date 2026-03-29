// API Configuration
// Set the server base URL here (IP:port or tunnel URL)
const SERVER_BASE_URL = 'https://promoted-kidney-fathers-leu.trycloudflare.com';
const ASSET_BASE_URL = SERVER_BASE_URL;
const API_BASE_URL = `${SERVER_BASE_URL}/api`;

export default {
  API_BASE_URL,
  ASSET_BASE_URL,
  
  // API Endpoints
  HEALTH: `${API_BASE_URL}/health`,
  JOBS: `${API_BASE_URL}/jobs`,
  JOBS_SYNC: `${API_BASE_URL}/jobs/sync`,
  STATS: `${API_BASE_URL}/stats`,
  OCR_VEHICLE: `${API_BASE_URL}/ocr/vehicle`,
  JOB_PHOTOS: (jobId) => `${API_BASE_URL}/jobs/${jobId}/photos`,
  
  // Sync settings
  AUTO_SYNC: true,
  SYNC_INTERVAL: 60000, // Sync every 60 seconds when on WiFi
};
