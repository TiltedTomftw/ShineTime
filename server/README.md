# Server Setup Guide

## What is This?

This is a simple Node.js server that runs on the manager's PC. It:
- Stores all job data from detailers' phones
- Serves a web dashboard for viewing jobs
- Provides an API for the mobile app to sync data

## Installation

### Step 1: Install Node.js

1. Go to https://nodejs.org
2. Download the **LTS version** (recommended)
3. Run the installer
4. Verify installation:
   ```bash
   node --version
   npm --version
   ```

### Step 2: Install Server Dependencies

Open a terminal/command prompt in the `server` folder:

```bash
cd server
npm install
```

This installs:
- `express` - Web server framework
- `better-sqlite3` - Database
- `cors` - Allow mobile apps to connect
- `dotenv` - Load API keys from .env

### Step 3: Start the Server

Create a file named `.env` in the `server` folder with:
```
GEMINI_API_KEY=your_key_here
```

```bash
npm start
```

You should see:
```
╔═══════════════════════════════════════════╗
║   Shinetime Server Running                ║
╠═══════════════════════════════════════════╣
║   Dashboard: http://192.168.4.93:3000     ║
║   API:       http://192.168.4.93:3000/api ║
╠═══════════════════════════════════════════╣
║   Share this address with mobile devices: ║
║   http://YOUR-PC-IP:3000                  ║
╚═══════════════════════════════════════════╝

Your PC IP addresses:
  - 192.168.1.100
```

**Write down your IP address!** You'll need it for the mobile app.

---

## Accessing the Dashboard

### On the same PC:
Open browser to: `http://192.168.4.93:3000`

### From another computer/phone on the network:
Open browser to: `http://YOUR-PC-IP:3000`
(Replace YOUR-PC-IP with the IP shown when server started)

---

## Firewall Setup

If the mobile app can't connect, you may need to allow the server through Windows Firewall:

### Windows:
1. Search for "Windows Defender Firewall"
2. Click "Allow an app through firewall"
3. Click "Change settings"
4. Click "Allow another app"
5. Browse to `C:\Program Files\nodejs\node.exe`
6. Check both "Private" and "Public"
7. Click OK

### Mac:
1. System Preferences > Security & Privacy > Firewall
2. Click the lock and enter password
3. Click "Firewall Options"
4. Click "+" and add Terminal or Node
5. Set to "Allow incoming connections"

---

## Database

The database file is automatically created at `server/shinetime-detail-tracker.db`.

It's just a single file that stores everything. To backup, just copy this file.

### Viewing the Database

You can use these free tools to view the SQLite database:
- DB Browser for SQLite: https://sqlitebrowser.org/
- SQLite Viewer (VS Code extension)

---

## API Endpoints

The mobile app uses these endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Check if server is running |
| GET | `/api/jobs` | Get all jobs |
| POST | `/api/jobs` | Create or update a job |
| POST | `/api/jobs/sync` | Sync multiple jobs at once |
| GET | `/api/stats` | Get statistics (completed, in progress, etc.) |

---

## Troubleshooting

### Server won't start

**Error: Port 3000 already in use**
- Close any other programs using port 3000
- Or change the port in `server.js` (line 5):
  ```javascript
  const PORT = 3001; // Change to any available port
  ```

**Error: Cannot find module**
- Run `npm install` in the server folder

### Mobile app can't connect

1. **Check both devices are on same WiFi**
   - PC and phone must be on the same network
   - Guest networks often block device-to-device communication

2. **Verify the IP address**
   - The IP shown when server starts
   - Update `src/config/api.js` in mobile app with this IP

3. **Test the connection**
   - On your phone, open Safari/Chrome
   - Go to `http://YOUR-PC-IP:3000`
   - If dashboard loads, the connection works

4. **Check firewall** (see Firewall Setup above)

5. **Try disabling VPN** (if using one)

### Dashboard shows no jobs

- Make sure mobile app is configured with correct IP
- Check mobile app has synced (turn WiFi off and on)
- Look at server terminal for sync requests
- Refresh the dashboard page

---

## Running on Startup (Optional)

### Windows (using Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Name: "Shinetime Server"
4. Trigger: "When I log on"
5. Action: "Start a program"
6. Program: `C:\Program Files\nodejs\node.exe`
7. Arguments: `C:\path\to\server\server.js`
8. Start in: `C:\path\to\server`

### Mac (using launchd)

Create file: `~/Library/LaunchAgents/com.shinetime.detailtracker.server.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.shinetime.detailtracker.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/server/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Then: `launchctl load ~/Library/LaunchAgents/com.shinetime.detailtracker.server.plist`

---

## Maintenance

### Backup the Database

Copy `server/shinetime-detail-tracker.db` to a safe location regularly.

### Clear Old Data

You can delete old jobs directly from the database or via the API:

```bash
# Delete a specific job
curl -X DELETE http://192.168.4.93:3000/api/jobs/JOB_ID_HERE
```

### Update the Server

```bash
cd server
npm install
npm start
```

---

## Need Help?

Check the main README.md for more troubleshooting tips.
