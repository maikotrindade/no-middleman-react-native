export function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateTip(bill: number, tipPercent: number): number {
  return roundToCents(bill * (tipPercent / 100));
}

export function calculateTotal(bill: number, tipPercent: number): number {
  return roundToCents(bill + calculateTip(bill, tipPercent));
}
