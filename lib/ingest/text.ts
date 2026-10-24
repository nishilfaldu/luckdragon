export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function decode(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decode(match[1]).trim();
  }
  return "";
}

export function pageTitle(html: string): string {
  const og = metaContent(html, "og:title");
  if (og) return og;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decode(match[1]).trim() : "";
}

export function hrefs(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    if (match[1]) found.push(decode(match[1]));
  }
  return found;
}

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<{ html: string; text: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "luckdragon/0.1 (conference demo)",
    },
  });
  if (!response.ok) throw new Error(`Fetch ${response.status} for ${url}`);
  const html = await response.text();
  return { html, text: htmlToText(html).slice(0, 12_000) };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}
