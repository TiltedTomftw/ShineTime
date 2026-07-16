import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, type } from '../theme';

// Canonical vehicle labeling used across every screen so ordering is consistent:
// Stock # (headline) → Year Make Model → Color → VIN (optional, at the bottom).

export const vehicleTitle = (job) => (job?.stockNumber ? `#${job.stockNumber}` : 'No Stock #');

export const vehicleDescription = (job) => {
  const yearMakeModel = [job?.year, job?.make, job?.model].filter(Boolean).join(' ');
  return [yearMakeModel, job?.color].filter(Boolean).join('  ·  ');
};

// Compact block for list rows / cards. VIN shown only if present (optional).
export function VehicleSummary({ job, style }) {
  const desc = vehicleDescription(job);
  return (
    <View style={style}>
      <Text style={styles.title} numberOfLines={1}>{vehicleTitle(job)}</Text>
      {!!desc && <Text style={styles.desc} numberOfLines={1}>{desc}</Text>}
      {!!job?.vin && <Text style={styles.vin} numberOfLines={1}>VIN · {job.vin}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...type.headline },
  desc: { ...type.subhead, marginTop: 2 },
  vin: { ...type.footnote, color: colors.textTertiary, marginTop: 2 },
});
