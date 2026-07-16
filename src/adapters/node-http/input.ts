import { TRPCError } from '@trpc/server';
import { NodeHTTPRequest } from '@trpc/server/adapters/node-http';
import parse from 'co-body';

export type OpenApiQuery = Record<string, string | string[]>;
type NodeHTTPRequestWithQuery = NodeHTTPRequest & {
  query?: Record<string, string | string[]>;
};

export const getQuery = (req: NodeHTTPRequest, url: URL): OpenApiQuery => {
  const query: OpenApiQuery = {};
  const requestWithQuery = req as NodeHTTPRequestWithQuery;

  if (!requestWithQuery.query) {
    const parsedQs: Record<string, string[]> = {};
    url.searchParams.forEach((value, key) => {
      if (!parsedQs[key]) {
        parsedQs[key] = [];
      }
      parsedQs[key]!.push(value);
    });
    requestWithQuery.query = parsedQs;
  }

  Object.keys(requestWithQuery.query ?? {}).forEach((key) => {
    const value = requestWithQuery.query?.[key];
    if (typeof value === 'string') {
      query[key] = value;
    } else if (Array.isArray(value)) {
      const values = value.filter((item): item is string => typeof item === 'string');
      query[key] = values.length === 1 ? values[0]! : values;
    }
  });

  return query;
};

const BODY_100_KB = 100000;
export const getBody = async (req: NodeHTTPRequest, maxBodySize = BODY_100_KB): Promise<any> => {
  if ('body' in req) {
    return req.body;
  }

  req.body = undefined;

  const contentType = req.headers['content-type'];
  if (contentType === 'application/json' || contentType === 'application/x-www-form-urlencoded') {
    try {
      const { raw, parsed } = await parse(req as Parameters<typeof parse>[0], {
        limit: maxBodySize,
        strict: false,
        returnRawBody: true,
      });
      req.body = raw ? parsed : undefined;
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'PayloadTooLargeError') {
        throw new TRPCError({
          message: 'Request body too large',
          code: 'PAYLOAD_TOO_LARGE',
          cause: cause,
        });
      }

      let errorCause: Error | undefined = undefined;
      if (cause instanceof Error) {
        errorCause = cause;
      }

      throw new TRPCError({
        message: 'Failed to parse request body',
        code: 'PARSE_ERROR',
        cause: errorCause,
      });
    }
  }

  return req.body;
};
