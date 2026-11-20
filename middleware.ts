import { NextRequest, NextResponse } from 'next/server';
import {
  buildContentSecurityPolicy,
  isAllowedOrigin,
  isPreviewIframeHost,
  PERMISSIONS_POLICY_VALUE,
} from '@/lib/security-headers';

function applySecurityHeaders(req: NextRequest, res: NextResponse): NextResponse {
  const host = req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  const allowPreviewIframe = isPreviewIframeHost(host);
  const isDev = process.env.NODE_ENV !== 'production';

  res.headers.set(
    'Content-Security-Policy',
    buildContentSecurityPolicy({ allowPreviewIframe, isDev })
  );
  if (!allowPreviewIframe) {
    res.headers.set('X-Frame-Options', 'DENY');
  }
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
  res.headers.set('X-DNS-Prefetch-Control', 'off');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  if (proto.toLowerCase().includes('https')) {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');
  const requestOrigin = req.nextUrl.origin;

  if (pathname.startsWith('/api/')) {
    const originAllowed = isAllowedOrigin(origin, requestOrigin);

    // Handle CORS preflight requests strictly against domain allowlist
    if (req.method === 'OPTIONS') {
      if (!origin || !originAllowed) {
        return applySecurityHeaders(
          req,
          new NextResponse(null, { status: 403, headers: { Vary: 'Origin' } })
        );
      }
      const preflight = new NextResponse(null, { status: 204 });
      preflight.headers.set('Access-Control-Allow-Origin', origin);
      preflight.headers.set('Access-Control-Allow-Credentials', 'true');
      preflight.headers.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      preflight.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      preflight.headers.set('Access-Control-Max-Age', '86400');
      preflight.headers.set('Vary', 'Origin');
      return applySecurityHeaders(req, preflight);
    }

    // Block cross-origin requests from untrusted origins (CORS + CSRF defense)
    if (origin && !originAllowed) {
      const denied = NextResponse.json(
        { error: 'Ruxsat etilmagan manba (CORS cheklovi).' },
        { status: 403 }
      );
      denied.headers.set('Vary', 'Origin');
      return applySecurityHeaders(req, denied);
    }

    const res = NextResponse.next();
    if (origin && originAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
      res.headers.set('Vary', 'Origin');
    }
    if (pathname.startsWith('/api/auth/')) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
    return applySecurityHeaders(req, res);
  }

  const res = NextResponse.next();
  return applySecurityHeaders(req, res);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
