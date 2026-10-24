import type { NextRequest } from "next/server";
import { readOnlyResponse } from "@/lib/access";
import { isIngesting } from "@/lib/ingest/events";
import { iterateIngest } from "@/lib/ingest/pipeline";
import { getPerson } from "@/lib/people";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const blocked = readOnlyResponse();
  if (blocked) return blocked;
  const { slug } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }
  if (!getPerson(slug)) {
    return Response.json({ error: `No person with slug ${slug}` }, { status: 404 });
  }
  if (isIngesting(slug)) {
    return Response.json({ error: "Ingest already running" }, { status: 409 });
  }
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of iterateIngest(slug, { fresh })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ingest failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ slug, source: "all", status: "error", message, at: new Date().toISOString() })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
