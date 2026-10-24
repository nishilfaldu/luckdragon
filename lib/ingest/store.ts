import { nodeId as sharedNodeId } from "@/lib/graph/ids";
import { writeGraph } from "@/lib/graph/write";
import type { GraphEdge, GraphNode } from "@/lib/types";

/** The root Person node id. Every other id comes from lib/graph/ids.ts. */
export const PERSON_ROOT_ID = "person_root";

export async function loadGraphModules(): Promise<void> {
  // Ids and writes are imported from lib/graph. This stays so the pipeline has one startup hook.
}

export function graphBackend(): "lib/graph/write.ts" {
  return "lib/graph/write.ts";
}

export function nodeId(type: string, key: string): string {
  return sharedNodeId(type, key);
}

export async function persistGraph(slug: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
  await writeGraph(slug, nodes, edges);
}
