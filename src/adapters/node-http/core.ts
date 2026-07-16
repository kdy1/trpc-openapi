import type { HTTPHeaders } from '@trpc/client';
import { AnyProcedure, TRPCError, getErrorShape } from '@trpc/server';
import type {
  NodeHTTPHandlerOptions,
  NodeHTTPRequest,
  NodeHTTPResponse,
} from '@trpc/server/adapters/node-http';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { TRPCRequestInfo } from '@trpc/server/http';

import { generateOpenApiDocument } from '../../generator';
import {
  OpenApiErrorResponse,
  OpenApiMethod,
  OpenApiResponse,
  OpenApiRouter,
  OpenApiSuccessResponse,
} from '../../types';
import { acceptsRequestBody } from '../../utils/method';
import { normalizePath } from '../../utils/path';
import { cloneRouterWithZodSchemas, getInputOutputParsers } from '../../utils/procedure';
import {
  enableCoercionOnClonedSchema,
  getSchemaKind,
  getValidationIssues,
  isZodSchema,
  normalizeInputValue,
  unwrapSchema,
} from '../../utils/zod';
import { getErrorFromUnknown } from './errors';
import { getBody, getQuery } from './input';
import { createProcedureCache } from './procedures';

export type CreateOpenApiNodeHttpHandlerOptions<
  TRouter extends OpenApiRouter,
  TRequest extends NodeHTTPRequest,
  TResponse extends NodeHTTPResponse,
> = Pick<
  NodeHTTPHandlerOptions<TRouter, TRequest, TResponse>,
  'router' | 'createContext' | 'responseMeta' | 'onError'
> &
  Partial<Pick<NodeHTTPHandlerOptions<TRouter, TRequest, TResponse>, 'maxBodySize'>>;

export type OpenApiNextFunction = () => void;

function headersToRecord(headers: Headers | HTTPHeaders): Record<string, string> {
  const result: Record<string, string> = {};

  if (headers instanceof Headers) {
    // For Headers (fetch API style)
    headers.forEach((value, key) => {
      result[key] = value;
    });
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) {
        result[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
    });
  }

  return result;
}

export const createOpenApiNodeHttpHandler = <
  TRouter extends OpenApiRouter,
  TRequest extends NodeHTTPRequest,
  TResponse extends NodeHTTPResponse,
>(
  opts: CreateOpenApiNodeHttpHandlerOptions<TRouter, TRequest, TResponse>,
) => {
  const router = cloneRouterWithZodSchemas(opts.router);
  const coercionEnabledSchemas = new WeakSet<object>();

  // Validate router
  if (process.env.NODE_ENV !== 'production') {
    generateOpenApiDocument(router, { title: '', version: '', baseUrl: '' });
  }

  const { createContext, responseMeta, onError, maxBodySize } = opts;
  const getProcedure = createProcedureCache(router);

  return async (req: TRequest, res: TResponse, next?: OpenApiNextFunction) => {
    const sendResponse = (
      statusCode: number,
      headers: Record<string, string>,
      body: OpenApiResponse | undefined,
    ) => {
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== 'undefined') {
          res.setHeader(key, value);
        }
      }
      res.end(JSON.stringify(body));
    };

    const method = req.method! as OpenApiMethod & 'HEAD';
    const reqUrl = req.url!;
    const url = new URL(reqUrl.startsWith('/') ? `http://127.0.0.1${reqUrl}` : reqUrl);
    const path = normalizePath(url.pathname);
    const { procedure, pathInput } = getProcedure(method, path) ?? {};

    let input: any = undefined;
    let ctx: any = undefined;
    let data: any = undefined;

    try {
      if (!procedure) {
        if (next) {
          return next();
        }

        if (method === 'HEAD') {
          sendResponse(204, {}, undefined);
          return;
        }

        throw new TRPCError({
          message: 'Not found',
          code: 'NOT_FOUND',
        });
      }

      const useBody = acceptsRequestBody(method);
      const schema = getInputOutputParsers(procedure.procedure).inputParser;
      if (!isZodSchema(schema)) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Input parser expects a Zod validator',
        });
      }

      if (!coercionEnabledSchemas.has(schema)) {
        enableCoercionOnClonedSchema(schema);
        coercionEnabledSchemas.add(schema);
      }
      const unwrappedSchema = unwrapSchema(schema, { io: 'input' });
      const schemaKind = getSchemaKind(unwrappedSchema);

      if (schemaKind !== 'void' && schemaKind !== 'undefined' && schemaKind !== 'never') {
        const bodyOrQuery = useBody ? await getBody(req, maxBodySize) : getQuery(req, url);

        if (schemaKind === 'array') {
          const rawArrayInput = useBody
            ? bodyOrQuery
            : (bodyOrQuery as Record<string, unknown> | undefined)?.parameter;
          const arrayInput = typeof rawArrayInput === 'string' ? [rawArrayInput] : rawArrayInput;

          if (!Array.isArray(arrayInput)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Expected array in request ${
                useBody ? 'body' : 'query parameter "parameter"'
              }`,
            });
          }

          if (pathInput && Object.keys(pathInput).length > 0) {
            input = arrayInput.map((item) => {
              if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Path parameters require object items in an array request body',
                });
              }
              return { ...item, ...pathInput };
            });
          } else {
            input = arrayInput;
          }
        } else if (schemaKind === 'object') {
          const objectInput =
            typeof bodyOrQuery === 'object' && bodyOrQuery !== null && !Array.isArray(bodyOrQuery)
              ? bodyOrQuery
              : {};
          input = {
            ...objectInput,
            ...pathInput,
          };
        } else {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Input parser must be a ZodObject or ZodArray',
          });
        }
      }

      input = normalizeInputValue(schema, input, { wrapArrayValues: !useBody });

      ctx = await createContext?.({
        req,
        res,
        info: {} as TRPCRequestInfo, // Ensure TRPCRequestInfo is provided
      });

      const caller = router.createCaller(ctx);
      const segments = procedure?.path.split('.') ?? [];
      const procedureFn = segments.reduce((acc: any, curr: string) => acc[curr], caller) as
        | AnyProcedure
        | undefined;

      if (!procedureFn) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Procedure not found',
        });
      }

      data = await procedureFn(input);

      const meta = responseMeta?.({
        type: procedure.type,
        paths: [procedure.path],
        ctx,
        data: [data],
        errors: [],
        info: {} as TRPCRequestInfo, // Provide TRPCRequestInfo
        eagerGeneration: false, // Set eagerGeneration flag
      });

      const statusCode = meta?.status ?? 200;
      const headers = meta?.headers ?? {};
      const body: OpenApiSuccessResponse<typeof data> = data;
      sendResponse(statusCode, headersToRecord(headers), body);
    } catch (cause) {
      const error = getErrorFromUnknown(cause);

      onError?.({
        error,
        type: procedure?.type ?? 'unknown',
        path: procedure?.path,
        input,
        ctx,
        req,
      });

      const meta = responseMeta?.({
        type: procedure?.type ?? 'unknown',
        paths: procedure?.path ? [procedure?.path] : undefined,
        ctx,
        data: [data],
        errors: [error],
        eagerGeneration: false,
        info: {} as TRPCRequestInfo, // Ensure TRPCRequestInfo is provided
      });

      const errorShape = getErrorShape({
        config: opts.router._def._config,
        error,
        type: 'unknown',
        path,
        input: undefined,
        ctx: undefined,
      }) ?? {
        message: error.message ?? 'An error occurred',
        code: error.code,
      };

      const validationIssues =
        error.code === 'BAD_REQUEST' ? getValidationIssues(error.cause) : undefined;
      const isInputValidationError = validationIssues !== undefined;

      const statusCode = meta?.status ?? getHTTPStatusCodeFromError(error) ?? 500;
      const headers = meta?.headers ?? {};
      const body: OpenApiErrorResponse = {
        message: isInputValidationError
          ? 'Input validation failed'
          : errorShape?.message ?? error.message ?? 'An error occurred',
        code: error.code,
        issues: validationIssues,
      };
      sendResponse(statusCode, headersToRecord(headers), body);
    }
  };
};
