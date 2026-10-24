import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "luckdragon_access";

export const INGEST_DISABLED = "Ingest runs on the presenter's laptop";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function configuredPasscode(): string {
  return (process.env.LUCKDRAGON_PASSCODE ?? "").trim();
}

export function passcodeRequired(): boolean {
  return configuredPasscode().length > 0;
}

export function isReadOnly(): boolean {
  return process.env.LUCKDRAGON_READ_ONLY === "1";
}

export function readOnlyResponse(): Response | null {
  if (!isReadOnly()) return null;
  return Response.json({ error: INGEST_DISABLED }, { status: 403 });
}

export function passcodeMatches(input: string): boolean {
  return sameHash(input.trim(), configuredPasscode());
}

/** Cookie value derived from the passcode. It is not the passcode itself. */
export function accessToken(): string {
  return createHmac("sha256", configuredPasscode()).update("luckdragon-access-v1").digest("hex");
}

export function cookieIsValid(value: string | undefined): boolean {
  if (!passcodeRequired()) return true;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return false;
  const expected = accessToken();
  return timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
}

export function cookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

function sameHash(input: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(input).digest(), createHash("sha256").update(expected).digest());
}
