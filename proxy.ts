import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, cookieIsValid, passcodeRequired } from "@/lib/access";

export function proxy(request: NextRequest) {
  if (!passcodeRequired()) return NextResponse.next();
  if (cookieIsValid(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Passcode required" }, { status: 401 });
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/unlock";
  redirectUrl.search = "";
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/|unlock|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
