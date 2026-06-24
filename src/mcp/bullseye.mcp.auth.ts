import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

function safeEqual(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Rejects requests without a valid `Authorization: Bearer <apiKey>` header.
 */
export function createBullseyeMcpBearerAuth(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token || !safeEqual(apiKey, token)) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bearer authentication required or invalid token',
        },
        id: null,
      });
      return;
    }
    next();
  };
}
