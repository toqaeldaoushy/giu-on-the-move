import AsyncStorage from '@react-native-async-storage/async-storage';

// The rider's usual stop on each line, kept on the phone: every trip then opens on it.
const key = (userId, routeId) => `giu-fav-stop:${userId}:${routeId}`;

export async function getFavoriteStop(userId, routeId) {
  try {
    const v = await AsyncStorage.getItem(key(userId, routeId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export async function setFavoriteStop(userId, routeId, stopId) {
  try {
    if (stopId == null) await AsyncStorage.removeItem(key(userId, routeId));
    else await AsyncStorage.setItem(key(userId, routeId), String(stopId));
  } catch {
    /* the favorite is a convenience; the trip still works without it */
  }
}
