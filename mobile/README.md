# GIU on the Move: Mobile app (React Native, Expo)

The app riders, drivers and the admin use. It talks only to the backend (never to the database).
So far the **rider screens** are built: log in, today's timetable, live trip tracking on a map with the
ETA to your stop, reminders (2, 5 or 10 minutes), "the bus is full" reports and calling the driver
(only if the driver shares the number).

## Run it on your phone

1. Install **Expo Go** on your phone (Play Store / App Store).
2. Make sure the **backend is running** on the computer (`cd backend` then `npm start`).
3. The phone and the computer must be on the **same Wi-Fi**.
4. In a new terminal:
   ```
   cd mobile
   npm install
   npx expo start
   ```
5. Scan the QR code: Android with the Expo Go app, iPhone with the Camera app.
6. Log in with `student01` / `demo1234`.

The app finds the backend by itself (same computer, port 3000). The login screen shows the address it uses.
If it cannot reach it, write your computer's address in `src/config.js` (`MANUAL_API_URL`).

## Files

- `App.js`: logging in, staying logged in, and choosing the screen
- `src/screens/`: `LoginScreen`, `TimetableScreen` (today's trips), `TripScreen` (live map and ETA)
- `src/components/BusMap.js`: the map (Leaflet + OpenStreetMap inside a WebView)
- `src/api.js`: calls to the backend and the live connection (Socket.io)

## Not built yet

Driver and admin screens, and push notifications (reminders are saved, but nothing sends them yet).
