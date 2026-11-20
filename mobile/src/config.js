import Constants from 'expo-constants';

// Where the backend runs. During development the phone loads the app from your computer
// (the "hostUri", for example 192.168.1.20:8081), so the backend is on the same computer, port 3000.
// If that ever fails, write your computer's address here instead, for example 'http://192.168.1.20:3000'.
const MANUAL_API_URL = '';

function guessApiUrl() {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const API_URL = MANUAL_API_URL || guessApiUrl();
