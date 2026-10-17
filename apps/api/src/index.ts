import { Hono } from 'hono';
import type { Env } from './env';

export function createApp() {
  return new Hono<{ Bindings: Env }>();
}

export default createApp();
