import { createApp } from './app.mjs';

const app = createApp();

export default {
  fetch: (request, env) => app(request, env),
};
