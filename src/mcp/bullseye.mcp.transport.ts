import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

/**
 * Routes Streamable HTTP MCP requests to per-session transports (stateful mode).
 */
export class BullseyeMcpSessionManager {
  private readonly sessions = new Map<string, McpSession>();

  constructor(private readonly createServer: () => McpServer) {}

  async handleRequest(req: Request, res: Response): Promise<void> {
    const rawSessionHeader = req.headers['mcp-session-id'];
    const sessionId =
      typeof rawSessionHeader === 'string'
        ? rawSessionHeader
        : Array.isArray(rawSessionHeader)
          ? rawSessionHeader[0]
          : undefined;

    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing) {
      const parsedBody = req.method === 'POST' ? req.body : undefined;
      await existing.transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    const server = this.createServer();
    let transport!: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, server });
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
        void server.close();
      },
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async closeAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.server.close();
      await session.transport.close();
      this.sessions.delete(id);
    }
  }
}
