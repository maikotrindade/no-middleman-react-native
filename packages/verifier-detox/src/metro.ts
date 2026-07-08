import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export interface MetroOptions {
  appDir: string;
  port?: number;
  readyTimeoutMs?: number;
  // Injectable for tests; default starts Expo's Metro server.
  command?: string;
  args?: string[];
}

export interface MetroHandle {
  port: number;
  startedByUs: boolean;
  stop(): void;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1', timeout: 1_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Metro is what makes reload-many work: the cached debug binary fetches fresh
// JS from it on every launch, so maker iterations never touch gradle.
export async function startMetro(options: MetroOptions): Promise<MetroHandle> {
  const port = options.port ?? 8081;
  if (await isPortOpen(port)) {
    return { port, startedByUs: false, stop() {} };
  }

  const child = spawn(
    options.command ?? 'npx',
    options.args ?? ['expo', 'start', '--port', String(port)],
    {
      cwd: options.appDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CI: '1' },
    },
  );
  child.unref();

  const deadline = Date.now() + (options.readyTimeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      return {
        port,
        startedByUs: true,
        stop() {
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGTERM'); // whole detached group
            } catch {
              /* already gone */
            }
          }
        },
      };
    }
    await sleep(500);
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  throw new Error(`Metro did not become ready on port ${port}`);
}
