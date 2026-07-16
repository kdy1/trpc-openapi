// eslint-disable-next-line import/no-unresolved
import { ProcedureType } from '@trpc/server';
import {
  AnyProcedure,
  RouterRecord,
  createBuilder,
  createRouterFactory,
} from '@trpc/server/unstable-core-do-not-import';
import { z } from 'zod';

import { OpenApiMeta, OpenApiProcedure, OpenApiProcedureRecord, OpenApiRouter } from '../types';
import { ZodSchema, cloneSchema, getObjectShape, isZodSchema } from './zod';

const mergeInputs = (inputParsers: unknown[]): ZodSchema | unknown => {
  if (!inputParsers.every(isZodSchema)) {
    return inputParsers[0];
  }

  const shape = inputParsers.reduce<Record<string, ZodSchema>>(
    (mergedShape, inputParser) => ({
      ...mergedShape,
      ...getObjectShape(inputParser),
    }),
    {},
  );
  return z.object(shape);
};

// `inputParser` & `outputParser` are private so this is a hack to access it
export const getInputOutputParsers = (procedure: OpenApiProcedure) => {
  const { inputs, output } = procedure._def;
  return {
    inputParser: inputs.length >= 2 ? mergeInputs(inputs) : inputs[0],
    outputParser: output,
  };
};

const getProcedureType = (procedure: OpenApiProcedure) => procedure._def.type;

const cloneProcedureWithZodSchemas = (procedure: AnyProcedure): AnyProcedure => {
  const { inputs, output, middlewares, resolver, type, ...builderDefinition } =
    procedure._def as typeof procedure._def & {
      middlewares: Array<(...args: any[]) => unknown>;
      output?: unknown;
      resolver?: (...args: any[]) => unknown;
    };
  const clonedInputs = inputs.map((input) => (isZodSchema(input) ? cloneSchema(input) : input));
  const clonedOutput = isZodSchema(output) ? cloneSchema(output) : output;
  let inputIndex = 0;
  let builder: any = createBuilder(builderDefinition);

  for (const middleware of middlewares.slice(0, -1)) {
    const middlewareType = (middleware as { _type?: unknown })._type;
    if (middlewareType === 'input') {
      builder = builder.input(clonedInputs[inputIndex++]);
    } else if (middlewareType === 'output') {
      builder = builder.output(clonedOutput);
    } else {
      builder = builder.use(middleware);
    }
  }

  if (!resolver || !type || inputIndex !== clonedInputs.length) {
    throw new Error('Cannot clone an incomplete tRPC procedure');
  }

  return builder[type](resolver) as AnyProcedure;
};

const cloneProcedureRecord = (record: RouterRecord): RouterRecord => {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === 'function'
        ? cloneProcedureWithZodSchemas(value)
        : cloneProcedureRecord(value),
    ]),
  );
};

export const cloneRouterWithZodSchemas = <TRouter extends OpenApiRouter>(
  router: TRouter,
): TRouter => {
  const createRouter = createRouterFactory(router._def._config);
  return createRouter(cloneProcedureRecord(router._def.record)) as TRouter;
};

export const forEachOpenApiProcedure = (
  procedureRecord: OpenApiProcedureRecord,
  callback: (values: {
    path: string;
    type: ProcedureType;
    procedure: OpenApiProcedure;
    openapi: NonNullable<OpenApiMeta['openapi']>;
  }) => void,
) => {
  for (const [path, procedure] of Object.entries(procedureRecord)) {
    const { openapi } = ((procedure._def as RouterRecord).meta as OpenApiMeta) ?? {};
    if (openapi && openapi.enabled !== false) {
      const type = getProcedureType(procedure as unknown as OpenApiProcedure);

      if (type) {
        callback({ path, type, procedure: procedure as unknown as OpenApiProcedure, openapi });
      }
    }
  }
};
