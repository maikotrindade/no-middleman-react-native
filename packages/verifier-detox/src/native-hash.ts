import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Directories inside android/ and ios/ that are outputs, not inputs.
const EXCLUDED_DIRS = new Set(['build', '.gradle', '.cxx', 'node_modules', 'Pods', 'DerivedData']);

function collectFiles(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) collectFiles(root, path, out);
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
}

// Hash of everything that forces a native rebuild (§6.1): dependency versions
// from package.json, the Expo app config, and the android/ and ios/ trees
// (minus build outputs). JS source is deliberately NOT included — that is the
// whole point of build-once/reload-many.
export function nativeInputsHash(appDir: string): string {
  const hash = createHash('sha256');

  const pkgPath = join(appDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    hash.update(
      JSON.stringify({ dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} }),
    );
  }

  const files: string[] = [];
  for (const name of ['app.json', 'app.config.js', 'app.config.ts']) {
    const path = join(appDir, name);
    if (existsSync(path)) files.push(path);
  }
  for (const dir of ['android', 'ios']) {
    const path = join(appDir, dir);
    if (existsSync(path) && statSync(path).isDirectory()) collectFiles(path, path, files);
  }

  for (const file of files.sort()) {
    hash.update(relative(appDir, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}
