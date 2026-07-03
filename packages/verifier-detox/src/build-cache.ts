import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runCommand } from '@no-middleman/verifiers';
import { nativeInputsHash } from './native-hash.js';

export interface EnsureBuildOptions {
  appDir: string;
  buildCommand: string;
  buildArgs?: string[];
  binaryPaths: string[]; // relative to appDir; all must exist for a cache hit
  timeoutMs?: number;
  // Injectable for tests; defaults to the real command runner.
  exec?: typeof runCommand;
}

export interface EnsureBuildResult {
  rebuilt: boolean;
  hash: string;
  logPath?: string;
}

interface CacheMarker {
  hash: string;
  binaryPaths: string[];
  builtAt: string;
}

// Build-once/reload-many (§6.1): compile the dev client only when the
// native-input hash changes or a cached binary is missing.
export async function ensureBuild(options: EnsureBuildOptions): Promise<EnsureBuildResult> {
  const exec = options.exec ?? runCommand;
  const hash = nativeInputsHash(options.appDir);
  const markerPath = join(options.appDir, '.nm/detox-build', `${hash}.json`);
  const binaries = options.binaryPaths.map((p) => resolve(options.appDir, p));

  if (existsSync(markerPath) && binaries.every((p) => existsSync(p))) {
    return { rebuilt: false, hash };
  }

  const outcome = await exec(
    options.buildCommand,
    options.buildArgs ?? [],
    options.appDir,
    options.timeoutMs,
  );
  const logPath = join(options.appDir, '.nm/evidence', `detox-build-${hash.slice(0, 12)}.log`);
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, outcome.output, 'utf8');
  if (outcome.code !== 0) {
    throw new Error(`detox dev-client build failed (exit ${outcome.code}); log: ${logPath}`);
  }
  const missing = binaries.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(`build succeeded but binaries are missing: ${missing.join(', ')}`);
  }

  const marker: CacheMarker = {
    hash,
    binaryPaths: options.binaryPaths,
    builtAt: new Date().toISOString(),
  };
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
  return { rebuilt: true, hash, logPath };
}

export function readCacheMarker(appDir: string, hash: string): CacheMarker | undefined {
  const markerPath = join(appDir, '.nm/detox-build', `${hash}.json`);
  if (!existsSync(markerPath)) return undefined;
  return JSON.parse(readFileSync(markerPath, 'utf8')) as CacheMarker;
}
