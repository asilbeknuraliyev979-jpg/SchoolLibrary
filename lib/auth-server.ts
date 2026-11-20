import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { LibrarianProfile } from './types';

export const SESSION_COOKIE_NAME = 'sl_session';
const DATA_DIR = path.resolve(process.cwd(), '.data');
const AUTH_FILE = path.join(DATA_DIR, 'auth-state.json');

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
  const computed = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readAuthState(): StoredAuthState {
  ensureDataDir();
  if (fs.existsSync(AUTH_FILE)) {
    const raw = fs.readFileSync(AUTH_FILE, 'utf8');
    return JSON.parse(raw) as StoredAuthState;
  }

  const now = new Date().toISOString();

  const state: StoredAuthState = {
    sessionSecret:
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 16 &&
      !process.env.SESSION_SECRET.startsWith('REPLACE_') &&
      !process.env.SESSION_SECRET.startsWith('MY_')
        ? process.env.SESSION_SECRET
        : crypto.randomBytes(32).toString('hex'),
    account: {
      id: 'librarian_nodira',
      username: 'nodira.library',
      displayName: 'Nodira',
      role: 'librarian',
      schoolName: 'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
      passwordHash: null,
      passwordSalt: null,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    },
  };
  writeAuthState(state);
  return state;
}

function writeAuthState(state: StoredAuthState) {
  ensureDataDir();
  const tmp = `${AUTH_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
}

function getSecret(state: StoredAuthState): string {
  if (
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 16 &&
    !process.env.SESSION_SECRET.startsWith('REPLACE_') &&
    !process.env.SESSION_SECRET.startsWith('MY_')
  ) {
    return process.env.SESSION_SECRET;
  }
  return state.sessionSecret;
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
    throw new Error('Faqat nodira.library asosiy hisobi uchun boshlang‘ich parol o‘rnatish mumkin.');
  }
  if (initialPassword.length < 8) {
    throw new Error('Parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  state.account.passwordSalt = salt;
  state.account.passwordHash = hashPassword(initialPassword, salt);
  // Librarian just chose their own personal password interactively; only env-provisioned temp passwords require forced change
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
  if (!state.account.passwordHash || !state.account.passwordSalt) {
    return null;
  }
  if (username.trim().toLowerCase() !== state.account.username) {
    return null;
  }
  const ok = verifyPasswordHash(password, state.account.passwordSalt, state.account.passwordHash);
  if (!ok) return null;

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
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

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

export async function getServerSession(): Promise<LibrarianProfile | null> {
  const cookieStore = await cookies();
  let token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    const hdrs = await headers();
    const authHeader = hdrs.get('authorization') || hdrs.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }
  if (!token) return null;
  return verifySessionToken(token);
}

export function isSecureRequest(req?: NextRequest): boolean {
  if (!req) return process.env.NODE_ENV === 'production';
  const proto = req.headers.get('x-forwarded-proto') || '';
  if (proto.toLowerCase().includes('https')) return true;
  if (req.url.startsWith('https://')) return true;
  const host = req.headers.get('host') || '';
  if (host.includes('.run.app')) return true;
  return false;
}

export function getCookieOptions(isSecure: boolean = process.env.NODE_ENV === 'production') {
  return {
    httpOnly: true,
    sameSite: (isSecure ? 'none' : 'lax') as 'none' | 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}
