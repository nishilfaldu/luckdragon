import type { GraphNode } from "@/lib/types";

/**
 * Protected traits: health, religion, politics, ethnicity or nationality, sexual orientation,
 * family or relationship status, and age. A keyword check on labels and text, aimed at personal
 * phrasing so professional work (health tech, accessibility) stays. Roots, accounts, and orgs are never hidden.
 */
const PROTECTED =
  /\b(religio\w*|my faith|church|christian\w*|catholic|muslim|islam\w*|hindu\w*|jewish|judaism|buddhis\w*|sikh\w*|bible|prayer|mosque|ramadan|diwali|politic(s|al party)|democrats?|republicans?|election\w*|abortion|immigration status|ethnicity|nationality|lgbt\w*|queer|gay|lesbian|bisexual|transgender|sexual orientation|mental health|my health|illness|cancer|diabetes|depression|anxiety|adhd|autism|pregnan\w*|wedding|married|marriage|husband|wife|divorce|girlfriend|boyfriend|my kids|my son|my daughter|parenting|newborn|birthday|years old)\b/i;

const NEVER_HIDDEN = new Set(["Person", "Account", "Organization"]);

export function isProtectedText(text: string): boolean {
  return PROTECTED.test(text);
}

export function protectedMatch(text: string): string | null {
  return PROTECTED.exec(text)?.[0] ?? null;
}

export function isProtectedNode(node: GraphNode): boolean {
  if (NEVER_HIDDEN.has(node.type) || node.id === "person_root") return false;
  const props = node.props ?? {};
  const text = [node.label, props.name, props.title, props.text, props.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return isProtectedText(text);
}

/** Read `?protected=allow` from a request URL; anything else keeps protected traits dropped. */
export function dropProtectedFrom(request: Request): boolean {
  return new URL(request.url).searchParams.get("protected") !== "allow";
}
