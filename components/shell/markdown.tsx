import type { ReactNode } from "react";

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string };

type Ctx = {
  next: () => number;
  cite: (slug: string, nodeId: string, key: number) => ReactNode;
};

const INLINE =
  /\[\[([a-z0-9-]+):([A-Za-z0-9_]+)\]\]|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*([^*\n]+)\*/g;

export function Markdown({
  text,
  cite,
}: {
  text: string;
  cite: (slug: string, nodeId: string, key: number) => ReactNode;
}) {
  if (!text.trim()) return null;
  let count = 0;
  const ctx: Ctx = {
    next: () => count++,
    cite,
  };
  return blocks(text).map((block) => renderBlock(block, ctx));
}

function renderBlock(block: Block, ctx: Ctx): ReactNode {
  const key = ctx.next();
  if (block.type === "code") {
    return (
      <pre key={key}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === "h") {
    const Tag = block.level <= 1 ? "h2" : "h3";
    return <Tag key={key}>{renderInline(block.text, ctx)}</Tag>;
  }
  if (block.type === "ul" || block.type === "ol") {
    const Tag = block.type === "ul" ? "ul" : "ol";
    return (
      <Tag key={key}>
        {block.items.map((item) => (
          <li key={ctx.next()}>{withBreaks(item, ctx)}</li>
        ))}
      </Tag>
    );
  }
  return <p key={key}>{withBreaks(block.text, ctx)}</p>;
}

function withBreaks(text: string, ctx: Ctx): ReactNode[] {
  const parts = text.split("\n");
  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(<br key={ctx.next()} />);
    nodes.push(...renderInline(part, ctx));
  });
  return nodes;
}

function renderInline(text: string, ctx: Ctx): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE.source, "g");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const slug = match[1];
    const nodeId = match[2];
    if (slug && nodeId) {
      nodes.push(ctx.cite(slug, nodeId, ctx.next()));
    } else if (match[3] != null) {
      nodes.push(<strong key={ctx.next()}>{renderInline(match[3], ctx)}</strong>);
    } else if (match[4] != null) {
      nodes.push(<code key={ctx.next()}>{match[4]}</code>);
    } else if (match[5] && match[6]) {
      nodes.push(
        <a key={ctx.next()} href={match[6]} target="_blank" rel="noreferrer">
          {match[5]}
        </a>,
      );
    } else if (match[7] != null) {
      nodes.push(<em key={ctx.next()}>{renderInline(match[7], ctx)}</em>);
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      out.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      const marks = line.match(/^#+/)?.[0].length ?? 1;
      out.push({ type: "h", level: marks, text: line.replace(/^#{1,3}\s+/, "") });
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^[-*]\s+/, ""));
        index += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }
    const para = [line];
    index += 1;
    while (index < lines.length && continuesParagraph(lines[index] ?? "")) {
      para.push(lines[index] ?? "");
      index += 1;
    }
    out.push({ type: "p", text: para.join("\n") });
  }
  return out;
}

function continuesParagraph(line: string): boolean {
  if (!line.trim()) return false;
  if (line.trim().startsWith("```")) return false;
  if (/^#{1,3}\s+/.test(line)) return false;
  if (/^[-*]\s+/.test(line)) return false;
  if (/^\d+\.\s+/.test(line)) return false;
  return true;
}
