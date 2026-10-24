import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { assertPersonSlug } from "@/lib/graph/ids";
import { dropProtectedFrom } from "@/lib/protected";
import { roomExists, roomPaths } from "@/lib/room";

/** GET /api/connect?viewer=<slug>&person=<slug> → how the viewer connects to one person, from the room graph. */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  let viewer: string;
  let person: string;
  try {
    viewer = assertPersonSlug(url.searchParams.get("viewer") ?? "");
    person = assertPersonSlug(url.searchParams.get("person") ?? "");
  } catch {
    return Response.json({ error: "Pass viewer and person slugs." }, { status: 400 });
  }
  try {
    if (!(await roomExists())) return Response.json({ error: "The room graph isn't built yet." }, { status: 404 });
    const paths = await roomPaths(viewer, person, dropProtectedFrom(request));
    return Response.json({ viewerName: paths.names.viewer, personName: paths.names.person, ...paths });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "Connect failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
