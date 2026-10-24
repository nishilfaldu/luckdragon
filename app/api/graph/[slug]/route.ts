import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { assertPersonSlug } from "@/lib/graph/ids";
import { getGraph, GraphNotFoundError } from "@/lib/graph/read";
import { dropProtectedFrom } from "@/lib/protected";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;

  try {
    const person = assertPersonSlug(slug);
    const graph = await getGraph(person, { dropProtected: dropProtectedFrom(request) });
    return Response.json(graph);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof GraphNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Graph read failed";
    const status = /invalid person slug/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
