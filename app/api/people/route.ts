import { connection } from "next/server";
import { isReadOnly, readOnlyResponse } from "@/lib/access";
import { addPersonFromLuma } from "@/lib/ingest/add-person";
import { listPeople } from "@/lib/ingest/status";
import { addClassifiedPerson, classifyPersonInput, peopleCsvExists, peopleFromGraphs, PERSON_INPUT_ERROR } from "@/lib/people";

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
  let body: { input?: unknown; luma_url?: unknown };
  try {
    body = (await request.json()) as { input?: unknown; luma_url?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const input = firstString(body.input) || firstString(body.luma_url);
  if (!input) return Response.json({ error: PERSON_INPUT_ERROR }, { status: 400 });
  const parsed = classifyPersonInput(input);
  if (!parsed) return Response.json({ error: PERSON_INPUT_ERROR }, { status: 400 });
  try {
    const person = parsed.kind === "luma" ? await addPersonFromLuma(parsed.url) : addClassifiedPerson(parsed);
    return Response.json({ person });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add person";
    return Response.json({ error: message }, { status: 502 });
  }
}

function firstString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not list people";
  if (message.includes("://") && message.includes("@")) return "Could not read graphs";
  return message;
}
