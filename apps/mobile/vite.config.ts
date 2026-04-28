import { queryBestRecommendation } from '../../packages/adapters/12306/src/orchestrator';
import type { QueryInput } from '../../packages/core/src/types';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : null;
}

function isQueryInput(value: unknown): value is QueryInput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const input = value as Record<string, unknown>;
  return (
    typeof input.travelDate === 'string' &&
    typeof input.departureCity === 'string' &&
    typeof input.arrivalCity === 'string'
  );
}

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'train-ticket-dev-query-endpoint',
      configureServer(server) {
        server.middlewares.use('/__dev/query-best-ticket', async (request, response, next) => {
          if (request.method !== 'POST') {
            next();
            return;
          }

          try {
            const payload = await readJsonBody(request);
            if (!isQueryInput(payload)) {
              response.statusCode = 400;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify({ message: 'Invalid query payload' }));
              return;
            }

            const result = await queryBestRecommendation(payload);
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(result));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/12306': {
        target: 'https://kyfw.12306.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/12306/, ''),
        secure: true,
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
