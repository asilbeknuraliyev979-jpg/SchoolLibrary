import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  getCookieOptions,
  MAX_ACCOUNT_LOGIN_ATTEMPTS,
  MAX_IP_LOGIN_ATTEMPTS,
  recordFailedLoginAttempt,
  resetAllLoginRateLimits,
} from './auth-server';
import {
  buildContentSecurityPolicy,
  isAllowedOrigin,
  isPreviewIframeHost,
} from './security-headers';
import {
  resetWritableDataDirCache,
  resolveWritableDataDir,
} from './storage-dir';

test('resolveWritableDataDir uses os.tmpdir on Vercel serverless without EROFS', () => {
  const prevVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    resetWritableDataDirCache();
    const dir = resolveWritableDataDir({ forceRecheck: true });
    assert.ok(dir, 'Expected a writable directory on Vercel');
    assert.equal(dir, path.join(os.tmpdir(), 'school-library-data'));
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    resetWritableDataDirCache();
  }
});

test('dual-key login rate limiter locks ip+username after 5 attempts and ip-wide after 10 attempts', () => {
  resetAllLoginRateLimits();

  // 1) Same IP + same username locks at 5th failed attempt
  for (let i = 1; i < MAX_ACCOUNT_LOGIN_ATTEMPTS; i++) {
    const res = recordFailedLoginAttempt('203.0.113.10', 'nodira.library');
    assert.equal(res.locked, false);
  }
  const fifth = recordFailedLoginAttempt('203.0.113.10', 'nodira.library');
  assert.equal(fifth.locked, true);
  assert.ok(fifth.retryAfterSeconds > 0);
  assert.equal(checkLoginRateLimit('203.0.113.10', 'nodira.library').allowed, false);

  // Clear pair limit for another test
  clearLoginRateLimit('203.0.113.10', 'nodira.library');
  assert.equal(checkLoginRateLimit('203.0.113.10', 'nodira.library').allowed, true);

  // 2) Credential stuffing across different usernames from same IP locks at 10th total failure
  resetAllLoginRateLimits();
  for (let i = 1; i < MAX_IP_LOGIN_ATTEMPTS; i++) {
    const res = recordFailedLoginAttempt('198.51.100.42', `user${i}`);
    assert.equal(res.locked, false);
  }
  const tenth = recordFailedLoginAttempt('198.51.100.42', 'user10');
  assert.equal(tenth.locked, true);
  assert.equal(checkLoginRateLimit('198.51.100.42', 'brand.new.user').allowed, false);

  resetAllLoginRateLimits();
});

test('getCookieOptions enforces HttpOnly, Secure, and SameSite=Strict on schoolibrary.vercel.app', () => {
  const vercelReq = {
    url: 'https://schoolibrary.vercel.app/api/auth/login',
    headers: new Headers({
      host: 'schoolibrary.vercel.app',
      'x-forwarded-proto': 'https',
    }),
  };
  const opts = getCookieOptions(vercelReq);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.secure, true);
  assert.equal(opts.sameSite, 'strict');
  assert.equal(opts.path, '/');
});

test('CORS origin allowlist allows production domain and rejects untrusted origins', () => {
  assert.equal(isAllowedOrigin('https://schoolibrary.vercel.app', 'https://schoolibrary.vercel.app'), true);
  assert.equal(isAllowedOrigin('https://evil-attacker.example', 'https://schoolibrary.vercel.app'), false);
  assert.equal(isAllowedOrigin('null', 'https://schoolibrary.vercel.app'), false);
  assert.equal(isAllowedOrigin(null, 'https://schoolibrary.vercel.app'), true);
});

test('CSP and frame protection enforce frame-ancestors none on Vercel production', () => {
  assert.equal(isPreviewIframeHost('schoolibrary.vercel.app'), false);
  const csp = buildContentSecurityPolicy({ allowPreviewIframe: false, isDev: false });
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes('upgrade-insecure-requests'));
  assert.ok(!csp.includes("'unsafe-eval'"));
});
