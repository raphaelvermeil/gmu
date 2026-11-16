import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import type { z } from 'zod';
import { errorCodes, errorSchema } from '@gear/shared';
import type { Logger } from './log.ts';

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// R1.6: every error leaves the API in one shape.
function send(c: Context, status: ContentfulStatusCode, body: z.input<typeof errorSchema>) {
  return c.json(errorSchema.parse(body), status);
}

export function onError(log: Logger) {
  return (error: Error, c: Context) => {
    if (error instanceof ApiError) {
      return send(c, error.status, {
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    // Hono raises this for a body it cannot parse, such as malformed JSON.
    if (error instanceof HTTPException && error.status === 400) {
      return send(c, 400, { code: errorCodes.validationFailed, message: error.message });
    }
    log({
      level: 'error',
      msg: 'unhandled error',
      request_id: c.get('requestId'),
      error: error.message,
    });
    return send(c, 500, { code: errorCodes.internal, message: 'Something went wrong' });
  };
}

export function notFound(c: Context) {
  return send(c, 404, { code: errorCodes.notFound, message: 'Not found' });
}

// R1.7: validate a JSON body with a schema from packages/shared.
export function jsonBody<T extends z.ZodType>(schema: T) {
  return validator('json', (value): z.output<T> => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(400, errorCodes.validationFailed, 'The request body is not valid', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  });
}
