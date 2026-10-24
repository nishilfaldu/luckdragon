import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { streamChat, type ChatRequest } from "@/lib/agent/chat";

const bodySchema = z.object({
  viewer: z.string(),
  person: z.string(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(40),
  mode: z.enum(["brief"]).optional(),
  dropProtected: z.boolean().optional(),
});

export async function POST(request: Request) {
  await connection();

  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Expected { viewer, person, messages }" }, { status: 400 });
  }

  const body: ChatRequest = parsed.data;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamChat(body)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        unstable_rethrow(error);
        const message = error instanceof Error ? error.message : "Chat failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`),
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
      "X-Accel-Buffering": "no",
    },
  });
}
