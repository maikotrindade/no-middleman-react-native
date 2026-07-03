import { Button, StyleSheet, Text, View } from 'react-native';

export function HomeScreen({ onOpenTipCalculator }: { onOpenTipCalculator: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reference App</Text>
      <Text style={styles.subtitle}>No Middleman CI fixture</Text>
      <Button testID="open-tip-calculator" title="Tip Calculator" onPress={onOpenTipCalculator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#666' },
});
