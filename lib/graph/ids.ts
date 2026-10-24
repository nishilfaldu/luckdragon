import { createHash } from "node:crypto";

import { NODE_TYPES, type NodeType } from "@/lib/types";

/**
 * Stable node id: `<type-lowercase>_<first 10 hex of sha1(type + '|' + key)>`.
 * The root Person id is always `person_root`.
 *
 * `key` is the source URL when the node has one, otherwise the name.
 * `graphKey` canonicalizes both so callers don't have to.
 */
export function nodeId(type: string, key: string): string {
  const canonical = canonicalType(type);
  if (canonical === "Person") return "person_root";
  const material = `${canonical}|${graphKey(key)}`;
  const hex = createHash("sha1").update(material).digest("hex").slice(0, 10);
  return `${canonical.toLowerCase()}_${hex}`;
}

/** URL keys lose the hash and a trailing slash. Names are lowercased with collapsed whitespace. */
export function graphKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Node key is empty");
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.hash = "";
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.origin}${path}${url.search}`;
    } catch {
      return trimmed.replace(/\/+$/, "");
    }
  }
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}

export function canonicalType(type: string): NodeType {
  const found = NODE_TYPES.find((name) => name.toLowerCase() === type.trim().toLowerCase());
  if (!found) throw new Error(`Unknown node type ${type}`);
  return found;
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** Slugs become graph names (`person:<slug>`), so they stay free of spaces and colons. */
export function assertPersonSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!SLUG.test(trimmed)) throw new Error("Invalid person slug");
  return trimmed;
}
