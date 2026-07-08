import { useState } from 'react';
import { HomeScreen } from './src/screens/HomeScreen';
import { TipCalculatorScreen } from './src/screens/TipCalculatorScreen';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'tip-calculator'>('home');
  return screen === 'home' ? (
    <HomeScreen onOpenTipCalculator={() => setScreen('tip-calculator')} />
  ) : (
    <TipCalculatorScreen />
  );
}
