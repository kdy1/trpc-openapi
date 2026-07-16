import { createOpenApiNuxtHandler } from 'better-trpc-openapi';

import { appRouter, createContext } from '../router';

export default createOpenApiNuxtHandler({
  router: appRouter,
  createContext,
});
