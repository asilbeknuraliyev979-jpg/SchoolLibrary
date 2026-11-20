const PRODUCTION_ORIGINS = [
  'https://schoolibrary.vercel.app',
  'https://www.schoolibrary.vercel.app',
];

function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function getAllowedOrigins(requestOrigin?: string | null): Set<string> {
  const allowed = new Set<string>(PRODUCTION_ORIGINS);

  const envOrigins = [
    process.env.APP_URL,
    process.env.ALLOWED_ORIGIN,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
  ];

  for (const raw of envOrigins) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const normalized = normalizeOrigin(part);
      if (normalized) allowed.add(normalized);
    }
  }

  const selfOrigin = normalizeOrigin(requestOrigin);
  if (selfOrigin) {
    allowed.add(selfOrigin);
  }

  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
  }

  return allowed;
}

export function isAllowedOrigin(
  originHeader: string | null | undefined,
  requestOrigin?: string | null
): boolean {
  if (!originHeader) return true; // Same-origin navigations / non-CORS requests omit Origin
  const normalized = normalizeOrigin(originHeader);
  if (!normalized) return false;
  return getAllowedOrigins(requestOrigin).has(normalized);
}

/**
 * Returns true only when hosted inside AI Studio preview (*.run.app),
 * where frame embedding is required by the preview shell.
 * Production custom domains and Vercel (*.vercel.app) strictly enforce DENY / frame-ancestors 'none'.
 */
export function isPreviewIframeHost(hostHeader: string | null | undefined): boolean {
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  const host = (hostHeader || '').split(':')[0].toLowerCase();
  return host.endsWith('.run.app');
}

export function buildContentSecurityPolicy(options: {
  allowPreviewIframe: boolean;
  isDev: boolean;
  nonce?: string;
}): string {
  const scriptSrc = options.nonce
    ? [
        "'self'",
        `'nonce-${options.nonce}'`,
        "'strict-dynamic'",
        ...(options.isDev ? ["'unsafe-eval'"] : []),
        'https://apis.google.com',
        'https://www.gstatic.com',
      ].join(' ')
    : [
        "'self'",
        ...(options.isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
        'https://apis.google.com',
        'https://www.gstatic.com',
      ].join(' ');

  const connectSrc = [
    "'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://firestore.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'wss://*.firebaseio.com',
  ].join(' ');

  const frameSrc = [
    "'self'",
    'https://*.firebaseapp.com',
    'https://accounts.google.com',
  ].join(' ');

  const frameAncestors = options.allowPreviewIframe
    ? "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.usercontent.goog"
    : "frame-ancestors 'none'";

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://picsum.photos https://lh3.googleusercontent.com",
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors,
    ...(options.isDev ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}

export const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()';
