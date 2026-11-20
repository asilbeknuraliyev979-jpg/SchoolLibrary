import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedDataDir: string | null | undefined;

function isServerlessEnvironment(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NOW_REGION
  );
}

function tryEnsureWritableDir(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
    const probe = path.join(dirPath, `.write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a writable data directory safely across local Node, Cloud Run, and Vercel Serverless.
 * Never throws EROFS on read-only filesystems (e.g. Vercel /var/task).
 * Returns null only if even os.tmpdir() is not writable (callers fall back to in-memory state).
 */
export function resolveWritableDataDir(options?: { forceRecheck?: boolean }): string | null {
  if (!options?.forceRecheck && cachedDataDir !== undefined) {
    return cachedDataDir;
  }

  const candidates: string[] = [];

  if (process.env.LIBRARY_DATA_DIR && process.env.LIBRARY_DATA_DIR.trim()) {
    candidates.push(path.resolve(process.env.LIBRARY_DATA_DIR.trim()));
  }

  if (!isServerlessEnvironment()) {
    candidates.push(path.resolve(process.cwd(), '.data'));
  }

  // Writable ephemeral directory on Vercel / AWS Lambda / read-only containers
  candidates.push(path.join(os.tmpdir(), 'school-library-data'));

  for (const candidate of candidates) {
    if (tryEnsureWritableDir(candidate)) {
      cachedDataDir = candidate;
      return candidate;
    }
  }

  console.warn(
    '[storage-dir] No writable filesystem directory found; falling back to in-memory storage.'
  );
  cachedDataDir = null;
  return null;
}

export function resetWritableDataDirCache(): void {
  cachedDataDir = undefined;
}
