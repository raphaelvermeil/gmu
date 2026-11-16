import { createMiddleware } from 'hono/factory';
import type { RequestIdVariables } from 'hono/request-id';

// R1.9: one JSON object per line. Never pass a token, an address, a coordinate or a message body.
export type Logger = (line: Record<string, unknown>) => void;

export const jsonLogger: Logger = (line) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...line }));
};

export function logRequests(log: Logger) {
  return createMiddleware<{ Variables: RequestIdVariables & { userId?: string } }>(
    async (c, next) => {
      const started = performance.now();
      await next();
      log({
        level: 'info',
        msg: 'request',
        request_id: c.get('requestId'),
        user_id: c.get('userId'),
        method: c.req.method,
        path: c.req.path, // the path only: no query string, no headers
        status: c.res.status,
        duration_ms: Math.round(performance.now() - started),
      });
    },
  );
}
