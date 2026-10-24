import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { listPersonGraphs } from "@/lib/falkor";
import { assertPersonSlug } from "@/lib/graph/ids";
import { planFor } from "@/lib/match";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

/**
 * GET /api/plan?viewer=<slug>&limit=6
 * `{ plans: RoomPlanRow[] }`. Each row is a match plus a template opener.
 * Unknown viewers and missing graphs are 200 with `{ plans: [], reason }`.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const viewer = url.searchParams.get("viewer")?.trim() ?? "";
  const limit = clampLimit(url.searchParams.get("limit"));

  if (!viewer) {
    return Response.json({ plans: [], reason: "Pass a viewer slug." });
  }

  let slug: string;
  try {
    slug = assertPersonSlug(viewer);
  } catch {
    return Response.json({ plans: [], reason: "Unknown viewer." });
  }

  try {
    const graphs = await listPersonGraphs();
    if (!graphs.includes(`person:${slug}`)) {
      return Response.json({ plans: [], reason: "No graph for this viewer yet." });
    }
    const plans = await planFor(slug, limit);
    if (plans.length === 0) {
      return Response.json({ plans: [], reason: "No shared ground yet." });
    }
    return Response.json({ plans });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "Plan lookup failed.";
    return Response.json({ plans: [], reason: message }, { status: 500 });
  }
}

function clampLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
