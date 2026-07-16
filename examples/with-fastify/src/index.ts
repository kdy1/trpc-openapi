/* 
  eslint-disable
  @typescript-eslint/no-misused-promises,
  @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-explicit-any,
  promise/always-return
 */
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fastifyTRPCOpenApiPlugin } from 'better-trpc-openapi';
import Fastify from 'fastify';

import { openApiDocument } from './openapi';
import { appRouter, createContext } from './router';

const app = Fastify();

async function main() {
  // Setup CORS
  await app.register(cors);

  // Handle incoming tRPC requests
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    useWss: false,
    trpcOptions: { router: appRouter, createContext },
  } as any);

  // Handle incoming OpenAPI requests
  await app.register(fastifyTRPCOpenApiPlugin, {
    basePath: '/api',
    router: appRouter,
    createContext,
  });

  // Serve the OpenAPI document
  app.get('/openapi.json', () => openApiDocument);

  // Register the OpenAPI document with Fastify Swagger
  await app.register(fastifySwagger, {
    mode: 'static',
    specification: { document: openApiDocument },
  });

  await app
    .listen({ port: 3000 })
    .then((address) => {
      app.swagger();
      console.log(`Server started on ${address}\nOpenAPI: http://localhost:3000/openapi.json`);
    })
    .catch((e) => {
      throw e;
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
