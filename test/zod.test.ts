import { z } from 'zod';

import {
  assertOpenApiRepresentable,
  cloneSchema,
  enableCoercionOnClonedSchema,
  getArrayElement,
  getEnumValues,
  getLiteralValues,
  getObjectShape,
  getSchemaKind,
  getValidationIssues,
  isCoercibleSchema,
  isOptionalSchema,
  isStringLikeSchema,
  isZodSchema,
  unwrapSchema,
} from '../src/utils/zod';

describe('Zod 4 schema utilities', () => {
  test.each([
    [z.string(), 'string'],
    [z.number(), 'number'],
    [z.boolean(), 'boolean'],
    [z.bigint(), 'bigint'],
    [z.date(), 'date'],
    [z.object({}), 'object'],
    [z.array(z.string()), 'array'],
    [z.string().optional(), 'optional'],
    [z.string().default('value'), 'default'],
    [z.lazy(() => z.string()), 'lazy'],
    [z.string().pipe(z.string()), 'pipe'],
    [z.transform(() => 'value'), 'transform'],
    [z.union([z.string(), z.number()]), 'union'],
    [z.intersection(z.string(), z.string()), 'intersection'],
    [z.literal('value'), 'literal'],
    [z.enum(['one', 'two']), 'enum'],
    [z.void(), 'void'],
    [z.undefined(), 'undefined'],
    [z.never(), 'never'],
  ])('recognizes schema kind %#', (schema, kind) => {
    expect(isZodSchema(schema)).toBe(true);
    expect(getSchemaKind(schema)).toBe(kind);
  });

  test('rejects non-Zod values', () => {
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema({ _zod: {} })).toBe(false);
    expect(isZodSchema({ parse: () => undefined })).toBe(false);
  });

  test('unwraps optional, default, lazy, preprocess, and regular pipes', () => {
    expect(getSchemaKind(unwrapSchema(z.string().optional()))).toBe('string');
    expect(getSchemaKind(unwrapSchema(z.number().default(1)))).toBe('number');
    expect(getSchemaKind(unwrapSchema(z.lazy(() => z.boolean())))).toBe('boolean');
    expect(getSchemaKind(unwrapSchema(z.preprocess(Number, z.number())))).toBe('number');

    const pipeInput = z.string();
    const pipeOutput = z.string().min(1);
    const pipe = pipeInput.pipe(pipeOutput);
    expect(unwrapSchema(pipe, { io: 'input' })).toBe(pipeInput);
    expect(unwrapSchema(pipe, { io: 'output' })).toBe(pipeOutput);
  });

  test('uses transform input for requests and rejects transform output documentation', () => {
    const transform = z.string().transform((value) => value.length);
    expect(getSchemaKind(unwrapSchema(transform, { io: 'input' }))).toBe('string');
    expect(() => unwrapSchema(transform, { io: 'output' })).toThrow(
      'Zod transform output cannot be represented',
    );
  });

  test('rejects codecs explicitly', () => {
    const codec = z.codec(z.iso.datetime(), z.date(), {
      decode: (value) => new Date(value),
      encode: (value) => value.toISOString(),
    });
    expect(() => unwrapSchema(codec)).toThrow('Zod codecs are not supported');
    expect(() => assertOpenApiRepresentable(codec, 'input')).toThrow(
      'Zod codecs are not supported',
    );
  });

  test('reads object, array, literal, and enum definitions', () => {
    const name = z.string();
    expect(getObjectShape(z.object({ name }))).toEqual({ name });
    expect(getArrayElement(z.array(name))).toBe(name);
    expect(getLiteralValues(z.literal(['one', 'two']))).toEqual(['one', 'two']);
    expect(getEnumValues(z.enum(['one', 'two']))).toEqual(['one', 'two']);
  });

  test('classifies optional, string-like, and coercible schemas', () => {
    expect(isOptionalSchema(z.string().optional())).toBe(true);
    expect(isOptionalSchema(z.string().default('value'))).toBe(true);
    expect(isOptionalSchema(z.preprocess((value) => value, z.string()))).toBe(false);
    expect(isOptionalSchema(z.preprocess((value) => value, z.string().optional()))).toBe(true);

    expect(isStringLikeSchema(z.string())).toBe(true);
    expect(isStringLikeSchema(z.literal('value'))).toBe(true);
    expect(isStringLikeSchema(z.enum(['one', 'two']))).toBe(true);
    expect(isStringLikeSchema(z.union([z.string(), z.literal('value')]))).toBe(true);
    expect(isStringLikeSchema(z.union([z.string(), z.number()]))).toBe(false);

    expect(isCoercibleSchema(z.number())).toBe(true);
    expect(isCoercibleSchema(z.boolean().optional())).toBe(true);
    expect(isCoercibleSchema(z.bigint())).toBe(true);
    expect(isCoercibleSchema(z.date())).toBe(true);
    expect(isCoercibleSchema(z.string())).toBe(false);
  });

  test('enables nested coercion only on a cloned schema', () => {
    const original = z.object({
      number: z.number(),
      nested: z.object({ date: z.date() }),
      items: z.array(z.bigint()),
    });
    const cloned = cloneSchema(original);

    enableCoercionOnClonedSchema(cloned);

    expect(
      cloned.safeParse({ number: '42', nested: { date: '2026-01-01' }, items: ['7'] }).success,
    ).toBe(true);
    expect(
      original.safeParse({ number: '42', nested: { date: '2026-01-01' }, items: ['7'] }).success,
    ).toBe(false);
  });

  test('rejects recursive lazy schemas for inline OpenAPI generation', () => {
    let recursive: z.ZodTypeAny;
    recursive = z.lazy(() => z.object({ child: recursive.optional() }));

    expect(() => assertOpenApiRepresentable(recursive, 'input')).toThrow(
      'Cyclic Zod schemas cannot be represented inline',
    );
  });

  test('extracts Zod 4 validation issues', () => {
    const result = z.object({ age: z.number() }).safeParse({ age: 'invalid' });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected parsing to fail');
    }

    expect(getValidationIssues(result.error)).toEqual(result.error.issues);
    expect(getValidationIssues(new Error('not a validation error'))).toBeUndefined();
  });
});
