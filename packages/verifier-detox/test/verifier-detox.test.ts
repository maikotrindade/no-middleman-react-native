import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandOutcome } from '@no-middleman/verifiers';
import { describe, expect, it } from 'vitest';
import { ensureBuild } from '../src/build-cache.js';
import { majorityVote, parseJestJson } from '../src/detox-run.js';
import { ensureEmulator } from '../src/emulator.js';
import { nativeInputsHash } from '../src/native-hash.js';

function makeApp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nm-detox-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ dependencies: { 'react-native': '0.76.5' }, devDependencies: {} }),
  );
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'app' } }));
  mkdirSync(join(dir, 'android/app'), { recursive: true });
  writeFileSync(join(dir, 'android/app/build.gradle'), 'android { }');
  return dir;
}

describe('nativeInputsHash', () => {
  it('is stable for identical inputs', () => {
    const dir = makeApp();
    expect(nativeInputsHash(dir)).toBe(nativeInputsHash(dir));
  });

  it('changes when a native dependency version changes', () => {
    const dir = makeApp();
    const before = nativeInputsHash(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '0.76.6' }, devDependencies: {} }),
    );
    expect(nativeInputsHash(dir)).not.toBe(before);
  });

  it('changes when an android source file changes', () => {
    const dir = makeApp();
    const before = nativeInputsHash(dir);
    writeFileSync(join(dir, 'android/app/build.gradle'), 'android { newSetting true }');
    expect(nativeInputsHash(dir)).not.toBe(before);
  });

  it('ignores android build outputs and JS source', () => {
    const dir = makeApp();
    const before = nativeInputsHash(dir);
    mkdirSync(join(dir, 'android/app/build'), { recursive: true });
    writeFileSync(join(dir, 'android/app/build/output.apk'), 'binary');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/App.tsx'), 'export const x = 1;');
    expect(nativeInputsHash(dir)).toBe(before);
  });
});

describe('ensureBuild', () => {
  function scriptedExec(binaries: string[], appDir: string, calls: string[][]) {
    return async (command: string, args: string[]): Promise<CommandOutcome> => {
      calls.push([command, ...args]);
      for (const binary of binaries) {
        const path = join(appDir, binary);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, 'fake-apk');
      }
      return { code: 0, output: 'BUILD SUCCESSFUL' };
    };
  }

  it('builds on first call, then hits the cache', async () => {
    const appDir = makeApp();
    const calls: string[][] = [];
    const opts = {
      appDir,
      buildCommand: 'fake-build',
      binaryPaths: ['android/app/build/outputs/apk/debug/app-debug.apk'],
      exec: scriptedExec(['android/app/build/outputs/apk/debug/app-debug.apk'], appDir, calls),
    };

    const first = await ensureBuild(opts);
    expect(first.rebuilt).toBe(true);
    const second = await ensureBuild(opts);
    expect(second.rebuilt).toBe(false);
    expect(second.hash).toBe(first.hash);
    expect(calls).toHaveLength(1);
  });

  it('rebuilds when the native-input hash changes', async () => {
    const appDir = makeApp();
    const calls: string[][] = [];
    const opts = {
      appDir,
      buildCommand: 'fake-build',
      binaryPaths: ['android/app/build/outputs/apk/debug/app-debug.apk'],
      exec: scriptedExec(['android/app/build/outputs/apk/debug/app-debug.apk'], appDir, calls),
    };

    await ensureBuild(opts);
    writeFileSync(join(appDir, 'android/app/build.gradle'), 'android { changed true }');
    const result = await ensureBuild(opts);
    expect(result.rebuilt).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('rebuilds when the cached binary is missing despite a marker', async () => {
    const appDir = makeApp();
    const calls: string[][] = [];
    let produceBinary = false;
    const exec = async (): Promise<CommandOutcome> => {
      calls.push(['build']);
      if (produceBinary) {
        mkdirSync(join(appDir, 'android/app/build/outputs/apk/debug'), { recursive: true });
        writeFileSync(join(appDir, 'android/app/build/outputs/apk/debug/app-debug.apk'), 'fake-apk');
        return { code: 0, output: 'ok' };
      }
      return { code: 0, output: 'ok (no binary!)' };
    };
    const opts = {
      appDir,
      buildCommand: 'fake-build',
      binaryPaths: ['android/app/build/outputs/apk/debug/app-debug.apk'],
      exec,
    };

    await expect(ensureBuild(opts)).rejects.toThrow(/binaries are missing/);
    produceBinary = true;
    const result = await ensureBuild(opts);
    expect(result.rebuilt).toBe(true);
  });

  it('throws with the log path when the build command fails', async () => {
    const appDir = makeApp();
    const opts = {
      appDir,
      buildCommand: 'fake-build',
      binaryPaths: ['android/app/build/outputs/apk/debug/app-debug.apk'],
      exec: async (): Promise<CommandOutcome> => ({ code: 1, output: 'FAILURE: Build failed' }),
    };
    await expect(ensureBuild(opts)).rejects.toThrow(/build failed/);
  });
});

describe('parseJestJson + majorityVote', () => {
  const jestJson = JSON.stringify({
    testResults: [
      {
        name: '/app/e2e/tip-calculator.test.ts',
        assertionResults: [
          { fullName: 'tip calculator shows the correct total', status: 'failed' },
          { fullName: 'tip calculator opens from home', status: 'passed' },
        ],
      },
    ],
  });

  it('parses per-flow results out of jest --json output', () => {
    const parsed = parseJestJson(jestJson);
    expect(parsed.flows).toEqual([
      {
        id: 'tip calculator shows the correct total',
        file: '/app/e2e/tip-calculator.test.ts',
        passed: false,
      },
      { id: 'tip calculator opens from home', file: '/app/e2e/tip-calculator.test.ts', passed: true },
    ]);
  });

  it('passes a flow on 2/3 majority and flags it flaky', () => {
    const flows = majorityVote(
      new Map([['flow', { file: 'f.ts', votes: [false, true, true] }]]),
    );
    expect(flows[0]!.passed).toBe(true);
    expect(flows[0]!.flaky).toBe(true);
  });

  it('fails a flow on 1/3 and flags it flaky', () => {
    const flows = majorityVote(new Map([['flow', { file: 'f.ts', votes: [false, true, false] }]]));
    expect(flows[0]!.passed).toBe(false);
    expect(flows[0]!.flaky).toBe(true);
  });

  it('a consistently red flow is failed and not flaky', () => {
    const flows = majorityVote(new Map([['flow', { file: 'f.ts', votes: [false, false, false] }]]));
    expect(flows[0]!.passed).toBe(false);
    expect(flows[0]!.flaky).toBe(false);
  });
});

describe('runDetoxSuite', () => {
  it('treats zero flows as a broken oracle, never green', async () => {
    const { runDetoxSuite } = await import('../src/detox-run.js');
    const appDir = mkdtempSync(join(tmpdir(), 'nm-detox-run-'));
    const exec = async (): Promise<CommandOutcome> => {
      // Simulate a setup crash: jest writes JSON but ran no tests.
      const outputFile = join(appDir, '.nm/evidence/detox-run-1.json');
      mkdirSync(join(appDir, '.nm/evidence'), { recursive: true });
      writeFileSync(outputFile, JSON.stringify({ testResults: [] }));
      return { code: 1, output: 'Test suite failed to run' };
    };
    await expect(
      runDetoxSuite({ appDir, configuration: 'android.emu.debug', exec }),
    ).rejects.toThrow(/zero flows/);
  });
});

describe('ensureEmulator', () => {
  const adbResponse = (output: string): CommandOutcome => ({ code: 0, output });

  it('reuses a booted emulator without spawning', async () => {
    const spawned: string[] = [];
    const handle = await ensureEmulator({
      avdName: 'TestAvd',
      exec: async (_cmd, args) =>
        args[0] === 'devices'
          ? adbResponse('List of devices attached\nemulator-5554\tdevice\n')
          : adbResponse('1\n'),
      spawnEmulator: (avd) => {
        spawned.push(avd);
      },
    });
    expect(handle).toEqual({ serial: 'emulator-5554', startedByUs: false });
    expect(spawned).toHaveLength(0);
  });

  it('boots one when none is running and waits for boot_completed', async () => {
    const spawned: string[] = [];
    let booted = false;
    const handle = await ensureEmulator({
      avdName: 'TestAvd',
      pollIntervalMs: 1,
      exec: async (_cmd, args) => {
        if (args[0] === 'devices') {
          return adbResponse(
            booted ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\n',
          );
        }
        return adbResponse('1\n');
      },
      spawnEmulator: (avd) => {
        spawned.push(avd);
        booted = true;
      },
    });
    expect(handle).toEqual({ serial: 'emulator-5554', startedByUs: true });
    expect(spawned).toEqual(['TestAvd']);
  });

  it('times out with a clear error if boot never completes', async () => {
    await expect(
      ensureEmulator({
        avdName: 'DeadAvd',
        bootTimeoutMs: 20,
        pollIntervalMs: 1,
        exec: async () => adbResponse('List of devices attached\n'),
        spawnEmulator: () => {},
      }),
    ).rejects.toThrow(/did not boot/);
  });
});
