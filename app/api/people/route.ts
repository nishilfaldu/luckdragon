import { connection } from "next/server";
import { isReadOnly, readOnlyResponse } from "@/lib/access";
import { addPersonFromLuma } from "@/lib/ingest/add-person";
import { listPeople } from "@/lib/ingest/status";
import { peopleCsvExists, peopleFromGraphs } from "@/lib/people";

export async function GET() {
  await connection();
  try {
    const people = peopleCsvExists() ? await listPeople() : await peopleFromGraphs();
    return Response.json({ people, readOnly: isReadOnly() });
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const blocked = readOnlyResponse();
  if (blocked) return blocked;
  let body: { luma_url?: unknown };
  try {
    body = (await request.json()) as { luma_url?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const lumaUrl = typeof body.luma_url === "string" ? body.luma_url.trim() : "";
  if (!/^https?:\/\/([a-z0-9-]+\.)?luma\.com\//i.test(lumaUrl)) {
    return Response.json({ error: "luma_url must be an https://luma.com/ URL" }, { status: 400 });
  }
  try {
    const person = await addPersonFromLuma(lumaUrl);
    return Response.json({ person });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add person";
    return Response.json({ error: message }, { status: 502 });
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not list people";
  if (message.includes("://") && message.includes("@")) return "Could not read graphs";
  return message;
}
