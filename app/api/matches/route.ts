import { dropProtectedFrom } from "@/lib/protected";
import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { listPersonGraphs } from "@/lib/falkor";
import { assertPersonSlug } from "@/lib/graph/ids";
import { matchesFor } from "@/lib/match";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

/**
 * GET /api/matches?viewer=<slug>&limit=8
 * `{ matches: PersonMatch[] }`. Unknown viewers and missing graphs are 200 with
 * `{ matches: [], reason }` so the panel can render an empty state.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const viewer = url.searchParams.get("viewer")?.trim() ?? "";
  const limit = clampLimit(url.searchParams.get("limit"));

  if (!viewer) {
    return Response.json({ matches: [], reason: "Pass a viewer slug." });
  }

  let slug: string;
  try {
    slug = assertPersonSlug(viewer);
  } catch {
    return Response.json({ matches: [], reason: "Unknown viewer." });
  }

  try {
    const graphs = await listPersonGraphs();
    if (!graphs.includes(`person:${slug}`)) {
      return Response.json({ matches: [], reason: "No graph for this viewer yet." });
    }
    const matches = await matchesFor(slug, undefined, dropProtectedFrom(request));
    const sliced = matches.slice(0, limit);
    if (sliced.length === 0) {
      return Response.json({ matches: [], reason: "No shared ground yet." });
    }
    return Response.json({ matches: sliced });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "Match lookup failed.";
    return Response.json({ matches: [], reason: message }, { status: 500 });
  }
}

function clampLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
