import { callTool, safeMessage, toolDefinitions } from "@/lib/mcp/tools";

/** Protocol versions this server can answer. Newer clients get the newest one both sides share. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = "2025-03-26";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type JsonRpcId = string | number | null;

const JSON_HEADERS = {
  "Cache-Control": "no-store",
};

/**
 * One Streamable HTTP POST: a single JSON-RPC message in, one JSON body out.
 * Notifications (no id) get 202 and an empty body. There is no session.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return rpcError(null, PARSE_ERROR, "Parse error", 400);
    throw error;
  }

  if (Array.isArray(body)) {
    return rpcError(null, INVALID_REQUEST, "Batch requests are not supported", 400);
  }
  if (!isRecord(body) || body.jsonrpc !== "2.0") {
    return rpcError(null, INVALID_REQUEST, "Invalid Request", 400);
  }

  const hasId = Object.prototype.hasOwnProperty.call(body, "id");
  const id = hasId ? readId(body.id) : undefined;
  if (hasId && id === undefined) {
    return rpcError(null, INVALID_REQUEST, "Invalid Request", 400);
  }

  const method = body.method;
  if (typeof method !== "string" || !method) {
    return id === undefined ? accepted() : rpcError(id, INVALID_REQUEST, "Invalid Request", 400);
  }
  if (id === undefined || method.startsWith("notifications/")) {
    return accepted();
  }

  try {
    const result = await dispatch(method, body.params);
    return rpcResult(id, result);
  } catch (error) {
    if (error instanceof RpcError) return rpcError(id, error.code, error.message, error.status);
    return rpcError(id, INTERNAL_ERROR, safeMessage(error));
  }
}

async function dispatch(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: negotiate(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "luckdragon", version: "0.1.0" },
        instructions:
          "Read-only tools over one FalkorDB graph per person. list_people shows the room. best_matches ranks overlap with a viewer. graph_summary and run_cypher inspect one graph. brief and ask answer in prose and cite nodes as [[slug:nodeId]].",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolDefinitions() };
    case "tools/call":
      return callFrom(params);
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

async function callFrom(params: unknown): Promise<unknown> {
  if (!isRecord(params) || typeof params.name !== "string" || !params.name.trim()) {
    throw new RpcError(INVALID_PARAMS, "tools/call requires a name");
  }
  const rawArgs = params.arguments;
  const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (!isRecord(args)) {
    throw new RpcError(INVALID_PARAMS, "tools/call arguments must be an object");
  }
  return callTool(params.name.trim(), args);
}

function negotiate(params: unknown): string {
  if (!isRecord(params)) return DEFAULT_PROTOCOL;
  const requested = params.protocolVersion;
  if (typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return DEFAULT_PROTOCOL;
}

function readId(value: unknown): JsonRpcId | undefined {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class RpcError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(code: number, message: string, status = 200) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.status = status;
  }
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: JSON_HEADERS });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: JSON_HEADERS });
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: JSON_HEADERS });
}
