import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { assertPersonSlug } from "@/lib/graph/ids";
import { dropProtectedFrom } from "@/lib/protected";
import { roomExists, whoToMeet } from "@/lib/room";

/** GET /api/who?viewer=<slug>&limit=8 → `{ people: WhoRow[], traces }` from the room graph. */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  let viewer: string;
  try {
    viewer = assertPersonSlug(url.searchParams.get("viewer") ?? "");
  } catch {
    return Response.json({ people: [], traces: [], reason: "Pass a viewer slug." });
  }
  try {
    if (!(await roomExists())) return Response.json({ people: [], traces: [], reason: "The room graph isn't built yet." });
    return Response.json(await whoToMeet(viewer, limit, dropProtectedFrom(request)));
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "Who to meet failed.";
    return Response.json({ people: [], traces: [], reason: message }, { status: 500 });
  }
}
