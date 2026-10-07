// React Native wiring for the outbox (see outboxCore.js for the rules).
// Sends automatically: right after each action, when the network comes back,
// when the app returns to the foreground, and every 20s while anything waits.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { createOutbox } from './outboxCore';
import { isTransientError, friendlyErrorMessage } from './jobLogic';
import { sendEntry } from './jobSync';

const KEY_PREFIX = '@shinetime_outbox:';
const RETRY_INTERVAL_MS = 20000;

const deleteFile = async (uri) => {
  if (!uri || Platform.OS === 'web') return;
  const file = new File(uri);
  if (file.exists) file.delete();
};

export const outbox = createOutbox({
  storage: AsyncStorage,
  send: sendEntry,
  deleteFile,
  isTransient: isTransientError,
  describeFailure: (error, entry) =>
    friendlyErrorMessage(error, { stockNumber: entry && entry.stockNumber }),
});

let online = true;
const onlineListeners = new Set();
export const isOnline = () => online;
export const subscribeOnline = (listener) => {
  onlineListeners.add(listener);
  listener(online);
  return () => onlineListeners.delete(listener);
};

let started = false;
let timer = null;

const flushSoon = () => {
  outbox.flush().catch(() => {});
};

// Called once per sign-in with the person's user id.
export const startOutbox = async (userId) => {
  await outbox.setOwner(userId ? `${KEY_PREFIX}${userId}` : null);
  if (!started) {
    started = true;
    NetInfo.addEventListener((state) => {
      const next = state.isConnected !== false && state.isInternetReachable !== false;
      const cameBack = next && !online;
      online = next;
      onlineListeners.forEach((l) => l(online));
      if (cameBack) flushSoon();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') flushSoon();
    });
    outbox.subscribe(({ pending }) => {
      if (pending > 0 && !timer) {
        timer = setInterval(flushSoon, RETRY_INTERVAL_MS);
      } else if (pending === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    });
  }
  flushSoon();
};

// Sign-out: delete everything this person had waiting, files included.
export const stopOutbox = async () => {
  await outbox.clear();
};

export const flushOutbox = () => outbox.flush();
