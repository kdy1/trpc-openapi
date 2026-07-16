import { AWSLambdaOptions } from '@trpc/server/adapters/aws-lambda';
import { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import type {
  AnyProcedure,
  AnyRootTypes,
  CreateRootTypes,
  ProcedureBuilder,
  Router,
  RouterRecord,
} from '@trpc/server/unstable-core-do-not-import';
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import { OpenAPIV3 } from 'openapi-types';

export type CreateOpenApiAwsLambdaHandlerOptions<
  TRouter extends OpenApiRouter,
  TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
> = Pick<
  AWSLambdaOptions<TRouter, TEvent>,
  'router' | 'createContext' | 'responseMeta' | 'onError'
>;

export type OpenApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type TRPCMeta = Record<string, unknown>;

export type OpenApiContentType =
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | (string & {});

export type OpenApiMeta<TMeta = TRPCMeta> = TMeta & {
  openapi?: {
    enabled?: boolean;
    method: OpenApiMethod;
    path: `/${string}`;
    summary?: string;
    description?: string;
    protect?: boolean;
    tags?: string[];
    headers?: (OpenAPIV3.ParameterBaseObject & { name: string; in?: 'header' })[];
    contentTypes?: OpenApiContentType[];
    deprecated?: boolean;
    example?: {
      request?: unknown;
      response?: unknown;
    };
    responseHeaders?: Record<string, OpenAPIV3.HeaderObject | OpenAPIV3.ReferenceObject>;
  };
};
export type OpenApiProcedure<TMeta = TRPCMeta> = ProcedureBuilder<
  any,
  TMeta,
  any,
  any,
  any,
  any,
  any,
  any
>;

export type OpenApiProcedureRecord<TMeta = TRPCMeta> = {
  [key: string]: AnyProcedure | RouterRecord;
};
export type OpenApiRouter<
  TMeta = TRPCMeta,
  TRoot extends AnyRootTypes = CreateRootTypes<{
    ctx: any;
    meta: OpenApiMeta<TMeta>;
    errorShape: any;
    transformer: any;
  }>,
  TDef extends RouterRecord = OpenApiProcedureRecord<TMeta>,
> = Router<TRoot, TDef>;

export type OpenApiSuccessResponse<D = any> = D;

export type OpenApiValidationIssue = {
  code: string;
  message: string;
  path: PropertyKey[];
  [key: string]: unknown;
};

export type OpenApiErrorResponse = {
  message: string;
  code: TRPC_ERROR_CODE_KEY;
  issues?: OpenApiValidationIssue[];
};

export type OpenApiResponse<D = any> = OpenApiSuccessResponse<D> | OpenApiErrorResponse;
