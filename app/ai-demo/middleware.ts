import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Only protect routes you care about
  const protectedRoutes = ["/ai-demo"];
  const isProtected = protectedRoutes.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // We can't reliably read Supabase session server-side without auth helpers,
  // so MVP approach: require a client-side check by redirecting if no token cookie exists.
  // Supabase stores tokens in localStorage on client; middleware can't read that.
  // => Best MVP: protect in-page client-side. We'll do that in ai-demo page.

  return NextResponse.next();
}

export const config = {
  matcher: ["/ai-demo/:path*", "/ai-demo"],
};
