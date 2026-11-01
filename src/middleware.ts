import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectUrl } from "@/lib/canonical";

export function middleware(req: NextRequest) {
  const target = canonicalRedirectUrl({
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    vercelEnv: process.env.VERCEL_ENV,
    redirectUri: process.env.BUFFER_REDIRECT_URI,
  });
  if (target) return NextResponse.redirect(target, 308);
  return NextResponse.next();
}

// Run on everything (pages, API, static) so no alias path slips through.
export const config = { matcher: "/:path*" };
