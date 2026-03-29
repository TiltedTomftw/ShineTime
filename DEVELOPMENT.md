# Shinetime - Development Guide

## Simplified Architecture

**Local network only. No Firebase, no authentication, no cloud.**

- Mobile phones store data locally
- Sync to local server when on WiFi
- Manager views dashboard on their PC
- Everything runs at the dealership

---

## Quick Start

### Manager's PC Setup (5 minutes)

1. **Install Node.js** - Download from nodejs.org
2. **Open terminal** in the `server` folder
3. **Run commands:**
   ```bash
   npm install
   npm start
   ```
4. **Note your IP address** (server will display it)
5. **Open browser** to `http://192.168.4.93:3000`

### Mobile App Setup (10 minutes)

1. **Install Expo Go** app on your phone (App Store/Play Store)
2. **Open terminal** in project root
3. **Run commands:**
   ```bash
   npm install
   npm start
   ```
4. **Scan QR code** with Expo Go app
5. **Update API config** - Edit `src/config/api.js` with server IP

---

## Development Milestones

### ✅ MILESTONE 1: Basic Setup (DONE)
- [x] Project initialized
- [x] Server created with SQLite database
- [x] Manager dashboard HTML created
- [x] Mobile app structure created
- [x] Navigation setup
- [x] Storage service created

### 🔄 MILESTONE 2: Core Job Flow (IN PROGRESS)

**Goal**: Detailers can start and complete jobs

**Tasks:**
1. Connect NewJobScreen to storage service
2. Create job when "Begin Detailing" pressed
3. Show active job on HomeScreen
4. Add timer display (counts up)
5. Add "Complete Job" button
6. Save completed job to storage
7. Test sync to server

**Files to modify:**
- `src/screens/HomeScreen.js` - Load and display active jobs
- `src/screens/NewJobScreen.js` - Connect form to createJob()
- Create `src/components/ActiveJobCard.js` - Display job with timer

**Complete when:**
- Can start a job from HomeScreen
- Timer shows elapsed time
- Can complete job
- Job appears in History
- Job syncs to server

---

### MILESTONE 3: Pause/Resume Timer

**Goal**: Detailers can pause and resume jobs

**Tasks:**
1. Add Pause button to ActiveJobCard
2. Connect to pauseJob() function
3. Add Resume button (shows when paused)
4. Visual indication when paused
5. Time calculation excludes pause time
6. Test multiple pause/resume cycles

**Files to modify:**
- `src/components/ActiveJobCard.js` - Add pause/resume buttons

**Complete when:**
- Can pause active job
- Can resume paused job
- Timer stops when paused
- Final time excludes pause duration

---

### MILESTONE 4: Barcode Scanning

**Goal**: Scan VINs instead of typing

**Tasks:**
1. Install expo-barcode-scanner
2. Request camera permissions
3. Create BarcodeScannerScreen
4. Add "Scan VIN" button to NewJobScreen
5. Parse scanned data and auto-fill VIN field
6. Handle scan errors

**Files to create:**
- `src/screens/BarcodeScannerScreen.js`

**Files to modify:**
- `src/screens/NewJobScreen.js` - Add scan button
- `src/navigation/AppNavigator.js` - Add scanner route

**Complete when:**
- Can scan VIN barcode
- VIN auto-fills in form
- Manual entry still works

---

### MILESTONE 5: Polish & Testing

**Goal**: Make it production-ready

**Tasks:**
1. Add loading states
2. Add error handling
3. Improve styling
4. Add app icon
5. Test all flows end-to-end
6. Test offline mode
7. Test sync after offline work
8. User testing with 2-3 detailers

**Complete when:**
- No crashes
- Works offline
- Looks professional
- Detailers can use it easily

---

## File Structure Reference

```
Shinetime/
│
├── App.js                          # Main app entry
│
├── src/
│   ├── config/
│   │   └── api.js                 # Server IP configuration
│   │
│   ├── services/
│   │   └── storage.js             # All data operations
│   │
│   ├── navigation/
│   │   └── AppNavigator.js        # Screen routing
│   │
│   ├── screens/
│   │   ├── HomeScreen.js          # Dashboard
│   │   ├── NewJobScreen.js        # Start new job
│   │   └── HistoryScreen.js       # Past jobs
│   │
│   └── components/
│       └── ActiveJobCard.js       # (Create this) Job timer card
│
└── server/
    ├── server.js                   # API + Database
   ├── shinetime-detail-tracker.db # SQLite database (auto-created)
    └── public/
        └── index.html             # Manager dashboard
```

---

## Key Functions Reference

### Storage Service (`src/services/storage.js`)

```javascript
// Create new job
await createJob({ vin, stockNumber, make, model, year, color })

// Get active jobs
await getActiveJobs()

// Pause job
await pauseJob(jobId)

// Resume job
await resumeJob(jobId)

// Complete job
await completeJob(jobId)

// Get completed jobs
await getCompletedJobs()

// Sync to server
await syncAllJobs()
```

---

## API Endpoints

**Base URL**: `http://YOUR-PC-IP:3000/api`

- `GET /api/health` - Check if server is running
- `GET /api/jobs` - Get all jobs
- `POST /api/jobs` - Create/update single job
- `POST /api/jobs/sync` - Sync multiple jobs
- `GET /api/stats` - Get statistics
- `DELETE /api/jobs/:jobId` - Delete job

---

## Testing Checklist

### Basic Flow
- [ ] Start a job with VIN only
- [ ] Start a job with Stock Number only
- [ ] Add vehicle details (make/model/year/color)
- [ ] Complete a job
- [ ] View completed job in history
- [ ] Check job appears on manager dashboard

### Pause/Resume
- [ ] Pause an active job
- [ ] Resume a paused job
- [ ] Pause multiple times
- [ ] Complete while paused
- [ ] Verify time excludes pauses

### Offline Mode
- [ ] Turn off WiFi
- [ ] Start a job
- [ ] Complete a job
- [ ] Turn WiFi back on
- [ ] Verify job syncs to server

### Multi-Device
- [ ] Start job on Phone 1
- [ ] Start job on Phone 2
- [ ] Both appear on dashboard
- [ ] Complete both jobs
- [ ] History shows both

---

## Common Issues & Solutions

### "Cannot connect to server"
- Check IP address in `src/config/api.js`
- Ensure phone and PC on same WiFi
- Check server is running
- Try pinging PC from phone

### "Timer not updating"
- Use `setInterval` in useEffect
- Clean up interval on unmount
- Update state every second

### "Data not syncing"
- Check network connection
- Check API_BASE_URL is correct
- Check server logs for errors
- Verify CORS is enabled on server

### "App crashes when scanning"
- expo-barcode-scanner needs physical device
- Request camera permissions
- Handle permission denied gracefully

---

## Next Steps After MVP

### Phase 2 Features
- Photo documentation (before/after)
- Detailer profiles
- Job assignment (manager assigns to detailer)
- Push notifications
- Export reports to CSV

### Phase 3 - Multi-Location
- Add dealershipId to data model
- Support multiple locations
- Cloud hosting option
- Web dashboard for remote management

---

## Getting Help

- Expo docs: https://docs.expo.dev
- React Navigation: https://reactnavigation.org
- SQLite: https://github.com/WiseLibs/better-sqlite3

---

**Remember**: Start simple. Get one feature working completely before adding the next. Test on real devices, not just simulators.
