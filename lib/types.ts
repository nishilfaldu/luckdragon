/** Shared types for the person graph, the people list, and ingest progress. */

export const NODE_TYPES = [
  "Person",
  "Account",
  "Organization",
  "Post",
  "Video",
  "Repo",
  "Package",
  "Article",
  "Topic",
  "Skill",
  "Location",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  "HAS_ACCOUNT",
  "WORKS_AT",
  "WORKED_AT",
  "STUDIED_AT",
  "AUTHORED",
  "POSTED_ON",
  "ABOUT",
  "USES",
  "HAS_SKILL",
  "INTERESTED_IN",
  "BASED_IN",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/** CSS variable (in app/tokens.css) for a node type's graph color. */
export const NODE_COLOR_VAR: Record<NodeType, string> = {
  Person: "--node-person",
  Account: "--node-account",
  Organization: "--node-organization",
  Post: "--node-post",
  Video: "--node-video",
  Repo: "--node-repo",
  Package: "--node-package",
  Article: "--node-article",
  Topic: "--node-topic",
  Skill: "--node-skill",
  Location: "--node-location",
};

export type GraphNode = {
  id: string;
  type: NodeType;
  label: string;
  props: Record<string, unknown>;
  source_url?: string;
  fetched_at?: string;
  confidence?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: EdgeType;
  props?: Record<string, unknown>;
};

/** One row of data/people.csv. */
export type PersonRow = {
  slug: string;
  name: string;
  role: string;
  luma_url: string;
  headline: string;
  avatar_url: string;
  linkedin: string;
  x: string;
  github: string;
  youtube: string;
  instagram: string;
  tiktok: string;
  website: string;
  other_links: string;
};

export type IngestStatus =
  | "pending"
  | "fetching"
  | "extracting"
  | "writing"
  | "done"
  | "error"
  | "skipped";

export type IngestEvent = {
  slug: string;
  source: string;
  status: IngestStatus;
  count?: number;
  message?: string;
  at: string;
};
