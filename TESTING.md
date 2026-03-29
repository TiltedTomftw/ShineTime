# Testing Shinetime

## ✅ Server is Running!

Your server is live at:
- **Dashboard**: http://192.168.4.93:3000
- **Your PC IP**: 192.168.4.93

---

## Testing on PC (Right Now)

### 1. View the Dashboard
The Simple Browser should show the manager dashboard with:
- Stats cards (all showing 0 since no data yet)
- Empty jobs table
- Auto-refresh every 10 seconds

### 2. Test the API
Open PowerShell and run these commands to test:

```powershell
# Check server health
curl http://192.168.4.93:3000/api/health

# Create a test job
curl -X POST http://192.168.4.93:3000/api/jobs -H "Content-Type: application/json" -d '{\"jobId\":\"test123\",\"deviceId\":\"testdevice\",\"vin\":\"1HGBH41JXMN109186\",\"make\":\"Honda\",\"model\":\"Accord\",\"startTime\":1700000000000,\"status\":\"in_progress\",\"createdAt\":1700000000000}'

# View all jobs
curl http://192.168.4.93:3000/api/jobs

# Get stats
curl http://192.168.4.93:3000/api/stats
```

### 3. View Test Data in Dashboard
After creating the test job, refresh the dashboard - you should see it appear!

---

## Testing Mobile App

### Option 1: Test on Your Phone (Recommended)

1. **Make sure your phone is on the same WiFi as this PC**

2. **Update the API config**:
   - Open `src/config/api.js`
   - Change line 3 to:
     ```javascript
   const API_BASE_URL = 'http://192.168.4.93:3000/api';
     ```

3. **Install Expo Go** on your phone:
   - iOS: https://apps.apple.com/app/expo-go/id982107779
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent

4. **Start the mobile app**:
   ```bash
   npm start
   ```

5. **Scan the QR code** with:
   - iOS: Camera app → opens Expo Go automatically
   - Android: Expo Go app → Scan QR Code button

6. **Test the app**:
   - Tap "Start New Job"
   - Enter a VIN (like: 1HGBH41JXMN109186)
   - Fill in vehicle details
   - Tap "Begin Detailing"
   - Check dashboard on PC - job should appear!

### Option 2: Test in iOS Simulator (Mac Only)

```bash
npm run ios
```

### Option 3: Test in Android Emulator

1. Install Android Studio
2. Create an emulator
3. Run:
   ```bash
   npm run android
   ```

### Option 4: Test in Web Browser (Limited)

```bash
npm run web
```

Note: Barcode scanner won't work in browser, but you can test the UI.

---

## What You Can Test

### Basic Flow:
1. ✅ Server runs and shows dashboard
2. ✅ Mobile app connects to server
3. ✅ Create a job from mobile app
4. ✅ Job appears on dashboard in real-time
5. ✅ Complete job and see stats update

### Advanced (once basic flow works):
- Pause/Resume jobs
- Work offline and sync later
- Multiple devices syncing
- History view

---

## Troubleshooting

### "Can't connect to server" on mobile
- Check phone and PC are on **same WiFi**
- Verify IP in `src/config/api.js` matches: **192.168.4.27**
- Try opening `http://192.168.4.93:3000` in phone's browser
- Check Windows Firewall isn't blocking port 3000

### Dashboard shows nothing
- Refresh the page
- Check server terminal for errors
- Try the curl commands above to add test data

### Mobile app crashes
- Run: `npx expo start --clear`
- Make sure you're using Expo Go app, not regular web browser

---

## Current Status

**Server**: ✅ Running on port 3000
**Database**: ✅ SQLite file (shinetime-detail-tracker.db)
**Dashboard**: ✅ Accessible at 192.168.4.93:3000
**Mobile App**: ⏳ Ready to start (npm start)

**Next**: Test creating jobs and see them sync!
