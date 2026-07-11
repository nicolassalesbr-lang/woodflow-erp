import { NextRequest, NextResponse } from 'next/server';

const protectedPaths = ['/dashboard', '/crm', '/projects', '/budget', '/production'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!isProtected) return NextResponse.next();

  const session = request.cookies.get('kazahome_session')?.value;
  if (session === 'active') return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/crm/:path*', '/projects/:path*', '/budget/:path*', '/production/:path*'],
};
