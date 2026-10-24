import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { handleMcpRequest } from "@/lib/mcp/handle";
import { safeMessage } from "@/lib/mcp/tools";

/**
 * Streamable HTTP MCP endpoint. POST returns one JSON-RPC response.
 * GET is the SSE listen channel; this server does not push messages.
 */
export async function POST(request: Request) {
  await connection();
  try {
    return await handleMcpRequest(request);
  } catch (error) {
    unstable_rethrow(error);
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: safeMessage(error) } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function GET() {
  return Response.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
