import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessToken, cookieOptions, passcodeMatches, passcodeRequired } from "@/lib/access";

export async function POST(request: Request) {
  const here = new URL(request.url);
  if (!passcodeRequired()) return NextResponse.redirect(new URL("/", here), 303);

  let code = "";
  try {
    const form = await request.formData();
    const value = form.get("passcode");
    code = typeof value === "string" ? value : "";
  } catch {
    return NextResponse.json({ error: "Expected a passcode" }, { status: 400 });
  }

  if (!passcodeMatches(code)) return NextResponse.redirect(new URL("/unlock?error=1", here), 303);

  const response = NextResponse.redirect(new URL("/", here), 303);
  response.cookies.set(ACCESS_COOKIE, accessToken(), cookieOptions());
  return response;
}
