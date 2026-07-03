import { by, device, element, expect } from 'detox';

describe('tip calculator', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('opens from the home screen', async () => {
    await element(by.id('open-tip-calculator')).tap();
    await expect(element(by.id('bill-input'))).toBeVisible();
  });

  it('shows the correct total for a 10% tip on $100', async () => {
    await element(by.id('bill-input')).typeText('100');
    await element(by.id('tip-input')).typeText('10');
    await element(by.id('calculate-button')).tap();
    // The acceptance contract: $100 bill + 10% tip = $110.00.
    // Red against the planted bug (which computes 100 + 100*10 = 1100).
    await expect(element(by.id('total-text'))).toHaveText('Total: 110.00');
  });
});
