import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

export function TipCalculatorScreen() {
  const [bill, setBill] = useState('');
  const [tipPercent, setTipPercent] = useState('');
  const [total, setTotal] = useState<number | null>(null);

  const onCalculate = () => {
    const billValue = Number(bill);
    const percentValue = Number(tipPercent);
    // PLANTED BUG (§11): hand-rolled math instead of src/lib/tip.ts —
    // the percentage is applied as a multiplier without dividing by 100.
    // Unit tests cover the (correct) lib, so only an E2E flow catches this.
    setTotal(billValue + billValue * percentValue);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tip Calculator</Text>
      <TextInput
        testID="bill-input"
        style={styles.input}
        placeholder="Bill amount"
        keyboardType="numeric"
        value={bill}
        onChangeText={setBill}
      />
      <TextInput
        testID="tip-input"
        style={styles.input}
        placeholder="Tip %"
        keyboardType="numeric"
        value={tipPercent}
        onChangeText={setTipPercent}
      />
      <Button testID="calculate-button" title="Calculate" onPress={onCalculate} />
      {total !== null && (
        <Text testID="total-text" style={styles.total}>
          Total: {total.toFixed(2)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  total: { fontSize: 20, textAlign: 'center', marginTop: 12 },
});
