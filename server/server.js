const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = 3000;

// Initialize SQLite database
const dbFileName = 'shinetime-detail-tracker.db';
const legacyDbFileName = 'detailtracker.db';
const dbPath = path.join(__dirname, dbFileName);
const legacyDbPath = path.join(__dirname, legacyDbFileName);

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const uploadsDir = path.join(__dirname, 'public', 'uploads');
const thumbsDir = path.join(uploadsDir, 'thumbs');
const maxStorageBytes = parseInt(process.env.MAX_STORAGE_BYTES || '', 10) || 1024 * 1024 * 1024;

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(thumbsDir)) {
  fs.mkdirSync(thumbsDir, { recursive: true });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY,
    status TEXT,
    deviceId TEXT,
    createdAt INTEGER,
    updatedAt INTEGER,
    data TEXT NOT NULL
  );
`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Shinetime server is running' });
});

// Get all jobs
app.get('/api/jobs', (req, res) => {
  try {
    const { status, deviceId, startDate, endDate } = req.query;

    const where = [];
    const params = {};

    if (status) {
      where.push('status = @status');
      params.status = status;
    }
    if (deviceId) {
      where.push('deviceId = @deviceId');
      params.deviceId = deviceId;
    }
    if (startDate) {
      where.push('createdAt >= @startDate');
      params.startDate = parseInt(startDate);
    }
    if (endDate) {
      where.push('createdAt <= @endDate');
      params.endDate = parseInt(endDate);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT data FROM jobs ${whereClause} ORDER BY createdAt DESC`).all(params);
    const jobs = rows.map(r => JSON.parse(r.data));

    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get job by ID
app.get('/api/jobs/:jobId', (req, res) => {
  try {
    const row = db.prepare('SELECT data FROM jobs WHERE jobId = ?').get(req.params.jobId);
    const job = row ? JSON.parse(row.data) : null;
    
    if (job) {
      res.json(job);
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sanitize input helper
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, 200);
}

function sanitizeJobPayload(job) {
  const sanitized = { ...job };

  if (sanitized.stockNumber) sanitized.stockNumber = sanitizeInput(sanitized.stockNumber);
  if (sanitized.make) sanitized.make = sanitizeInput(sanitized.make);
  if (sanitized.model) sanitized.model = sanitizeInput(sanitized.model);
  if (sanitized.year) sanitized.year = sanitizeInput(sanitized.year);
  if (sanitized.color) sanitized.color = sanitizeInput(sanitized.color);
  if (sanitized.detailerName) sanitized.detailerName = sanitizeInput(sanitized.detailerName);
  if (sanitized.detailType) sanitized.detailType = sanitizeInput(sanitized.detailType);
  if (sanitized.latestNote) sanitized.latestNote = sanitizeInput(sanitized.latestNote);
  if (sanitized.detailers) sanitized.detailers = sanitized.detailers.map(d => sanitizeInput(d));

  if (Array.isArray(sanitized.notes)) {
    sanitized.notes = sanitized.notes.map(note => ({
      ...note,
      detailerName: sanitizeInput(note.detailerName || ''),
      text: sanitizeInput(note.text || ''),
    }));
  }

  if (Array.isArray(sanitized.custodyEvents)) {
    sanitized.custodyEvents = sanitized.custodyEvents.map(event => ({
      ...event,
      detailerName: sanitizeInput(event.detailerName || ''),
      note: sanitizeInput(event.note || ''),
      type: sanitizeInput(event.type || ''),
    }));
  }

  if (Array.isArray(sanitized.photos)) {
    sanitized.photos = sanitized.photos.map(photo => ({
      ...photo,
      detailerName: sanitizeInput(photo.detailerName || ''),
      note: sanitizeInput(photo.note || ''),
    }));
  }

  return sanitized;
}

function extractJsonFromText(text) {
  if (!text) return null;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const jsonText = text.slice(first, last + 1);
  return JSON.parse(jsonText);
}

function stripCodeFences(text) {
  if (!text) return text;
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '').trim();
  }
  return trimmed;
}

function safeParseJson(text) {
  if (!text) return null;
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    return extractJsonFromText(cleaned);
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function getFileSizeSafe(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getDirectorySize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        total += getFileSizeSafe(fullPath);
      }
    }
  } catch {
    return total;
  }
  return total;
}

function getStorageUsageBytes() {
  return getFileSizeSafe(dbPath) + getDirectorySize(uploadsDir);
}

function getExtensionForMime(mimeType) {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

function loadJobById(jobId) {
  const row = db.prepare('SELECT data FROM jobs WHERE jobId = ?').get(jobId);
  return row ? JSON.parse(row.data) : null;
}

function saveJob(job) {
  const now = Date.now();
  const createdAt = job.createdAt || now;
  const updatedAt = now;
  const storedJob = {
    ...job,
    createdAt,
    updatedAt,
  };

  db.prepare(`
    INSERT INTO jobs (jobId, status, deviceId, createdAt, updatedAt, data)
    VALUES (@jobId, @status, @deviceId, @createdAt, @updatedAt, @data)
    ON CONFLICT(jobId) DO UPDATE SET
      status = excluded.status,
      deviceId = excluded.deviceId,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt,
      data = excluded.data
  `).run({
    jobId: storedJob.jobId,
    status: storedJob.status || null,
    deviceId: storedJob.deviceId || null,
    createdAt: storedJob.createdAt || null,
    updatedAt: storedJob.updatedAt || null,
    data: JSON.stringify(storedJob),
  });

  return storedJob;
}

// Create or update job
app.post('/api/jobs', (req, res) => {
  try {
    let job = req.body || {};
    const now = Date.now();

    if (!job.jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    
    job = sanitizeJobPayload(job);

    const existingRow = db.prepare('SELECT createdAt FROM jobs WHERE jobId = ?').get(job.jobId);
    const createdAt = job.createdAt || (existingRow ? existingRow.createdAt : now);
    const updatedAt = now;

    const storedJob = {
      ...job,
      createdAt,
      updatedAt,
    };

    db.prepare(`
      INSERT INTO jobs (jobId, status, deviceId, createdAt, updatedAt, data)
      VALUES (@jobId, @status, @deviceId, @createdAt, @updatedAt, @data)
      ON CONFLICT(jobId) DO UPDATE SET
        status = excluded.status,
        deviceId = excluded.deviceId,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        data = excluded.data
    `).run({
      jobId: storedJob.jobId,
      status: storedJob.status || null,
      deviceId: storedJob.deviceId || null,
      createdAt: storedJob.createdAt || null,
      updatedAt: storedJob.updatedAt || null,
      data: JSON.stringify(storedJob),
    });

    res.json({ success: true, message: 'Job saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// OCR keytag/window sticker and extract vehicle data
app.post('/api/ocr/vehicle', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server OCR is not configured' });
    }

    const { imageBase64, mimeType, dataUrl } = req.body || {};
    let image = null;

    if (dataUrl) {
      image = parseDataUrl(dataUrl);
    } else if (imageBase64 && mimeType) {
      image = { base64: imageBase64, mimeType };
    }

    if (!image || !image.base64 || !image.mimeType) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const prompt =
      'You are extracting vehicle details from a keytag or window sticker. ' +
      'Return JSON only with keys: stockNumber, make, model, year, color. ' +
      'Use empty strings if missing. Do not include extra keys or commentary.';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'OCR request failed', details: errorText });
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('\n').trim();
    const parsed = safeParseJson(text);

    if (!parsed) {
      const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
      const safety = data?.promptFeedback ? JSON.stringify(data.promptFeedback).slice(0, 500) : '';
      return res.status(422).json({
        error: 'Could not parse OCR response',
        details: [
          `finishReason: ${finishReason}`,
          safety ? `promptFeedback: ${safety}` : '',
          text ? `raw: ${text.slice(0, 500)}` : 'raw: <empty>',
        ].filter(Boolean).join('\n'),
      });
    }

    const result = {
      stockNumber: sanitizeInput(parsed.stockNumber || ''),
      make: sanitizeInput(parsed.make || ''),
      model: sanitizeInput(parsed.model || ''),
      year: sanitizeInput(parsed.year || ''),
      color: sanitizeInput(parsed.color || ''),
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a photo to a job (stored on server)
app.post('/api/jobs/:jobId/photos', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { imageBase64, mimeType, dataUrl, note } = req.body || {};

    const job = loadJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let image = null;
    if (dataUrl) {
      image = parseDataUrl(dataUrl);
    } else if (imageBase64 && mimeType) {
      image = { base64: imageBase64, mimeType };
    }

    if (!image || !image.base64 || !image.mimeType) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const currentUsage = getStorageUsageBytes();
    const incomingBytes = Math.floor((image.base64.length * 3) / 4);
    const projectedUsage = currentUsage + incomingBytes;

    if (projectedUsage > maxStorageBytes) {
      return res.status(413).json({
        error: 'Storage limit exceeded',
        details: `Max storage ${Math.round(maxStorageBytes / 1024 / 1024)} MB`,
      });
    }

    const extension = getExtensionForMime(image.mimeType);
    const fileName = `${jobId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const filePath = path.join(uploadsDir, fileName);
    const fileUrl = `/uploads/${fileName}`;

    const imageBuffer = Buffer.from(image.base64, 'base64');
    fs.writeFileSync(filePath, imageBuffer);

    let thumbUrl = '';
    try {
      const thumbName = fileName.replace(/\.[^.]+$/, '_thumb.jpg');
      const thumbPath = path.join(thumbsDir, thumbName);
      thumbUrl = `/uploads/thumbs/${thumbName}`;

      await sharp(imageBuffer)
        .rotate()
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(thumbPath);
    } catch (thumbError) {
      console.log('Thumbnail creation failed:', thumbError.message);
      thumbUrl = '';
    }

    const photos = Array.isArray(job.photos) ? job.photos : [];
    const detailerName = sanitizeInput(job.detailerName || 'Unknown');
    const photoNote = sanitizeInput(note || '').slice(0, 500);
    const photo = {
      url: fileUrl,
      thumbUrl,
      timestamp: Date.now(),
      detailerName,
      note: photoNote,
    };

    photos.unshift(photo);
    job.photos = photos;

    const storedJob = saveJob(job);
    const warningThreshold = Math.floor(maxStorageBytes * 0.9);
    const storageWarning = projectedUsage >= warningThreshold
      ? `Storage nearing limit: ${Math.round(projectedUsage / 1024 / 1024)} MB used`
      : '';

    res.json({ photo, job: storedJob, storageWarning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync multiple jobs at once
app.post('/api/jobs/sync', (req, res) => {
  try {
    const jobs = req.body && Array.isArray(req.body.jobs) ? req.body.jobs : null;
    const now = Date.now();
    let synced = 0;

    if (!jobs) {
      return res.status(400).json({ error: 'jobs array is required' });
    }

    const upsertJob = db.prepare(`
      INSERT INTO jobs (jobId, status, deviceId, createdAt, updatedAt, data)
      VALUES (@jobId, @status, @deviceId, @createdAt, @updatedAt, @data)
      ON CONFLICT(jobId) DO UPDATE SET
        status = excluded.status,
        deviceId = excluded.deviceId,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        data = excluded.data
    `);

    const getCreatedAt = db.prepare('SELECT createdAt FROM jobs WHERE jobId = ?');

    const syncJobs = db.transaction((items) => {
      for (const rawJob of items) {
        const job = sanitizeJobPayload(rawJob || {});
        if (!job || !job.jobId) continue;
        const existing = getCreatedAt.get(job.jobId);
        const createdAt = job.createdAt || (existing ? existing.createdAt : now);
        const storedJob = {
          ...job,
          createdAt,
          updatedAt: now,
        };
        upsertJob.run({
          jobId: storedJob.jobId,
          status: storedJob.status || null,
          deviceId: storedJob.deviceId || null,
          createdAt: storedJob.createdAt || null,
          updatedAt: storedJob.updatedAt || null,
          data: JSON.stringify(storedJob),
        });
        synced++;
      }
    });

    syncJobs(jobs);

    res.json({ success: true, synced, message: `${synced} jobs synced successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/stats', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = [];
    const params = {};

    if (startDate) {
      where.push('createdAt >= @startDate');
      params.startDate = parseInt(startDate);
    }
    if (endDate) {
      where.push('createdAt <= @endDate');
      params.endDate = parseInt(endDate);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT data FROM jobs ${whereClause}`).all(params);
    const jobs = rows.map(r => JSON.parse(r.data));

    const completed = jobs.filter(j => j.status === 'completed');
    const inProgress = jobs.filter(j => j.status === 'in_progress').length;
    
    const totalTime = completed.reduce((sum, j) => sum + (j.totalActiveTime || 0), 0);
    const avgTime = completed.length > 0 ? totalTime / completed.length : 0;

    const stats = {
      total: completed.length,
      inProgress: inProgress,
      avgTime: avgTime,
      totalTime: totalTime
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete job (for testing)
app.delete('/api/jobs/:jobId', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM jobs WHERE jobId = ?').run(req.params.jobId);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Job deleted' });
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all jobs (useful for testing/reset)
app.delete('/api/jobs', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count;
    db.prepare('DELETE FROM jobs').run();
    res.json({ success: true, message: `Cleared ${count} jobs from database` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Shinetime Server Running                ║
╠═══════════════════════════════════════════╣
║   Dashboard: http://localhost:${PORT}      ║
║   API:       http://localhost:${PORT}/api ║
╠═══════════════════════════════════════════╣
║   Share this address with mobile devices: ║
║   http://YOUR-PC-IP:${PORT}                ║
╚═══════════════════════════════════════════╝
  `);
  
  // Get local IP address
  const os = require('os');
  const nets = os.networkInterfaces();
  console.log('\nYour PC IP addresses:');
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  - ${net.address}`);
      }
    }
  }
  console.log('\nUse one of these IPs in your mobile app config.\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nServer stopped.');
  process.exit(0);
});
