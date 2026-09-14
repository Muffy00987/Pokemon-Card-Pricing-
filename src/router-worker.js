import appWorker from './activity-worker.js';
import { handleCard } from './card-worker-v3.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/card') return handleCard(request, env);
    return appWorker.fetch(request, env, ctx);
  },
};
