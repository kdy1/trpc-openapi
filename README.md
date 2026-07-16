![better-trpc-openapi](assets/trpc-openapi-readme.png)

<div align="center">
  <h1>better-trpc-openapi</h1>
  <a href="https://www.npmjs.com/package/better-trpc-openapi"><img src="https://img.shields.io/npm/v/better-trpc-openapi.svg?style=flat&color=brightgreen" target="_blank" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black" /></a>
  <a href="https://trpc.io/discord" target="_blank"><img src="https://img.shields.io/badge/chat-discord-blue.svg" /></a>
  <br />
  <hr />
</div>

#### `better-trpc-openapi` is the Zod 4-native maintained fork of `trpc-openapi`.

---

## **[OpenAPI](https://swagger.io/specification/) support for [tRPC](https://trpc.io/)** 🧩

- Easy REST endpoints for your tRPC procedures.
- Perfect for incremental adoption.
- OpenAPI version 3.0.3.

## Usage

**1. Install `better-trpc-openapi`, tRPC 11, and Zod 4.**

```bash
# npm
npm install better-trpc-openapi @trpc/server@^11 zod@^4
# yarn
yarn add better-trpc-openapi @trpc/server@^11 zod@^4
```

**2. Add `OpenApiMeta` to your tRPC instance.**

```typescript
import { initTRPC } from '@trpc/server';
import { OpenApiMeta } from 'better-trpc-openapi';

const t = initTRPC.meta<OpenApiMeta>().create(); /* 👈 */
```

**3. Enable `openapi` support for a procedure.**

```typescript
export const appRouter = t.router({
  sayHello: t.procedure
    .meta({ /* 👉 */ openapi: { method: 'GET', path: '/say-hello' } })
    .input(z.object({ name: z.string() }))
    .output(z.object({ greeting: z.string() }))
    .query(({ input }) => {
      return { greeting: `Hello ${input.name}!` };
    });
});
```

**4. Generate an OpenAPI document.**

```typescript
import { generateOpenApiDocument } from 'better-trpc-openapi';

import { appRouter } from '../appRouter';

/* 👇 */
export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'tRPC OpenAPI',
  version: '1.0.0',
  baseUrl: 'http://localhost:3000',
});
```

**5. Add a `better-trpc-openapi` handler to your app.**

We currently support adapters for [`Express`](http://expressjs.com/), [`Next.js`](https://nextjs.org/), [`Serverless`](https://www.serverless.com/), [`Fastify`](https://www.fastify.io/), [`Nuxt`](https://nuxtjs.org/) & [`Node:HTTP`](https://nodejs.org/api/http.html).

[`Fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API), [`Cloudflare Workers`](https://workers.cloudflare.com/) & more soon™, PRs are welcomed 🙌.

```typescript
import { createOpenApiHttpHandler } from 'better-trpc-openapi';
import http from 'http';

import { appRouter } from '../appRouter';

const server = http.createServer(createOpenApiHttpHandler({ router: appRouter })); /* 👈 */

server.listen(3000);
```

**6. Profit 🤑**

```typescript
// client.ts
const res = await fetch('http://localhost:3000/say-hello?name=James', { method: 'GET' });
const body = await res.json(); /* { greeting: 'Hello James!' } */
```

## Requirements

Peer dependencies:

- [`tRPC`](https://github.com/trpc/trpc) Server v11 (`@trpc/server@^11`) must be installed.
- [`Zod`](https://github.com/colinhacks/zod) v4 (`zod@^4.0.0`) must be installed. Zod 3 is not supported.

For a procedure to support OpenAPI the following _must_ be true:

- Both `input` and `output` parsers are present AND use `Zod` validation.
- Query `input` parsers extend `Object<{ [string]: String | Number | BigInt | Date }>` or `Void`.
- Mutation `input` parsers extend `Object<{ [string]: AnyType }>` or `Void`.
- `meta.openapi.method` is `GET`, `POST`, `PATCH`, `PUT` or `DELETE`.
- `meta.openapi.path` is a string starting with `/`.
- `meta.openapi.path` parameters exist in `input` parser as `String | Number | BigInt | Date`

Please note:

- Data [`transformers`](https://trpc.io/docs/data-transformers) (such as `superjson`) are ignored.
- Trailing slashes are ignored.
- Routing is case-insensitive.

### Zod 4 schema behavior

- Request preprocessors are documented using their output schema, while request transforms are documented using the values they accept.
- Response transforms cannot be represented reliably and cause document generation to fail with the affected procedure name.
- Zod codecs and cyclic schemas are rejected with a contextual error because OpenAPI 3.0 cannot inline them safely.
- Zod metadata is preserved where OpenAPI 3.0 supports it. JSON Schema `examples` are represented by OpenAPI 3.0's singular `example` field.

## HTTP Requests

Procedures with a `GET`/`DELETE` method will accept inputs via URL `query parameters`. Procedures with a `POST`/`PATCH`/`PUT` method will accept inputs via the `request body` with a `application/json` or `application/x-www-form-urlencoded` content type.

### Path parameters

A procedure can accept a set of inputs via URL path parameters. You can add a path parameter to any OpenAPI procedure by using curly brackets around an input name as a path segment in the `meta.openapi.path` field.

### Query parameters

Query & path parameter inputs are always accepted as a `string`. This library will attempt to [coerce](https://github.com/colinhacks/zod#coercion-for-primitives) your input `array` and `object` values to the following primitive types out of the box: `number`, `boolean`, `bigint` and `date`. If you wish to support others (such as nested `object`, `array`) etc. please use [`z.preprocess()`](https://github.com/colinhacks/zod#preprocess).

```typescript
// Router
export const appRouter = t.router({
  sayHello: t.procedure
    .meta({ openapi: { method: 'GET', path: '/say-hello/{name}' /* 👈 */ } })
    .input(z.object({ name: z.string() /* 👈 */, greeting: z.string() }))
    .output(z.object({ greeting: z.string() }))
    .query(({ input }) => {
      return { greeting: `${input.greeting} ${input.name}!` };
    });
});

// Client
const res = await fetch('http://localhost:3000/say-hello/James?greeting=Hello' /* 👈 */, {
  method: 'GET',
});
const body = await res.json(); /* { greeting: 'Hello James!' } */
```

### Request body

```typescript
// Router
export const appRouter = t.router({
  sayHello: t.procedure
    .meta({ openapi: { method: 'POST', path: '/say-hello/{name}' /* 👈 */ } })
    .input(z.object({ name: z.string() /* 👈 */, greeting: z.string() }))
    .output(z.object({ greeting: z.string() }))
    .mutation(({ input }) => {
      return { greeting: `${input.greeting} ${input.name}!` };
    });
});

// Client
const res = await fetch('http://localhost:3000/say-hello/James' /* 👈 */, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ greeting: 'Hello' }),
});
const body = await res.json(); /* { greeting: 'Hello James!' } */
```

### Custom headers

Any custom headers can be specified in the `meta.openapi.headers` array, these headers will not be validated on request. Please consider using [Authorization](#authorization) for first-class OpenAPI auth/security support.

## HTTP Responses

Status codes will be `200` by default for any successful requests. In the case of an error, the status code will be derived from the thrown `TRPCError` or fallback to `500`.

You can modify the status code or headers for any response using the `responseMeta` function.

Please see [error status codes here](src/adapters/node-http/errors.ts).

## Authorization

To create protected endpoints, add `protect: true` to the `meta.openapi` object of each tRPC procedure. By default, you can then authenticate each request with the `createContext` function using the `Authorization` header with the `Bearer` scheme. If you wish to authenticate requests using a different/additional methods (such as custom headers, or cookies) this can be overwritten by specifying `securitySchemes` object.

Explore a [complete example here](examples/with-nextjs/src/server/router.ts).

#### Server

```typescript
import { TRPCError, initTRPC } from '@trpc/server';
import { OpenApiMeta } from 'better-trpc-openapi';

type User = { id: string; name: string };

const users: User[] = [
  {
    id: 'usr_123',
    name: 'James',
  },
];

export type Context = { user: User | null };

export const createContext = async ({ req, res }): Promise<Context> => {
  let user: User | null = null;
  if (req.headers.authorization) {
    const userId = req.headers.authorization.split(' ')[1];
    user = users.find((_user) => _user.id === userId);
  }
  return { user };
};

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();

export const appRouter = t.router({
  sayHello: t.procedure
    .meta({ openapi: { method: 'GET', path: '/say-hello', protect: true /* 👈 */ } })
    .input(z.void()) // no input expected
    .output(z.object({ greeting: z.string() }))
    .query(({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ message: 'User not found', code: 'UNAUTHORIZED' });
      }
      return { greeting: `Hello ${ctx.user.name}!` };
    }),
});
```

#### Client

```typescript
const res = await fetch('http://localhost:3000/say-hello', {
  method: 'GET',
  headers: { Authorization: 'Bearer usr_123' } /* 👈 */,
});
const body = await res.json(); /* { greeting: 'Hello James!' } */
```

## Examples

_For advanced use-cases, please find examples in our [complete test suite](test)._

#### With Express

Please see [full example here](examples/with-express).

```typescript
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createOpenApiExpressMiddleware } from 'better-trpc-openapi';
import express from 'express';

import { appRouter } from '../appRouter';

const app = express();

app.use('/api/trpc', createExpressMiddleware({ router: appRouter }));
app.use('/api', createOpenApiExpressMiddleware({ router: appRouter })); /* 👈 */

app.listen(3000);
```

#### With Next.js

Please see [full example here](examples/with-nextjs).

```typescript
// pages/api/[...trpc].ts
import { createOpenApiNextHandler } from 'better-trpc-openapi';

import { appRouter } from '../../server/appRouter';

export default createOpenApiNextHandler({ router: appRouter });
```

#### With AWS Lambda

Please see [full example here](examples/with-serverless).

```typescript
import { createOpenApiAwsLambdaHandler } from 'better-trpc-openapi';

import { appRouter } from './appRouter';

export const openApi = createOpenApiAwsLambdaHandler({ router: appRouter });
```

#### With Fastify

Please see [full example here](examples/with-fastify).

```typescript
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fastifyTRPCOpenApiPlugin } from 'better-trpc-openapi';
import Fastify from 'fastify';

import { appRouter } from './router';

const fastify = Fastify();

async function main() {
  await fastify.register(fastifyTRPCPlugin, { router: appRouter });
  await fastify.register(fastifyTRPCOpenApiPlugin, { router: appRouter }); /* 👈 */

  await fastify.listen({ port: 3000 });
}

main();
```

## Types

#### GenerateOpenApiDocumentOptions

Please see [full typings here](src/generator/index.ts).

| Property          | Type                                   | Description                                             | Required |
| ----------------- | -------------------------------------- | ------------------------------------------------------- | -------- |
| `title`           | `string`                               | The title of the API.                                   | `true`   |
| `description`     | `string`                               | A short description of the API.                         | `false`  |
| `version`         | `string`                               | The version of the OpenAPI document.                    | `true`   |
| `baseUrl`         | `string`                               | The base URL of the target server.                      | `true`   |
| `docsUrl`         | `string`                               | A URL to any external documentation.                    | `false`  |
| `tags`            | `string[]`                             | A list for ordering endpoint groups.                    | `false`  |
| `securitySchemes` | `Record<string, SecuritySchemeObject>` | Defaults to `Authorization` header with `Bearer` scheme | `false`  |

#### OpenApiMeta

Please see [full typings here](src/types.ts).

| Property       | Type                | Description                                                                                          | Required | Default                |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | -------- | ---------------------- |
| `enabled`      | `boolean`           | Exposes this procedure to `better-trpc-openapi` adapters and on the OpenAPI document.                | `false`  | `true`                 |
| `method`       | `HttpMethod`        | HTTP method this endpoint is exposed on. Value can be `GET`, `POST`, `PATCH`, `PUT` or `DELETE`.     | `true`   | `undefined`            |
| `path`         | `string`            | Pathname this endpoint is exposed on. Value must start with `/`, specify path parameters using `{}`. | `true`   | `undefined`            |
| `protect`      | `boolean`           | Requires this endpoint to use a security scheme.                                                     | `false`  | `false`                |
| `summary`      | `string`            | A short summary of the endpoint included in the OpenAPI document.                                    | `false`  | `undefined`            |
| `description`  | `string`            | A verbose description of the endpoint included in the OpenAPI document.                              | `false`  | `undefined`            |
| `tags`         | `string[]`          | A list of tags used for logical grouping of endpoints in the OpenAPI document.                       | `false`  | `undefined`            |
| `headers`      | `ParameterObject[]` | An array of custom headers to add for this endpoint in the OpenAPI document.                         | `false`  | `undefined`            |
| `contentTypes` | `ContentType[]`     | A set of content types specified as accepted in the OpenAPI document.                                | `false`  | `['application/json']` |
| `deprecated`   | `boolean`           | Whether or not to mark an endpoint as deprecated                                                     | `false`  | `false`                |

#### CreateOpenApiNodeHttpHandlerOptions

Please see [full typings here](src/adapters/node-http/core.ts).

| Property        | Type       | Description                                            | Required |
| --------------- | ---------- | ------------------------------------------------------ | -------- |
| `router`        | `Router`   | Your application tRPC router.                          | `true`   |
| `createContext` | `Function` | Passes contextual (`ctx`) data to procedure resolvers. | `false`  |
| `responseMeta`  | `Function` | Returns any modifications to statusCode & headers.     | `false`  |
| `onError`       | `Function` | Called if error occurs inside handler.                 | `false`  |
| `maxBodySize`   | `number`   | Maximum request body size in bytes (default: 100kb).   | `false`  |

---

See the [minimal tRPC 11 router](examples/with-interop) example.

## License

Distributed under the MIT License. See LICENSE for more information.

## Contact

James Berry - Follow me on Twitter [@jlalmes](https://twitter.com/jlalmes) 💚
