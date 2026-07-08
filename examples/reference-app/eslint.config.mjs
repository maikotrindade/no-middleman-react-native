import tseslint from 'typescript-eslint';

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: ['jest.config.js', 'metro.config.js', '.detoxrc.js', 'e2e/jest.config.js', '.nm/', 'android/'],
});
