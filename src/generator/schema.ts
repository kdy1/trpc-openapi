import { TRPCError } from '@trpc/server';
import { OpenAPIV3 } from 'openapi-types';
import * as z4 from 'zod/v4/core';

import { OpenApiContentType } from '../types';
import {
  ZodSchema,
  assertOpenApiRepresentable,
  getArrayElement,
  getObjectShape,
  getSchemaKind,
  isOptionalSchema,
  isZodSchema,
  unwrapSchema,
} from '../utils/zod';

const schemaConversionError = (position: string, cause: unknown): TRPCError => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new TRPCError({
    message: `${position} schema cannot be represented in OpenAPI: ${detail}`,
    code: 'INTERNAL_SERVER_ERROR',
    cause,
  });
};

const normalizeOpenApi30Schema = (value: unknown): void => {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  const schema = value as Record<string, unknown>;
  if (Array.isArray(schema.examples)) {
    if (schema.example === undefined && schema.examples.length > 0) {
      schema.example = schema.examples[0];
    }
    delete schema.examples;
  }

  if (typeof schema.properties === 'object' && schema.properties !== null) {
    Object.values(schema.properties).forEach(normalizeOpenApi30Schema);
  }
  if (typeof schema.items === 'object' && schema.items !== null) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach(normalizeOpenApi30Schema);
    } else {
      normalizeOpenApi30Schema(schema.items);
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const nestedSchemas = schema[keyword];
    if (Array.isArray(nestedSchemas)) {
      nestedSchemas.forEach(normalizeOpenApi30Schema);
    }
  }
  normalizeOpenApi30Schema(schema.not);
  if (typeof schema.additionalProperties === 'object') {
    normalizeOpenApi30Schema(schema.additionalProperties);
  }
};

export const zodSchemaToOpenApiSchemaObject = (
  zodSchema: ZodSchema,
  io: 'input' | 'output',
  position: string,
): OpenAPIV3.SchemaObject => {
  try {
    assertOpenApiRepresentable(zodSchema, io);

    const jsonSchema = z4.toJSONSchema(zodSchema, {
      target: 'openapi-3.0',
      io,
      cycles: 'throw',
      reused: 'inline',
      unrepresentable: 'any',
      override: ({ zodSchema: currentSchema, jsonSchema: currentJsonSchema }) => {
        const kind = getSchemaKind(currentSchema);
        if (kind === 'date') {
          Object.assign(currentJsonSchema, { type: 'string', format: 'date-time' });
        } else if (kind === 'bigint') {
          Object.assign(currentJsonSchema, { type: 'integer', format: 'int64' });
        } else if (kind === 'undefined' || kind === 'void') {
          for (const key of Object.keys(currentJsonSchema)) {
            delete currentJsonSchema[key];
          }
        }
      },
    }) as Record<string, unknown>;

    const {
      $schema: _schemaDocumentUri,
      $defs: _definitions,
      ['~standard']: _standardMetadata,
      ...schemaObject
    } = jsonSchema;

    normalizeOpenApi30Schema(schemaObject);

    return schemaObject as OpenAPIV3.SchemaObject;
  } catch (cause) {
    throw schemaConversionError(position, cause);
  }
};

const getObjectParameterObjects = (
  shape: Record<string, ZodSchema>,
  schemaIsRequired: boolean,
  pathParameters: string[],
  inType: 'all' | 'path' | 'query',
  example: unknown,
): OpenAPIV3.ParameterObject[] => {
  const shapeKeys = Object.keys(shape);

  for (const pathParameter of pathParameters) {
    if (!shapeKeys.includes(pathParameter)) {
      throw new TRPCError({
        message: `Input parser expects key from path: "${pathParameter}"`,
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  }

  return shapeKeys
    .filter((shapeKey) => {
      const isPathParameter = pathParameters.includes(shapeKey);
      if (inType === 'path') {
        return isPathParameter;
      }
      if (inType === 'query') {
        return !isPathParameter;
      }
      return true;
    })
    .map((shapeKey) => {
      const shapeSchema = shape[shapeKey]!;
      const isPathParameter = pathParameters.includes(shapeKey);
      const isShapeRequired = !isOptionalSchema(shapeSchema);

      if (isPathParameter && !isShapeRequired) {
        throw new TRPCError({
          message: `Path parameter: "${shapeKey}" must not be optional`,
          code: 'INTERNAL_SERVER_ERROR',
        });
      }

      const { description, ...openApiSchemaObject } = zodSchemaToOpenApiSchemaObject(
        shapeSchema,
        'input',
        `Input parameter "${shapeKey}"`,
      );

      return {
        name: shapeKey,
        in: isPathParameter ? 'path' : 'query',
        required: isPathParameter || (schemaIsRequired && isShapeRequired),
        schema: openApiSchemaObject,
        description,
        example:
          typeof example === 'object' && example !== null && !Array.isArray(example)
            ? (example as Record<string, unknown>)[shapeKey]
            : undefined,
      };
    });
};

export const getParameterObjects = (
  schema: unknown,
  pathParameters: string[],
  inType: 'all' | 'path' | 'query',
  example: unknown,
  arrayParameterName = 'parameter',
): OpenAPIV3.ParameterObject[] | undefined => {
  if (!isZodSchema(schema)) {
    throw new TRPCError({
      message: 'Input parser expects a Zod validator',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const schemaIsRequired = !isOptionalSchema(schema);
  const unwrappedSchema = unwrapSchema(schema, { io: 'input' });
  const kind = getSchemaKind(unwrappedSchema);

  if (
    pathParameters.length === 0 &&
    (kind === 'void' || kind === 'undefined' || kind === 'never')
  ) {
    return undefined;
  }

  if (kind === 'object') {
    return getObjectParameterObjects(
      getObjectShape(unwrappedSchema),
      schemaIsRequired,
      pathParameters,
      inType,
      example,
    );
  }

  if (kind === 'array') {
    const elementSchema = unwrapSchema(getArrayElement(unwrappedSchema), { io: 'input' });
    if (pathParameters.length > 0 && getSchemaKind(elementSchema) === 'object') {
      const pathParameterObjects = getObjectParameterObjects(
        getObjectShape(elementSchema),
        schemaIsRequired,
        pathParameters,
        'path',
        undefined,
      );
      if (inType === 'path') {
        return pathParameterObjects;
      }
      if (inType === 'all') {
        return [
          ...pathParameterObjects,
          {
            name: arrayParameterName,
            in: 'query',
            required: schemaIsRequired,
            schema: zodSchemaToOpenApiSchemaObject(schema, 'input', 'Array query parameter'),
            example: Array.isArray(example)
              ? example
              : typeof example === 'object' && example !== null
              ? (example as Record<string, unknown>)[arrayParameterName]
              : undefined,
            style: 'form',
            explode: true,
          },
        ];
      }
      return undefined;
    }

    if (!arrayParameterName) {
      throw new TRPCError({
        message: 'Array parameter name must be provided for array schemas',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    const isPathParameter = pathParameters.includes(arrayParameterName);
    if (inType !== 'all' && inType !== (isPathParameter ? 'path' : 'query')) {
      return undefined;
    }
    if (isPathParameter && !schemaIsRequired) {
      throw new TRPCError({
        message: `Path parameter: "${arrayParameterName}" must not be optional`,
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    const { description, ...openApiSchemaObject } = zodSchemaToOpenApiSchemaObject(
      schema,
      'input',
      'Array input parameter',
    );

    return [
      {
        name: arrayParameterName,
        in: isPathParameter ? 'path' : 'query',
        required: isPathParameter || schemaIsRequired,
        schema: openApiSchemaObject,
        description,
        example: Array.isArray(example)
          ? example
          : typeof example === 'object' && example !== null
          ? (example as Record<string, unknown>)[arrayParameterName]
          : undefined,
        style: 'form',
        explode: true,
      },
    ];
  }

  throw new TRPCError({
    message: 'Input parser must be a ZodObject or ZodArray',
    code: 'INTERNAL_SERVER_ERROR',
  });
};

const removePathFields = (schema: OpenAPIV3.SchemaObject, pathParameters: string[]): boolean => {
  const properties = schema.properties;
  if (!properties) {
    return false;
  }

  for (const pathParameter of pathParameters) {
    delete properties[pathParameter];
  }

  if (schema.required) {
    schema.required = schema.required.filter((name) => !pathParameters.includes(name));
    if (schema.required.length === 0) {
      delete schema.required;
    }
  }

  return Object.keys(properties).length === 0;
};

const withoutPathFieldsFromExample = (example: unknown, pathParameters: string[]): unknown => {
  if (Array.isArray(example)) {
    return example.map((item) => withoutPathFieldsFromExample(item, pathParameters));
  }
  if (typeof example !== 'object' || example === null) {
    return example;
  }

  const result = { ...(example as Record<string, unknown>) };
  for (const pathParameter of pathParameters) {
    delete result[pathParameter];
  }
  return result;
};

export const getRequestBodyObject = (
  schema: unknown,
  pathParameters: string[],
  contentTypes: OpenApiContentType[],
  example: unknown,
): OpenAPIV3.RequestBodyObject | undefined => {
  if (!isZodSchema(schema)) {
    throw new TRPCError({
      message: 'Input parser expects a Zod validator',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const schemaIsRequired = !isOptionalSchema(schema);
  const unwrappedSchema = unwrapSchema(schema, { io: 'input' });
  const kind = getSchemaKind(unwrappedSchema);

  if (
    pathParameters.length === 0 &&
    (kind === 'void' || kind === 'undefined' || kind === 'never')
  ) {
    return undefined;
  }
  if (kind !== 'object' && kind !== 'array') {
    throw new TRPCError({
      message: 'Input parser must be a ZodObject or ZodArray',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const openApiSchemaObject = zodSchemaToOpenApiSchemaObject(schema, 'input', 'Request body');
  if (pathParameters.length > 0) {
    const arrayItems = (openApiSchemaObject as OpenAPIV3.ArraySchemaObject).items;
    const schemaWithProperties =
      kind === 'array' && arrayItems && !Array.isArray(arrayItems)
        ? (arrayItems as OpenAPIV3.SchemaObject)
        : openApiSchemaObject;
    if (removePathFields(schemaWithProperties, pathParameters)) {
      return undefined;
    }
  }

  const content: OpenAPIV3.RequestBodyObject['content'] = {};
  const bodyExample = withoutPathFieldsFromExample(example, pathParameters);
  for (const contentType of contentTypes) {
    content[contentType] = {
      schema: openApiSchemaObject,
      example: bodyExample,
    };
  }

  return {
    required: schemaIsRequired,
    content,
  };
};

export const errorResponseObject: OpenAPIV3.ResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['message', 'code'],
        properties: {
          message: { type: 'string' },
          code: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              required: ['code', 'message', 'path'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                path: {
                  type: 'array',
                  items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                },
              },
              additionalProperties: true,
            },
          },
        },
      },
    },
  },
};

export const getResponsesObject = (
  schema: unknown,
  example: unknown,
  headers: Record<string, OpenAPIV3.HeaderObject | OpenAPIV3.ReferenceObject> | undefined,
): OpenAPIV3.ResponsesObject => {
  if (!isZodSchema(schema)) {
    throw new TRPCError({
      message: 'Output parser expects a Zod validator',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const successResponseObject: OpenAPIV3.ResponseObject = {
    description: 'Successful response',
    headers,
    content: {
      'application/json': {
        schema: zodSchemaToOpenApiSchemaObject(schema, 'output', 'Output'),
        example,
      },
    },
  };

  return {
    200: successResponseObject,
    default: {
      $ref: '#/components/responses/error',
    },
  };
};
