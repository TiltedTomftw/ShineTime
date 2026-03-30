# Shinetime

Simple mobile app for tracking vehicle detailing productivity at car dealerships.

## Architecture

**Simple local network setup - no cloud, no authentication, no complexity.**

- **Mobile App**: React Native + Expo (stores data locally, syncs to server)
- **Server**: Node.js + Express + SQLite (runs on manager's PC)
- **Dashboard**: HTML web page (served by the server)
- **Cost**: $0 forever

## How It Works

1. **Manager's PC** runs a simple server on local network
2. **Detailers** use mobile app to track jobs (works offline)
3. **Data syncs** automatically when phones are on WiFi
4. **Manager** views dashboard at `http://192.168.4.93:3000`

## Project Structure

```
Shinetime/
├── mobile-app/              # React Native Expo app
│   ├── App.js
│   ├── src/
│   │   ├── screens/        # HomeScreen, NewJobScreen, HistoryScreen
│   │   ├── navigation/     # React Navigation setup
│   │   ├── services/       # Storage & API services
│   │   └── config/         # API configuration
│   └── package.json
│
└── server/                  # Node.js server
    ├── server.js           # Express API + SQLite
    ├── public/
    │   └── index.html      # Manager dashboard
    └── package.json
```

## Setup Instructions

### 1. Mobile App Setup

```bash
# Install dependencies
npm install

# Start Expo development server
npm start

# Scan QR code with Expo Go app on your phone
```

### 2. Server Setup

```bash
# Navigate to server folder
cd server

# Install dependencies
npm install

# Start the server
npm start
```

The server will display your PC's IP address. Example:
```
Your PC IP addresses:
  - 192.168.1.100
```

### 3. Configure Mobile App

1. Open `src/config/api.js` in the mobile app
2. Update `SERVER_BASE_URL` with your PC's IP:
   ```javascript
  const SERVER_BASE_URL = 'http://192.168.1.100:3000';
   ```
3. Save and reload the app

### 4. Access Manager Dashboard

On the manager's PC, open a browser to:
- `http://192.168.4.93:3000` (on the same PC)
- `http://192.168.4.93:3000` (from other devices on the network)

## Usage

### For Detailers:

1. Open the app
2. Tap "Start New Job"
3. Enter VIN or Stock Number
4. Tap "Begin Detailing"
5. Use Pause/Resume as needed
6. Tap "Complete" when done

### For Managers:

1. Open web browser to server address
2. View real-time job status
3. See completed jobs and statistics
4. Dashboard auto-refreshes every 12 seconds

## Features

- ✅ Start/Pause/Resume/Complete jobs
- ✅ Track active time (excludes pauses)
- ✅ Works offline (syncs when online)
- ✅ Manager dashboard with notes, photos, and custody timelines
- ✅ OCR keytag scanning
- ✅ Photo uploads with storage limits + thumbnail previews
- ✅ Job history and reporting
- ✅ No login required
- ✅ Simple local network setup

## Upcoming Features

- 📷 Barcode scanner for VIN/Stock numbers
- 📊 Daily/weekly reports
- 🔔 Notifications for long-running jobs

## Development

### Run Mobile App

```bash
npm start           # Start Expo
npm run android     # Run on Android
npm run ios         # Run on iOS (Mac only)
```

### Run Server

```bash
cd server
npm start           # Production
npm run dev         # Development (auto-restart)
```

## Troubleshooting

### Mobile app can't connect to server

1. Make sure your phone and PC are on the same WiFi network
2. Check the IP address in `src/config/api.js` matches your PC's IP
3. Make sure the server is running (check terminal)
4. Try disabling your PC's firewall temporarily

### Server won't start

1. Make sure port 3000 isn't already in use
2. Check Node.js is installed: `node --version`
3. Reinstall dependencies: `cd server && npm install`

### App crashes or won't load

1. Clear Expo cache: `npx expo start --clear`
2. Reinstall dependencies: `rm -rf node_modules && npm install`
3. Make sure you're using Node.js LTS version

## Tech Stack

- **Mobile**: React Native, Expo, AsyncStorage, React Navigation, Axios
- **Server**: Node.js, Express, SQLite (better-sqlite3), CORS, Sharp (thumbnails)
- **Dashboard**: HTML, CSS, Vanilla JavaScript

## Requirements

- Node.js 18+ LTS
- Expo Go app (iOS/Android)
- Windows/Mac/Linux PC for server
- Local WiFi network

## License

Private project - All rights reserved
