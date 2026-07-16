import * as z4 from 'zod/v4/core';

import type { OpenApiValidationIssue } from '../types';

export type ZodSchema = z4.$ZodType;

export type SchemaKind =
  | 'array'
  | 'bigint'
  | 'boolean'
  | 'date'
  | 'default'
  | 'enum'
  | 'intersection'
  | 'lazy'
  | 'literal'
  | 'never'
  | 'nullable'
  | 'number'
  | 'object'
  | 'optional'
  | 'pipe'
  | 'string'
  | 'transform'
  | 'undefined'
  | 'union'
  | 'void'
  | 'unknown';

export type ZodTypeLikeString = z4.$ZodType<string, unknown>;
export type ZodTypeLikeVoid = z4.$ZodType<void | undefined | never, unknown>;
export type ZodTypeCoercible = z4.$ZodNumber | z4.$ZodBoolean | z4.$ZodBigInt | z4.$ZodDate;

type SchemaDef = z4.$ZodTypeDef & Record<string, unknown>;
type WrapperDef = SchemaDef & { innerType: ZodSchema };
type LazyDef = SchemaDef & { getter: () => ZodSchema };
type ObjectDef = SchemaDef & { shape: Record<string, ZodSchema> };
type ArrayDef = SchemaDef & { element: ZodSchema };
type UnionDef = SchemaDef & { options: ZodSchema[] };
type IntersectionDef = SchemaDef & { left: ZodSchema; right: ZodSchema };
type LiteralDef = SchemaDef & { values: unknown[] };
type EnumDef = SchemaDef & { entries: Record<string, string | number> };
type PipeDef = SchemaDef & {
  in: ZodSchema;
  out: ZodSchema;
  transform?: unknown;
  reverseTransform?: unknown;
};

const knownSchemaKinds = new Set<SchemaKind>([
  'array',
  'bigint',
  'boolean',
  'date',
  'default',
  'enum',
  'intersection',
  'lazy',
  'literal',
  'never',
  'nullable',
  'number',
  'object',
  'optional',
  'pipe',
  'string',
  'transform',
  'undefined',
  'union',
  'void',
  'unknown',
]);

const getDefinition = (schema: ZodSchema): SchemaDef => schema._zod.def as SchemaDef;

export const isZodSchema = (value: unknown): value is ZodSchema => {
  if (typeof value !== 'object' || value === null || !('_zod' in value)) {
    return false;
  }

  const internals = (value as { _zod?: { def?: { type?: unknown } } })._zod;
  return typeof internals?.def?.type === 'string';
};

export const getSchemaKind = (schema: ZodSchema): SchemaKind => {
  const kind = getDefinition(schema).type;
  return knownSchemaKinds.has(kind as SchemaKind) ? (kind as SchemaKind) : 'unknown';
};

export const isOptionalSchema = (schema: ZodSchema): boolean => {
  const kind = getSchemaKind(schema);
  const def = getDefinition(schema);

  if (kind === 'pipe') {
    const pipe = def as PipeDef;
    if (getSchemaKind(pipe.in) === 'transform') {
      return isOptionalSchema(pipe.out);
    }
    return isOptionalSchema(pipe.in);
  }
  if (kind === 'lazy') {
    return isOptionalSchema((def as LazyDef).getter());
  }
  if (kind === 'nullable') {
    return isOptionalSchema((def as WrapperDef).innerType);
  }
  return schema._zod.optin === 'optional';
};

export type UnwrapSchemaOptions = {
  io?: 'input' | 'output';
};

export const unwrapSchema = (schema: ZodSchema, options: UnwrapSchemaOptions = {}): ZodSchema => {
  const io = options.io ?? 'input';
  const seen = new Set<ZodSchema>();
  let current = schema;

  while (true) {
    if (seen.has(current)) {
      throw new Error('Cyclic Zod wrapper schema is not supported');
    }
    seen.add(current);

    const kind = getSchemaKind(current);
    const def = getDefinition(current);

    if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
      current = (def as WrapperDef).innerType;
      continue;
    }

    if (kind === 'lazy') {
      current = (def as LazyDef).getter();
      continue;
    }

    if (kind === 'pipe') {
      const pipe = def as PipeDef;
      if (pipe.transform || pipe.reverseTransform) {
        throw new Error('Zod codecs are not supported by OpenAPI generation');
      }

      const inputKind = getSchemaKind(pipe.in);
      const outputKind = getSchemaKind(pipe.out);

      if (inputKind === 'transform') {
        current = pipe.out;
        continue;
      }

      if (outputKind === 'transform') {
        if (io === 'output') {
          throw new Error('Zod transform output cannot be represented in OpenAPI');
        }
        current = pipe.in;
        continue;
      }

      current = io === 'input' ? pipe.in : pipe.out;
      continue;
    }

    if (kind === 'transform') {
      throw new Error('Standalone Zod transforms cannot be represented in OpenAPI');
    }

    return current;
  }
};

export const getObjectShape = (schema: ZodSchema): Record<string, ZodSchema> => {
  const unwrapped = unwrapSchema(schema, { io: 'input' });
  if (getSchemaKind(unwrapped) !== 'object') {
    throw new Error('Expected a Zod object schema');
  }
  return (getDefinition(unwrapped) as ObjectDef).shape;
};

export const getArrayElement = (schema: ZodSchema): ZodSchema => {
  const unwrapped = unwrapSchema(schema, { io: 'input' });
  if (getSchemaKind(unwrapped) !== 'array') {
    throw new Error('Expected a Zod array schema');
  }
  return (getDefinition(unwrapped) as ArrayDef).element;
};

export const getLiteralValues = (schema: ZodSchema): unknown[] => {
  if (getSchemaKind(schema) !== 'literal') {
    throw new Error('Expected a Zod literal schema');
  }
  return [...(getDefinition(schema) as LiteralDef).values];
};

export const getEnumValues = (schema: ZodSchema): Array<string | number> => {
  if (getSchemaKind(schema) !== 'enum') {
    throw new Error('Expected a Zod enum schema');
  }
  return Object.values((getDefinition(schema) as EnumDef).entries);
};

export const isStringLikeSchema = (schema: ZodSchema): schema is ZodTypeLikeString => {
  if (getSchemaKind(schema) === 'pipe') {
    const pipe = getDefinition(schema) as PipeDef;
    if (getSchemaKind(pipe.in) === 'transform') {
      return true;
    }
  }

  const unwrapped = unwrapSchema(schema, { io: 'input' });
  const kind = getSchemaKind(unwrapped);

  if (kind === 'string') {
    return true;
  }
  if (kind === 'literal') {
    return getLiteralValues(unwrapped).every((value) => typeof value === 'string');
  }
  if (kind === 'enum') {
    return getEnumValues(unwrapped).every((value) => typeof value === 'string');
  }
  if (kind === 'union') {
    return (getDefinition(unwrapped) as UnionDef).options.every(isStringLikeSchema);
  }
  if (kind === 'intersection') {
    const { left, right } = getDefinition(unwrapped) as IntersectionDef;
    return isStringLikeSchema(left) && isStringLikeSchema(right);
  }
  return false;
};

export const isCoercibleSchema = (schema: ZodSchema): schema is ZodTypeCoercible => {
  const kind = getSchemaKind(unwrapSchema(schema, { io: 'input' }));
  return kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'date';
};

const enableCoercion = (schema: ZodSchema, seen: Set<ZodSchema>): void => {
  if (seen.has(schema)) {
    return;
  }
  seen.add(schema);

  const kind = getSchemaKind(schema);
  const def = getDefinition(schema);

  if (kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'date') {
    def.coerce = true;
    return;
  }

  if (kind === 'object') {
    Object.values((def as ObjectDef).shape).forEach((child) => enableCoercion(child, seen));
    return;
  }
  if (kind === 'array') {
    enableCoercion((def as ArrayDef).element, seen);
    return;
  }
  if (kind === 'union') {
    (def as UnionDef).options.forEach((child) => enableCoercion(child, seen));
    return;
  }
  if (kind === 'intersection') {
    const { left, right } = def as IntersectionDef;
    enableCoercion(left, seen);
    enableCoercion(right, seen);
    return;
  }
  if (kind === 'lazy') {
    enableCoercion((def as LazyDef).getter(), seen);
    return;
  }
  if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
    enableCoercion((def as WrapperDef).innerType, seen);
    return;
  }
  if (kind === 'pipe') {
    const pipe = def as PipeDef;
    if (!pipe.transform && !pipe.reverseTransform) {
      enableCoercion(pipe.in, seen);
      enableCoercion(pipe.out, seen);
    }
  }
};

export const enableCoercionOnClonedSchema = (schema: ZodSchema): void => {
  enableCoercion(schema, new Set());
};

const cloneSchemaDefinition = (schema: ZodSchema, clones: Map<ZodSchema, ZodSchema>): ZodSchema => {
  const existing = clones.get(schema);
  if (existing) {
    return existing;
  }

  const kind = getSchemaKind(schema);
  const sourceDef = getDefinition(schema);
  const clonedDef: SchemaDef = { ...sourceDef };

  if (kind === 'object') {
    clonedDef.shape = Object.fromEntries(
      Object.entries((sourceDef as ObjectDef).shape).map(([key, child]) => [
        key,
        cloneSchemaDefinition(child, clones),
      ]),
    );
  } else if (kind === 'array') {
    clonedDef.element = cloneSchemaDefinition((sourceDef as ArrayDef).element, clones);
  } else if (kind === 'union') {
    clonedDef.options = (sourceDef as UnionDef).options.map((child) =>
      cloneSchemaDefinition(child, clones),
    );
  } else if (kind === 'intersection') {
    const { left, right } = sourceDef as IntersectionDef;
    clonedDef.left = cloneSchemaDefinition(left, clones);
    clonedDef.right = cloneSchemaDefinition(right, clones);
  } else if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
    clonedDef.innerType = cloneSchemaDefinition((sourceDef as WrapperDef).innerType, clones);
  } else if (kind === 'pipe') {
    const pipe = sourceDef as PipeDef;
    clonedDef.in = cloneSchemaDefinition(pipe.in, clones);
    clonedDef.out = cloneSchemaDefinition(pipe.out, clones);
  } else if (kind === 'lazy') {
    const lazy = sourceDef as LazyDef;
    clonedDef.getter = () => cloneSchemaDefinition(lazy.getter(), clones);
  }

  const cloned = z4.clone(schema, clonedDef as ZodSchema['_zod']['def']);
  clones.set(schema, cloned);
  return cloned;
};

export const cloneSchema = <T extends ZodSchema>(schema: T): T => {
  return cloneSchemaDefinition(schema, new Map()) as T;
};

const coercePrimitiveValue = (kind: SchemaKind, value: unknown): unknown => {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  if (kind === 'number') {
    return typeof normalizedValue === 'string' ? Number(normalizedValue) : normalizedValue;
  }
  if (kind === 'boolean') {
    return typeof normalizedValue === 'string' ? Boolean(normalizedValue) : normalizedValue;
  }
  if (kind === 'bigint' && typeof normalizedValue === 'string') {
    try {
      return BigInt(normalizedValue);
    } catch {
      return normalizedValue;
    }
  }
  if (
    kind === 'date' &&
    (typeof normalizedValue === 'string' || typeof normalizedValue === 'number')
  ) {
    return new Date(normalizedValue);
  }
  return normalizedValue;
};

const coerceValue = (
  schema: ZodSchema,
  value: unknown,
  seen: Set<ZodSchema>,
  wrapArrayValues: boolean,
  coercePrimitives: boolean,
): unknown => {
  if (seen.has(schema)) {
    return value;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(schema);
  const kind = getSchemaKind(schema);
  const def = getDefinition(schema);

  if (
    wrapArrayValues &&
    (kind === 'string' || kind === 'literal' || kind === 'enum') &&
    Array.isArray(value)
  ) {
    return value[0];
  }
  if (kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'date') {
    const normalizedValue = wrapArrayValues && Array.isArray(value) ? value[0] : value;
    return coercePrimitives && def.coerce
      ? coercePrimitiveValue(kind, normalizedValue)
      : normalizedValue;
  }
  if (kind === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const result = { ...(value as Record<string, unknown>) };
    for (const [key, child] of Object.entries((def as ObjectDef).shape)) {
      if (key in result) {
        result[key] = coerceValue(child, result[key], nextSeen, wrapArrayValues, coercePrimitives);
      }
    }
    return result;
  }
  if (kind === 'array') {
    const arrayValue = Array.isArray(value)
      ? value
      : wrapArrayValues && value !== undefined
      ? [value]
      : value;
    return Array.isArray(arrayValue)
      ? arrayValue.map((item) =>
          coerceValue((def as ArrayDef).element, item, nextSeen, wrapArrayValues, coercePrimitives),
        )
      : arrayValue;
  }
  if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
    return coerceValue(
      (def as WrapperDef).innerType,
      value,
      nextSeen,
      wrapArrayValues,
      coercePrimitives,
    );
  }
  if (kind === 'lazy') {
    return coerceValue(
      (def as LazyDef).getter(),
      value,
      nextSeen,
      wrapArrayValues,
      coercePrimitives,
    );
  }
  if (kind === 'pipe') {
    const pipe = def as PipeDef;
    if (getSchemaKind(pipe.in) === 'transform' && getSchemaKind(pipe.out) === 'array') {
      return Array.isArray(value)
        ? coerceValue(pipe.out, value, nextSeen, wrapArrayValues, coercePrimitives)
        : value;
    }
    const transportSchema =
      getSchemaKind(pipe.in) === 'transform'
        ? pipe.out
        : getSchemaKind(pipe.out) === 'transform'
        ? pipe.in
        : pipe.in;
    return coerceValue(transportSchema, value, nextSeen, wrapArrayValues, coercePrimitives);
  }
  if (kind === 'union') {
    const [firstOption] = (def as UnionDef).options;
    return firstOption
      ? coerceValue(firstOption, value, nextSeen, wrapArrayValues, coercePrimitives)
      : value;
  }
  if (kind === 'intersection') {
    const { left, right } = def as IntersectionDef;
    return coerceValue(
      right,
      coerceValue(left, value, nextSeen, wrapArrayValues, coercePrimitives),
      nextSeen,
      wrapArrayValues,
      coercePrimitives,
    );
  }
  return value;
};

export const coerceInputValue = (
  schema: ZodSchema,
  value: unknown,
  options: { wrapArrayValues?: boolean } = {},
): unknown => {
  return coerceValue(schema, value, new Set(), options.wrapArrayValues ?? false, true);
};

export const normalizeInputValue = (
  schema: ZodSchema,
  value: unknown,
  options: { wrapArrayValues?: boolean } = {},
): unknown => {
  return coerceValue(schema, value, new Set(), options.wrapArrayValues ?? false, false);
};

const assertRepresentable = (
  schema: ZodSchema,
  io: 'input' | 'output',
  ancestors: Set<ZodSchema>,
): void => {
  if (ancestors.has(schema)) {
    throw new Error('Cyclic Zod schemas cannot be represented inline in OpenAPI');
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(schema);
  const kind = getSchemaKind(schema);
  const def = getDefinition(schema);

  if (kind === 'object') {
    Object.values((def as ObjectDef).shape).forEach((child) =>
      assertRepresentable(child, io, nextAncestors),
    );
    return;
  }
  if (kind === 'array') {
    assertRepresentable((def as ArrayDef).element, io, nextAncestors);
    return;
  }
  if (kind === 'union') {
    (def as UnionDef).options.forEach((child) => assertRepresentable(child, io, nextAncestors));
    return;
  }
  if (kind === 'intersection') {
    const { left, right } = def as IntersectionDef;
    assertRepresentable(left, io, nextAncestors);
    assertRepresentable(right, io, nextAncestors);
    return;
  }
  if (kind === 'lazy') {
    assertRepresentable((def as LazyDef).getter(), io, nextAncestors);
    return;
  }
  if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
    assertRepresentable((def as WrapperDef).innerType, io, nextAncestors);
    return;
  }
  if (kind === 'pipe') {
    const pipe = def as PipeDef;
    if (pipe.transform || pipe.reverseTransform) {
      throw new Error('Zod codecs are not supported by OpenAPI generation');
    }
    if (getSchemaKind(pipe.in) === 'transform') {
      assertRepresentable(pipe.out, io, nextAncestors);
      return;
    }
    if (getSchemaKind(pipe.out) === 'transform') {
      if (io === 'output') {
        throw new Error('Zod transform output cannot be represented in OpenAPI');
      }
      assertRepresentable(pipe.in, io, nextAncestors);
      return;
    }
    assertRepresentable(io === 'input' ? pipe.in : pipe.out, io, nextAncestors);
    return;
  }
  if (kind === 'transform') {
    throw new Error('Standalone Zod transforms cannot be represented in OpenAPI');
  }
};

export const assertOpenApiRepresentable = (schema: ZodSchema, io: 'input' | 'output'): void => {
  assertRepresentable(schema, io, new Set());
};

export const getValidationIssues = (error: unknown): OpenApiValidationIssue[] | undefined => {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return undefined;
  }

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }

  return issues.filter(
    (issue): issue is OpenApiValidationIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { code?: unknown }).code === 'string' &&
      typeof (issue as { message?: unknown }).message === 'string' &&
      Array.isArray((issue as { path?: unknown }).path),
  );
};

// Backward-compatible exports retained with Zod 4-native types.
export const instanceofZodType = isZodSchema;
export const instanceofZodTypeOptional = (schema: ZodSchema): schema is z4.$ZodOptional =>
  getSchemaKind(schema) === 'optional';
export const instanceofZodTypeObject = (schema: ZodSchema): schema is z4.$ZodObject =>
  getSchemaKind(schema) === 'object';
export const instanceofZodTypeArray = (schema: ZodSchema): schema is z4.$ZodArray =>
  getSchemaKind(schema) === 'array';
export const instanceofZodTypeLikeVoid = (schema: ZodSchema): schema is ZodTypeLikeVoid => {
  const kind = getSchemaKind(schema);
  return kind === 'void' || kind === 'undefined' || kind === 'never';
};
export const unwrapZodType = (schema: ZodSchema, _unwrapPreprocess = true): ZodSchema =>
  unwrapSchema(schema, { io: 'input' });
export const instanceofZodTypeLikeString = isStringLikeSchema;
export const instanceofZodTypeCoercible = isCoercibleSchema;
