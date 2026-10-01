// The exact headers and body a 2026-07-28 client sends (see `rpc` in backend/mcp.test.ts), as request options.
export const mcp = (method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const V = "2026-07-28";
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": V,
    "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  return {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": V,
      "mcp-method": method,
      ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
      ...headers,
    },
    data: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta } },
  };
};
