import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { GraphNotFoundError } from "@/lib/graph/read";
import { sourceSummary } from "@/lib/source-summary";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;

  try {
    const summary = await sourceSummary(slug);
    return Response.json(summary);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof GraphNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Source summary failed";
    const status = /invalid person slug/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
