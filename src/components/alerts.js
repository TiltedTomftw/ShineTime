// Alert helpers that also work in the web build (react-native-web's Alert is a
// no-op, so confirmations and errors silently vanished there).
import { Alert, Platform } from 'react-native';

export function alertMessage(title, message) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

// Two-choice confirmation. `onConfirm` runs only if the person agrees.
export function confirmAction({
  title,
  message,
  confirmText = 'OK',
  destructive = false,
  onConfirm,
}) {
  if (Platform.OS === 'web') {
    if (window.confirm(message ? `${title}\n\n${message}` : title)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
