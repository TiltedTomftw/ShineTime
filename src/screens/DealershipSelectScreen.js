import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from '../components/ui';
import { colors, spacing, type } from '../theme';

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', detailer: 'Detailer', sales: 'Sales' };

export default function DealershipSelectScreen({ memberships, onSelect, onSignOut }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      <Text style={styles.title} accessibilityRole="header">
        Choose a dealership
      </Text>
      <Text style={styles.subtitle}>Where are you working today?</Text>

      <FlatList
        data={memberships}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card
            onPress={() => onSelect(item.dealershipId)}
            accessibilityLabel={`${item.dealership?.name || 'Dealership'}, ${ROLE_LABEL[item.role] || item.role}`}
            style={styles.card}
          >
            <View style={styles.cardText}>
              <Text style={styles.name}>{item.dealership?.name || 'Unnamed dealership'}</Text>
              <Text style={styles.meta}>{ROLE_LABEL[item.role] || item.role}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Card>
        )}
      />

      <Button
        title="Sign out"
        variant="ghost"
        onPress={onSignOut}
        style={{ marginBottom: insets.bottom + spacing.md }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  title: { ...type.largeTitle },
  subtitle: { ...type.subhead, marginTop: spacing.xs, marginBottom: spacing.lg },
  list: { paddingBottom: spacing.xl, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  cardText: { flex: 1 },
  name: { ...type.headline },
  meta: { ...type.footnote, marginTop: 2 },
});
