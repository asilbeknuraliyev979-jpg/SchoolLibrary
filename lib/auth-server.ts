import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { resolveWritableDataDir } from './storage-dir';
import type { LibrarianProfile } from './types';

export const SESSION_COOKIE_NAME = 'sl_session';

const DEFAULT_USERNAME = (process.env.LIBRARIAN_USERNAME || 'nodira.library')
  .trim()
  .toLowerCase();
const DEFAULT_SCHOOL_NAME = 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi';

interface StoredAuthState {
  sessionSecret: string;
  account: {
    id: string;
    username: string;
    displayName: string;
    role: 'librarian' | 'admin';
    schoolName: string;
    passwordHash: string | null;
    passwordSalt: string | null;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

interface LoginRateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

export const MAX_ACCOUNT_LOGIN_ATTEMPTS = 5;
export const MAX_IP_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Persist rate-limit map & in-memory auth fallback across hot reloads in same Node process
const globalAuth = globalThis as unknown as {
  __slLoginAttempts?: Map<string, LoginRateLimitRecord>;
  __slAuthStateMemory?: StoredAuthState;
};

const loginAttemptsStore =
  globalAuth.__slLoginAttempts ?? (globalAuth.__slLoginAttempts = new Map<string, LoginRateLimitRecord>());

export function extractClientIp(req: NextRequest): string {
  const candidates = [
    req.headers.get('x-vercel-forwarded-for'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for'),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const first = raw.split(',')[0]?.trim();
    if (first && /^[a-zA-Z0-9:.\-_]{1,64}$/.test(first)) {
      return first;
    }
  }
  return 'local';
}

export function checkRateLimitKey(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSeconds: number; retryAfterMinutes: number } {
  const rec = loginAttemptsStore.get(key);
  if (!rec) return { allowed: true, retryAfterSeconds: 0, retryAfterMinutes: 0 };

  if (rec.lockedUntil && now < rec.lockedUntil) {
    const secs = Math.max(1, Math.ceil((rec.lockedUntil - now) / 1000));
    const mins = Math.max(1, Math.ceil(secs / 60));
    return { allowed: false, retryAfterSeconds: secs, retryAfterMinutes: mins };
  }

  if (rec.lockedUntil && now >= rec.lockedUntil) {
    loginAttemptsStore.delete(key);
    return { allowed: true, retryAfterSeconds: 0, retryAfterMinutes: 0 };
  }

  if (now - rec.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptsStore.delete(key);
    return { allowed: true, retryAfterSeconds: 0, retryAfterMinutes: 0 };
  }

  return { allowed: true, retryAfterSeconds: 0, retryAfterMinutes: 0 };
}

export function recordRateLimitFailure(
  key: string,
  maxAttempts: number,
  now: number = Date.now()
): { locked: boolean; remainingAttempts: number; retryAfterSeconds: number; retryAfterMinutes: number } {
  const existing = loginAttemptsStore.get(key);
  if (!existing || now - existing.firstAttemptAt > LOGIN_WINDOW_MS) {
    const locked = maxAttempts <= 1;
    loginAttemptsStore.set(key, {
      attempts: 1,
      firstAttemptAt: now,
      lockedUntil: locked ? now + LOGIN_LOCKOUT_MS : null,
    });
    const secs = locked ? Math.ceil(LOGIN_LOCKOUT_MS / 1000) : 0;
    return {
      locked,
      remainingAttempts: Math.max(0, maxAttempts - 1),
      retryAfterSeconds: secs,
      retryAfterMinutes: locked ? Math.ceil(secs / 60) : 0,
    };
  }

  existing.attempts += 1;
  if (existing.attempts >= maxAttempts) {
    existing.lockedUntil = now + LOGIN_LOCKOUT_MS;
    loginAttemptsStore.set(key, existing);
    const secs = Math.ceil(LOGIN_LOCKOUT_MS / 1000);
    return {
      locked: true,
      remainingAttempts: 0,
      retryAfterSeconds: secs,
      retryAfterMinutes: Math.ceil(secs / 60),
    };
  }

  loginAttemptsStore.set(key, existing);
  return {
    locked: false,
    remainingAttempts: Math.max(0, maxAttempts - existing.attempts),
    retryAfterSeconds: 0,
    retryAfterMinutes: 0,
  };
}

/**
 * Checks both IP+username and IP-wide brute-force limits.
 */
export function checkLoginRateLimit(
  ip: string,
  username: string
): { allowed: boolean; retryAfterSeconds: number; retryAfterMinutes: number } {
  const ipKey = `ip::${ip}`;
  const pairKey = `pair::${ip}::${username.trim().toLowerCase()}`;
  const ipStatus = checkRateLimitKey(ipKey);
  if (!ipStatus.allowed) return ipStatus;
  return checkRateLimitKey(pairKey);
}

/**
 * Records a failed attempt against both IP+username (limit 5) and IP-wide (limit 10).
 */
export function recordFailedLoginAttempt(
  ip: string,
  username: string
): { locked: boolean; remainingAttempts: number; retryAfterSeconds: number; retryAfterMinutes: number } {
  const ipKey = `ip::${ip}`;
  const pairKey = `pair::${ip}::${username.trim().toLowerCase()}`;
  const pairRes = recordRateLimitFailure(pairKey, MAX_ACCOUNT_LOGIN_ATTEMPTS);
  const ipRes = recordRateLimitFailure(ipKey, MAX_IP_LOGIN_ATTEMPTS);

  if (pairRes.locked || ipRes.locked) {
    const retryAfterSeconds = Math.max(pairRes.retryAfterSeconds, ipRes.retryAfterSeconds);
    return {
      locked: true,
      remainingAttempts: 0,
      retryAfterSeconds,
      retryAfterMinutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)),
    };
  }

  return {
    locked: false,
    remainingAttempts: Math.min(pairRes.remainingAttempts, ipRes.remainingAttempts),
    retryAfterSeconds: 0,
    retryAfterMinutes: 0,
  };
}

export function clearLoginRateLimit(ip: string, username: string): void {
  loginAttemptsStore.delete(`pair::${ip}::${username.trim().toLowerCase()}`);
}

export function resetAllLoginRateLimits(): void {
  loginAttemptsStore.clear();
}

interface SessionPayload {
  sub: string;
  username: string;
  displayName: string;
  role: 'librarian' | 'admin';
  authProvider: 'credentials' | 'google';
  email?: string;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPasswordHash(password: string, salt: string, storedHash: string): boolean {
  try {
    const computed = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

function getConfiguredSessionSecret(): string | null {
  const raw = process.env.SESSION_SECRET?.trim();
  if (
    raw &&
    raw.length >= 16 &&
    !raw.startsWith('REPLACE_') &&
    !raw.startsWith('MY_')
  ) {
    return raw;
  }
  return null;
}

function getAuthFilePath(): string | null {
  const dir = resolveWritableDataDir();
  if (!dir) return null;
  return path.join(dir, 'auth-state.json');
}

function createInitialAuthState(): StoredAuthState {
  const now = new Date().toISOString();
  const configuredSecret = getConfiguredSessionSecret();

  // Support optional env-provisioned password on stateless Vercel deployments
  const envPassword = process.env.LIBRARIAN_PASSWORD?.trim();
  let passwordSalt: string | null = null;
  let passwordHash: string | null = null;

  if (envPassword && envPassword.length >= 8) {
    // Deterministic salt derived from SESSION_SECRET (if present) so cold starts verify consistently
    passwordSalt = configuredSecret
      ? crypto.createHmac('sha256', configuredSecret).update(`salt:${DEFAULT_USERNAME}`).digest('hex').slice(0, 32)
      : crypto.randomBytes(16).toString('hex');
    passwordHash = hashPassword(envPassword, passwordSalt);
  }

  return {
    sessionSecret: configuredSecret ?? crypto.randomBytes(32).toString('hex'),
    account: {
      id: 'librarian_nodira',
      username: DEFAULT_USERNAME,
      displayName: 'Nodira',
      role: 'librarian',
      schoolName: DEFAULT_SCHOOL_NAME,
      passwordHash,
      passwordSalt,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function writeAuthState(state: StoredAuthState): void {
  globalAuth.__slAuthStateMemory = state;
  const authFile = getAuthFilePath();
  if (!authFile) return;

  try {
    const tmp = `${authFile}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, authFile);
  } catch (err) {
    console.warn('[auth-server] Failed to persist auth-state.json; keeping state in memory:', err);
  }
}

function readAuthState(): StoredAuthState {
  const authFile = getAuthFilePath();
  if (authFile && fs.existsSync(authFile)) {
    try {
      const raw = fs.readFileSync(authFile, 'utf8');
      const parsed = JSON.parse(raw) as StoredAuthState;
      if (parsed?.account?.username && parsed?.sessionSecret) {
        globalAuth.__slAuthStateMemory = parsed;
        return parsed;
      }
    } catch (err) {
      console.error('[auth-server] Failed to parse auth-state.json; recreating state:', err);
    }
  }

  if (globalAuth.__slAuthStateMemory) {
    return globalAuth.__slAuthStateMemory;
  }

  const state = createInitialAuthState();
  writeAuthState(state);
  return state;
}

function getSecret(state: StoredAuthState): string {
  return getConfiguredSessionSecret() ?? state.sessionSecret;
}

export function isInitialSetupRequired(): boolean {
  const state = readAuthState();
  return !state.account.passwordHash;
}

export function initializeLibrarianPassword(username: string, initialPassword: string): LibrarianProfile {
  const state = readAuthState();
  if (state.account.passwordHash) {
    throw new Error('Hisob allaqachon sozlangan. Iltimos, parol bilan kiring.');
  }
  if (username.trim().toLowerCase() !== state.account.username) {
    throw new Error(`Faqat ${state.account.username} asosiy hisobi uchun boshlang‘ich parol o‘rnatish mumkin.`);
  }
  if (initialPassword.length < 8) {
    throw new Error('Parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  state.account.passwordSalt = salt;
  state.account.passwordHash = hashPassword(initialPassword, salt);
  state.account.mustChangePassword = false;
  state.account.updatedAt = now;
  writeAuthState(state);

  return {
    id: state.account.id,
    username: state.account.username,
    displayName: state.account.displayName,
    role: state.account.role,
    schoolName: state.account.schoolName,
    mustChangePassword: state.account.mustChangePassword,
    authProvider: 'credentials',
    createdAt: state.account.createdAt,
    updatedAt: state.account.updatedAt,
  };
}

export function verifyLibrarianLogin(username: string, password: string): LibrarianProfile | null {
  const state = readAuthState();
  const normalizedUser = username.trim().toLowerCase();

  if (!state.account.passwordHash || !state.account.passwordSalt) {
    // Perform dummy scrypt work to avoid timing discrepancy
    crypto.scryptSync(password || 'dummy', 'dummy-salt-padding-0000', 64);
    return null;
  }

  const usernameMatches = normalizedUser === state.account.username;
  const passwordMatches = verifyPasswordHash(
    password,
    state.account.passwordSalt,
    state.account.passwordHash
  );

  if (!usernameMatches || !passwordMatches) {
    return null;
  }

  return {
    id: state.account.id,
    username: state.account.username,
    displayName: state.account.displayName,
    role: state.account.role,
    schoolName: state.account.schoolName,
    mustChangePassword: state.account.mustChangePassword,
    authProvider: 'credentials',
    createdAt: state.account.createdAt,
    updatedAt: state.account.updatedAt,
  };
}

export function changeLibrarianPassword(currentPassword: string, newPassword: string): LibrarianProfile {
  const state = readAuthState();
  if (!state.account.passwordHash || !state.account.passwordSalt) {
    throw new Error('Hisob paroli hali o‘rnatilmagan.');
  }
  if (!verifyPasswordHash(currentPassword, state.account.passwordSalt, state.account.passwordHash)) {
    throw new Error('Joriy parol noto‘g‘ri.');
  }
  if (newPassword.length < 8) {
    throw new Error('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
  }
  if (newPassword === currentPassword) {
    throw new Error('Yangi parol joriy paroldan farq qilishi kerak.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  state.account.passwordSalt = salt;
  state.account.passwordHash = hashPassword(newPassword, salt);
  state.account.mustChangePassword = false;
  state.account.updatedAt = now;
  writeAuthState(state);

  return {
    id: state.account.id,
    username: state.account.username,
    displayName: state.account.displayName,
    role: state.account.role,
    schoolName: state.account.schoolName,
    mustChangePassword: false,
    authProvider: 'credentials',
    createdAt: state.account.createdAt,
    updatedAt: state.account.updatedAt,
  };
}

export function signSessionToken(profile: LibrarianProfile): string {
  const state = readAuthState();
  const secret = getSecret(state);
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    role: profile.role,
    authProvider: profile.authProvider,
    email: profile.email,
    mustChangePassword: profile.mustChangePassword,
    iat: now,
    exp: now + 60 * 60 * 24 * 7, // 7 days
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): LibrarianProfile | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const state = readAuthState();
    const secret = getSecret(state);
    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      id: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      role: payload.role,
      schoolName: state.account.schoolName,
      mustChangePassword:
        payload.authProvider === 'credentials' ? state.account.mustChangePassword : false,
      authProvider: payload.authProvider,
      email: payload.email,
      createdAt: state.account.createdAt,
      updatedAt: state.account.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the authenticated librarian exclusively from the HttpOnly session cookie.
 */
export async function getServerSession(): Promise<LibrarianProfile | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifySessionToken(token);
  } catch (err) {
    console.error('[auth-server] getServerSession failed:', err);
    return null;
  }
}

export function isSecureRequest(req?: NextRequest | { url: string; headers: Headers }): boolean {
  if (!req) return process.env.NODE_ENV === 'production';
  const proto = req.headers.get('x-forwarded-proto') || '';
  if (proto.toLowerCase().includes('https')) return true;
  if (req.url.startsWith('https://')) return true;
  const host = (req.headers.get('host') || '').toLowerCase();
  if (host.endsWith('.vercel.app') || host.endsWith('.run.app')) return true;
  return process.env.NODE_ENV === 'production' && !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
}

export function getCookieOptions(req?: NextRequest | { url: string; headers: Headers }) {
  const secure = isSecureRequest(req);
  const host = (req?.headers.get('host') || '').split(':')[0].toLowerCase();
  const isAiStudioPreview = !process.env.VERCEL && host.endsWith('.run.app');

  // Strict SameSite on Vercel/production domains; None only when hosted inside AI Studio's cross-site iframe
  const sameSite: 'strict' | 'lax' | 'none' = isAiStudioPreview
    ? 'none'
    : secure
      ? 'strict'
      : 'lax';

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}
