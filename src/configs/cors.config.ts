import { FastifyCorsOptions } from '@fastify/cors';

export function getCorsConfig(): FastifyCorsOptions {
  return {
    origin: ['http://localhost:3001', 'http://localhost:3000', 'chrome-extension://ndeidbfhlheccmpahojmhaiacekbehic'],
    //allowedHeaders: ['Access-Control-Allow-Origin', 'Origin', 'X-Requested-With', 'Accept', 'Content-Type', 'Authorization'],
    credentials: true,
    methods: ['GET', 'PUT', 'OPTIONS', 'POST'],
  };
}
