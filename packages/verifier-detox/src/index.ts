import { resolve } from 'node:path';
import type { Verifier, VerifierSignal } from '@no-middleman/core';
import { ensureBuild } from './build-cache.js';
import { ensureEmulator, reversePort, shutdownEmulator } from './emulator.js';
import { runDetoxSuite } from './detox-run.js';
import { startMetro } from './metro.js';

export interface DetoxVerifierOptions {
  /** App directory; relative paths resolve against the loop context cwd. */
  appDir?: string;
  configuration: string; // e.g. 'android.emu.debug'
  avdName: string;
  bootTimeoutMs?: number;
  binaryPaths?: string[];
  buildCommand?: string;
  buildArgs?: string[];
  maxRuns?: number;
  metroPort?: number;
  manageEmulator?: boolean; // default true
  manageMetro?: boolean; // default true
  id?: string;
}

const DEFAULT_BINARIES = [
  'android/app/build/outputs/apk/debug/app-debug.apk',
  'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
];

// The composite oracle's expensive tail (§6): boot emulator, ensure the
// cached dev-client build, serve JS via Metro, run Detox flows with the
// flake majority vote, and report one signal per flow.
export function detoxVerifier(options: DetoxVerifierOptions): Verifier {
  return {
    id: options.id ?? 'e2e',
    gate: 'hard',
    cost: 'expensive',
    async run(ctx) {
      const appDir = resolve(ctx.cwd, options.appDir ?? '.');
      const metroPort = options.metroPort ?? 8081;

      const emulator =
        options.manageEmulator === false
          ? undefined
          : await ensureEmulator({ avdName: options.avdName, bootTimeoutMs: options.bootTimeoutMs });
      const metro =
        options.manageMetro === false ? undefined : await startMetro({ appDir, port: metroPort });
      try {
        const build = await ensureBuild({
          appDir,
          buildCommand: options.buildCommand ?? 'npx',
          buildArgs: options.buildArgs ?? ['detox', 'build', '-c', options.configuration],
          binaryPaths: options.binaryPaths ?? DEFAULT_BINARIES,
          timeoutMs: 30 * 60 * 1000,
        });
        if (emulator) await reversePort(emulator.serial, metroPort);

        const suite = await runDetoxSuite({
          appDir,
          configuration: options.configuration,
          maxRuns: options.maxRuns,
        });

        const signals: VerifierSignal[] = [
          {
            id: 'e2e:dev-client-build',
            passed: true,
            detail: build.rebuilt ? `rebuilt (hash ${build.hash.slice(0, 12)})` : 'cache-hit',
          },
          ...suite.flows.map((flow) => ({
            id: `e2e:${flow.id}`,
            passed: flow.passed,
            detail: flow.flaky
              ? `FLAKY: passed ${flow.votes.filter(Boolean).length}/${flow.votes.length} runs`
              : flow.passed
                ? undefined
                : `failed ${flow.votes.length}/${flow.votes.length} runs`,
          })),
        ];
        return {
          passed: suite.passed,
          signals,
          evidence: {
            logs: [...suite.logs, ...(build.logPath ? [build.logPath] : [])],
            artifacts: suite.artifacts,
          },
        };
      } finally {
        metro?.stop();
        if (emulator) await shutdownEmulator(emulator);
      }
    },
  };
}

export { ensureBuild, readCacheMarker } from './build-cache.js';
export type { EnsureBuildOptions, EnsureBuildResult } from './build-cache.js';
export { nativeInputsHash } from './native-hash.js';
export { ensureEmulator, reversePort, shutdownEmulator } from './emulator.js';
export type { EmulatorHandle, EmulatorOptions } from './emulator.js';
export { startMetro } from './metro.js';
export type { MetroHandle, MetroOptions } from './metro.js';
export { majorityVote, parseJestJson, runDetoxSuite } from './detox-run.js';
export type { DetoxRunOptions, DetoxSuiteResult, FlowOutcome, ParsedRun } from './detox-run.js';
