import { connection } from "next/server";
import { addPersonFromLuma } from "@/lib/ingest/add-person";
import { listPeople } from "@/lib/ingest/status";

export async function GET() {
  await connection();
  const people = await listPeople();
  return Response.json({ people });
}

export async function POST(request: Request) {
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
