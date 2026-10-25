import { enqueueJob, eventsSince, jobStatus, queueMode } from "@/lib/queue";
import { peopleFromGraphs } from "@/lib/people";
import type { IngestEvent } from "@/lib/types";
import type { NextRequest } from "next/server";
import { readOnlyResponse } from "@/lib/access";
import { isIngesting } from "@/lib/ingest/events";
import { iterateIngest } from "@/lib/ingest/pipeline";
import { getPerson } from "@/lib/people";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }
  if (queueMode()) {
    const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
    // Re-ingest of someone already in the room: queue a job from their graph's person record.
    if (after === 0 && !(await jobStatus(slug))) {
      const person = (await peopleFromGraphs()).find((row) => row.slug === slug);
      if (!person) return Response.json({ error: `No person with slug ${slug}` }, { status: 404 });
      const queued = await enqueueJob(person);
      if (!queued.ok) return Response.json({ error: queued.reason }, { status: 429 });
    }
    return streamQueued(slug, after);
  }
  const blocked = readOnlyResponse();
  if (blocked) return blocked;
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

export const maxDuration = 300;

/** Streams a queued job's events from FalkorDB for up to ~4.5 minutes; the client reconnects with ?after=<count>. */
function streamQueued(slug: string, after: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Partial<IngestEvent>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let seen = after;
      let waitedNote = false;
      const deadline = Date.now() + 270_000;
      try {
        while (Date.now() < deadline) {
          const events = await eventsSince(slug, seen);
          for (const event of events) send(event);
          seen += events.length;
          if (events.some((event) => event.source === "all" && (event.status === "done" || event.status === "error"))) return;
          if (seen === 0 && !waitedNote && Date.now() > deadline - 255_000) {
            const status = await jobStatus(slug);
            if (status === "queued") {
              send({ slug, source: "queue", status: "pending", label: "Queued", detail: "Waiting for the presenter's worker to pick this up", at: new Date().toISOString() });
              waitedNote = true;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        send({ slug, source: "stream", status: "pending", message: "reconnect", count: seen, at: new Date().toISOString() });
      } catch (error) {
        send({ slug, source: "all", status: "error", message: error instanceof Error ? error.message : "Stream failed", at: new Date().toISOString() });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
