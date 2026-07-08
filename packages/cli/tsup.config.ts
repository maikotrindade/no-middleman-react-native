import { defineConfig } from 'tsup';

// §publish: bundle the three internal @no-middleman/* libs + xstate into one
// self-contained package (no-middleman-rn) so consumers `npm i -g` and run `nm`
// with zero build step and zero runtime dependencies.
export default defineConfig({
  entry: ['src/main.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  dts: { entry: 'src/index.ts' }, // ship types for the library entry only
  noExternal: [/^@no-middleman\//, 'xstate'], // inline; everything else is node: builtins
});
