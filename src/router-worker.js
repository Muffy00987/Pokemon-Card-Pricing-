import appWorker from './activity-worker.js';
import { handleCard } from './card-worker-v3.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/card') {
      if (/^TCGdex\b/i.test(url.searchParams.get('set') || '')) {
        url.searchParams.set('set', '');
        request = new Request(url.toString(), request);
      }
      return handleCard(request, env);
    }
    return appWorker.fetch(request, env, ctx);
  },
};
