/**
 * The app's server side, as a Vite plugin: the phone-remote hub on /ws and the /api routes.
 * Each area lives in its own module; this file only wires them up, in the order the routes
 * are matched. It runs under both `vite` (dev) and `vite preview` (the production build).
 */
import type { Connect, Plugin } from 'vite';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'http';
import { attachRemoteHub, handleRemoteInfo } from './remoteHub';
import { handleSearch, handleCacheStatus, handleStream, handleHeatmap } from './youtube';
import { handleRecommend } from './recommendations';
import { handleLlmHealth, handleLlm } from './llm';
import { handleHistory, handleFavorites, handleBanned, handleMySongs } from './library';
import { handleSystemMemory } from './system';
import { handleLocalLibrary, scanLibrary, backfillMostPlayed } from './localLibrary';

export function aiDjApiPlugin(): Plugin {
  return {
    name: 'ai-dj-api-plugin',
    configureServer(server) {
      if (server.httpServer) attachApi(server.httpServer as HttpServer, server.middlewares);
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachApi(server.httpServer as HttpServer, server.middlewares);
    },
  };
}

function attachApi(httpServer: HttpServer, middlewares: Connect.Server) {
  attachRemoteHub(httpServer);
  // Index the offline library, then save any most-played songs not saved yet
  void scanLibrary().then(backfillMostPlayed);

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const path = url.pathname;

    // Songs: search / YouTube links, the audio cache, streaming, replay heatmaps
    if (path === '/api/search') return handleSearch(req, res, url);
    if (path === '/api/cache/status') return handleCacheStatus(req, res, url);
    if (path === '/api/stream') return handleStream(req, res, url);
    if (path === '/api/recommend') return handleRecommend(req, res, url);
    if (path === '/api/remote-info') return handleRemoteInfo(res, httpServer);
    // AI DJ brain proxy: local Ollama first, Gemini as the cloud backup
    if (path === '/api/llm/health') return handleLlmHealth(req, res, url);
    if (path === '/api/llm' && req.method === 'POST') return handleLlm(req, res, url);
    if (path === '/api/heatmap') return handleHeatmap(req, res, url);
    // Library: these answer only some methods; anything else carries on to next()
    if (path === '/api/history' && (await handleHistory(req, res, url))) return;
    if ((path === '/api/favorites' || path === '/api/favorites/toggle') && (await handleFavorites(req, res, url))) return;
    if ((path === '/api/banned' || path === '/api/banned/toggle') && (await handleBanned(req, res, url))) return;
    if (path === '/api/my-songs' && (await handleMySongs(req, res, url))) return;
    if (path === '/api/system/memory') return handleSystemMemory(req, res, url);
    // Offline library: songs on this laptop (see localLibrary.ts)
    if (path.startsWith('/api/local/') && (await handleLocalLibrary(req, res, url))) return;

    next();
  });
}
