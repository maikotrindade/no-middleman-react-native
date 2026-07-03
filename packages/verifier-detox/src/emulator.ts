import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { runCommand } from '@no-middleman/verifiers';

export interface EmulatorOptions {
  avdName: string;
  bootTimeoutMs?: number;
  pollIntervalMs?: number;
  exec?: typeof runCommand;
  // Injectable for tests; default spawns a detached headless emulator.
  spawnEmulator?: (avdName: string) => void;
}

export interface EmulatorHandle {
  serial: string;
  startedByUs: boolean;
}

function emulatorBinary(): string {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  return home ? join(home, 'emulator', 'emulator') : 'emulator';
}

function defaultSpawnEmulator(avdName: string): void {
  const child = spawn(
    emulatorBinary(),
    ['-avd', avdName, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

async function bootedSerials(exec: typeof runCommand): Promise<string[]> {
  const { output } = await exec('adb', ['devices'], process.cwd());
  return output
    .split('\n')
    .filter((line) => line.startsWith('emulator-') && line.trim().endsWith('device'))
    .map((line) => line.split(/\s+/)[0]!);
}

async function isBootCompleted(exec: typeof runCommand, serial: string): Promise<boolean> {
  const { output } = await exec(
    'adb',
    ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
    process.cwd(),
  );
  return output.trim() === '1';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The harness, not the agent (and not Detox), owns emulator lifecycle (§6.2):
// reuse a running emulator, else boot one headless and wait for full boot.
export async function ensureEmulator(options: EmulatorOptions): Promise<EmulatorHandle> {
  const exec = options.exec ?? runCommand;
  const bootTimeoutMs = options.bootTimeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;

  const existing = await bootedSerials(exec);
  for (const serial of existing) {
    if (await isBootCompleted(exec, serial)) return { serial, startedByUs: false };
  }

  (options.spawnEmulator ?? defaultSpawnEmulator)(options.avdName);

  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    const serials = await bootedSerials(exec);
    for (const serial of serials) {
      if (await isBootCompleted(exec, serial)) return { serial, startedByUs: true };
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`emulator '${options.avdName}' did not boot within ${bootTimeoutMs}ms`);
}

export async function shutdownEmulator(
  handle: EmulatorHandle,
  exec: typeof runCommand = runCommand,
): Promise<void> {
  if (!handle.startedByUs) return; // never kill an emulator we did not start
  await exec('adb', ['-s', handle.serial, 'emu', 'kill'], process.cwd());
}

// Debug builds fetch their JS bundle from Metro on the host.
export async function reversePort(
  serial: string,
  port: number,
  exec: typeof runCommand = runCommand,
): Promise<void> {
  await exec('adb', ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], process.cwd());
}
