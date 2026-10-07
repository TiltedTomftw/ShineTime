import React from 'react';
import { FlatList, Image, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './ui';
import { colors, spacing } from '../theme';
import { formatWhen } from '../services/timeMath';

// Full-screen swipeable photo viewer. Render it with key={index} so each
// opening starts on the tapped photo.
export default function PhotoViewer({ photos, index, onClose }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = React.useState(index || 0);
  const visible = index !== null && index !== undefined;

  const photo = photos[current];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {visible ? (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image
                  source={{ uri: item.url }}
                  style={{ width, height: height * 0.8 }}
                  resizeMode="contain"
                  accessibilityLabel={`Photo by ${item.detailerName}`}
                />
              </View>
            )}
          />
        ) : null}
        <View style={[styles.top, { top: insets.top + spacing.sm }]}>
          <Text style={styles.caption}>
            {photo
              ? `${current + 1} of ${photos.length} · ${photo.detailerName} · ${
                  photo.pending ? 'uploading' : formatWhen(photo.timestamp)
                }`
              : ''}
          </Text>
          <IconButton
            icon="close"
            label="Close photo"
            onPress={onClose}
            color={colors.white}
            size={28}
            style={styles.close}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  top: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  caption: { color: colors.white, fontSize: 14, flex: 1 },
  close: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 24 },
});
