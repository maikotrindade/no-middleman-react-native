import { calculateTip, calculateTotal, roundToCents } from '../tip';

describe('tip math', () => {
  it('rounds to cents', () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(1.004)).toBe(1);
  });

  it('calculates the tip from a percentage', () => {
    expect(calculateTip(100, 10)).toBe(10);
    expect(calculateTip(23.5, 15)).toBe(3.53);
  });

  it('calculates the total including tip', () => {
    expect(calculateTotal(100, 10)).toBe(110);
    expect(calculateTotal(23.5, 15)).toBe(27.03);
    expect(calculateTotal(0, 20)).toBe(0);
  });
});
