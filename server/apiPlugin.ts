import { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { Ytdl } from '@distube/ytdl-core';
// @ts-expect-error yt-search has untyped default export
import ytSearch from 'yt-search';
import { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5:3b';
// Keep the model in RAM: a cold load takes ~3–12 s on this laptop, a warm answer ~4 s
const OLLAMA_KEEP_ALIVE = '30m';

/**
 * One JSON-mode completion from the local model (CPU only, see SETUP_AND_OPERATIONS.md §2).
 * With a JSON schema the answer is constrained to it (e.g. one value from an enum), which a
 * small model needs for reliable classification; such answers also use temperature 0.
 */
async function ollamaGenerate(prompt: string, maxTokens: number, timeoutMs: number, schema?: object): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: schema ?? 'json',
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { num_gpu: 0, temperature: schema ? 0 : 0.2, num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
  const data = await resp.json();
  return data.response as string;
}

let ollamaWarmed = false;

const ROOT_DIR = process.cwd();
const MY_SONGS_FILE = path.join(ROOT_DIR, 'my_songs.txt');
const DATA_DIR = path.join(ROOT_DIR, 'data');

// Downloaded song audio (compressed, as YouTube sends it; ~4 MB per song), one file per video id
const AUDIO_CACHE_DIR = path.join(ROOT_DIR, 'cache', 'audio');
const AUDIO_CACHE_MAX_BYTES = 2 * 1024 ** 3; // ~500 songs; least recently played go first

function cachedAudioPath(videoId: string): string {
  return path.join(AUDIO_CACHE_DIR, `${videoId}.audio`);
}

let pruning = false;
/** Keeps the audio cache under its size limit by deleting the least recently played songs. */
async function pruneAudioCache() {
  if (pruning) return;
  pruning = true;
  try {
    const names = (await fs.promises.readdir(AUDIO_CACHE_DIR)).filter((n) => n.endsWith('.audio'));
    const files = await Promise.all(
      names.map(async (n) => {
        const full = path.join(AUDIO_CACHE_DIR, n);
        const s = await fs.promises.stat(full);
        return { full, size: s.size, used: s.mtimeMs };
      })
    );
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= AUDIO_CACHE_MAX_BYTES) return;
    // Trim to 90% so this doesn't run after every single new song
    for (const f of files.sort((a, b) => a.used - b.used)) {
      if (total <= AUDIO_CACHE_MAX_BYTES * 0.9) break;
      await fs.promises.unlink(f.full).catch(() => {});
      total -= f.size;
    }
  } catch (err) {
    console.warn('Audio cache cleanup failed:', err);
  } finally {
    pruning = false;
  }
}
const PLAY_HISTORY_FILE = path.join(DATA_DIR, 'play_history.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const BANNED_SONGS_FILE = path.join(DATA_DIR, 'banned_songs.json');

interface GeminiConfig {
  apiKey: string;
  model: string;
}

/** Detects Gemini API key from process.env or .env file */
function getGeminiConfig(): GeminiConfig | null {
  let apiKey = (process.env.GEMINI_API_KEY || '').trim();
  let model = (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.5-flash-lite';

  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const keyMatch = content.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
      if (keyMatch) {
        apiKey = keyMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
      const modelMatch = content.match(/^\s*GEMINI_MODEL\s*=\s*([^\r\n#]+)/m);
      if (modelMatch) {
        model = modelMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // ignore read error
    }
  }

  if (!apiKey || apiKey.startsWith('YOUR_GEMINI')) return null;
  return { apiKey, model };
}

/** One JSON-mode completion from Google Gemini API (cloud backup, ~300ms latency). */
async function geminiGenerate(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const cfg = getGeminiConfig();
  if (!cfg) throw new Error('GEMINI_API_KEY not configured');

  const modelsToTry = [cfg.model, 'gemini-3.5-flash-lite', 'gemini-3.5-flash'].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  let lastError: Error | null = null;
  for (const model of modelsToTry) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        if (resp.status === 404 && model !== modelsToTry[modelsToTry.length - 1]) {
          continue;
        }
        throw new Error(`Gemini (${model}) HTTP ${resp.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned empty response candidate');
      }
      return text;
    } catch (err: unknown) {
      lastError = err as Error;
      if ((err as Error)?.name === 'AbortError') throw err;
    }
  }

  throw lastError || new Error('Gemini generation failed');
}

interface SearchResult {
  title: string;
  url: string;
  author: string;
  duration: number; // in seconds
  thumbnail: string;
  timestamp: string;
  highlightTime?: number;
  highlightIntensity?: number;
}

/**
 * Extracts the 11-character video ID from any YouTube / YouTube Music link
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/, with or without https://).
 */
function extractYouTubeVideoId(input: string): string | null {
  const match = input.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Scrapes YouTube audience replay heatmap to extract the world's most liked / replayed moment.
 * Only ever fetches youtube.com, built from a validated video ID.
 */
async function extractYouTubeHeatmap(videoId: string): Promise<{ peakSeconds: number; intensity: number } | null> {
  try {
    const res = await fetch(canonicalYouTubeUrl(videoId), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    const regex = /\{"startMillis":"(\d+)","durationMillis":"(\d+)","intensityScoreNormalized":([\d\.]+)\}/g;
    let match;
    let maxOverall = -1;
    let peakOverallStart = 0;
    let maxMusical = -1;
    let peakMusicalStart = 0;
    let count = 0;

    while ((match = regex.exec(html)) !== null) {
      count++;
      const startMs = parseInt(match[1], 10);
      const intensity = parseFloat(match[3]);

      if (intensity > maxOverall) {
        maxOverall = intensity;
        peakOverallStart = startMs;
      }

      // Ignore first 15 seconds to avoid video-start skew
      if (startMs >= 15000 && intensity > maxMusical) {
        maxMusical = intensity;
        peakMusicalStart = startMs;
      }
    }

    if (count > 0) {
      const selectedStart = (peakMusicalStart > 0 && maxMusical > 0.35)
        ? peakMusicalStart
        : peakOverallStart;
      const intensity = (peakMusicalStart > 0 && maxMusical > 0.35)
        ? maxMusical
        : maxOverall;

      return {
        peakSeconds: Math.round((selectedStart / 1000) * 10) / 10,
        intensity: Math.min(1.0, Math.round(intensity * 100) / 100),
      };
    }
  } catch (err) {
    console.error('Heatmap scrape error:', err);
  }
  return null;
}

export function aiDjApiPlugin(): Plugin {
  const ytdl = new Ytdl();
  let wss: WebSocketServer | null = null;

  // Remote-control hub. One laptop tab is the host: it owns the audio, publishes SYNC_STATE
  // and runs commands. Phones are remotes. Any other full-app tab waits as a standby host,
  // so a second tab can't flood the phones with its own empty state or run every command twice.
  let host: WebSocket | null = null;
  const standbyHosts: WebSocket[] = [];
  const remotes = new Set<WebSocket>();
  let lastHostState: string | null = null; // sent to a phone as soon as it connects
  const alive = new WeakMap<WebSocket, boolean>();

  const send = (ws: WebSocket, msg: string | object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  };
  const sendToRemotes = (msg: string | object) => {
    for (const r of remotes) send(r, msg);
  };
  const hostGone = () => {
    host = null;
    lastHostState = null;
    // Hand over to the oldest waiting tab; the phones get its state once it starts publishing
    let next = standbyHosts.shift();
    while (next && next.readyState !== WebSocket.OPEN) next = standbyHosts.shift();
    if (next) {
      host = next;
      send(next, { type: 'ROLE', role: 'host' });
    } else {
      sendToRemotes({ type: 'HOST_GONE' });
    }
  };

  return {
    name: 'ai-dj-api-plugin',
    configureServer(server) {
      if (!server.httpServer) return;

      // Initialize WebSocket Server on existing HTTP server at path /ws
      wss = new WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url === '/ws') {
          wss?.handleUpgrade(req, socket, head, (ws) => {
            wss?.emit('connection', ws, req);
          });
        }
      });

      wss.on('connection', (ws) => {
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));

        ws.on('message', (message) => {
          const text = message.toString();
          let data: { type?: string; role?: string };
          try {
            data = JSON.parse(text);
          } catch {
            return;
          }

          if (data.type === 'HELLO') {
            if (data.role === 'host') {
              if (!host || host.readyState !== WebSocket.OPEN) {
                host = ws;
                send(ws, { type: 'ROLE', role: 'host' });
              } else {
                standbyHosts.push(ws);
                send(ws, { type: 'ROLE', role: 'standby' });
              }
            } else {
              remotes.add(ws);
              send(ws, lastHostState ?? { type: 'HOST_GONE' });
            }
          } else if (data.type === 'SYNC_STATE') {
            if (ws === host) {
              lastHostState = text;
              sendToRemotes(text);
            }
          } else if (data.type?.startsWith('CMD_')) {
            if (host && ws !== host) send(host, text);
          }
        });

        ws.on('close', () => {
          remotes.delete(ws);
          const i = standbyHosts.indexOf(ws);
          if (i >= 0) standbyHosts.splice(i, 1);
          if (ws === host) hostGone();
        });
      });

      // A sleeping laptop or a phone that left the Wi-Fi never sends a close; ping to notice
      const heartbeat = setInterval(() => {
        for (const ws of wss?.clients ?? []) {
          if (!alive.get(ws)) {
            ws.terminate();
            continue;
          }
          alive.set(ws, false);
          ws.ping();
        }
      }, 15_000);
      server.httpServer.on('close', () => clearInterval(heartbeat));

      // REST Endpoints Middleware
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);

        // 1. Search Song or Parse YouTube Link
        if (url.pathname === '/api/search') {
          const query = url.searchParams.get('q');
          if (!query) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Query parameter q is required' }));
            return;
          }

          try {
            res.setHeader('Content-Type', 'application/json');

            // Check if query is already a YouTube/YouTube Music URL
            const videoId = extractYouTubeVideoId(query);

            if (videoId) {
              const cleanUrl = canonicalYouTubeUrl(videoId);
              const [info, heatmap] = await Promise.all([
                ytdl.getInfo(cleanUrl),
                extractYouTubeHeatmap(videoId),
              ]);

              const result: SearchResult = {
                title: info.videoDetails.title,
                url: cleanUrl,
                author: info.videoDetails.author.name,
                duration: Number(info.videoDetails.lengthSeconds) || 180,
                thumbnail: info.videoDetails.thumbnails[0]?.url || '',
                timestamp: formatDuration(Number(info.videoDetails.lengthSeconds) || 180),
                highlightTime: heatmap?.peakSeconds,
                highlightIntensity: heatmap?.intensity,
              };
              res.end(JSON.stringify({ results: [result] }));
              return;
            }

            // Otherwise, perform title search using yt-search
            const limit = Math.min(10, Math.max(1, Number(url.searchParams.get('limit')) || 6));
            const searchResults = await ytSearch(query);
            const videos: SearchResult[] = (searchResults.videos || []).slice(0, limit).map((v: { title: string; url: string; author: { name: string }; seconds: number; thumbnail: string; timestamp: string }) => ({
              title: v.title,
              url: v.url,
              author: v.author?.name || 'Unknown Artist',
              duration: v.seconds || 180,
              thumbnail: v.thumbnail || '',
              timestamp: v.timestamp || '',
            }));

            // The client plays the top result, so give it the "most replayed" hook too
            const topId = videos[0] ? extractYouTubeVideoId(videos[0].url) : null;
            if (topId) {
              const heatmap = await extractYouTubeHeatmap(topId);
              videos[0].highlightTime = heatmap?.peakSeconds;
              videos[0].highlightIntensity = heatmap?.intensity;
            }

            res.end(JSON.stringify({ results: videos }));
          } catch (err: unknown) {
            console.error('Search error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Search failed', details: String(err) }));
          }
          return;
        }

        // 1b. Inspect disk audio cache status (cache/audio)
        if (url.pathname === '/api/cache/status') {
          res.setHeader('Content-Type', 'application/json');
          try {
            await fs.promises.mkdir(AUDIO_CACHE_DIR, { recursive: true });
            const names = (await fs.promises.readdir(AUDIO_CACHE_DIR)).filter((n) => n.endsWith('.audio'));
            const files = await Promise.all(
              names.map(async (n) => {
                const s = await fs.promises.stat(path.join(AUDIO_CACHE_DIR, n));
                return { videoId: n.replace(/\.audio$/, ''), size: s.size, mtime: s.mtimeMs };
              })
            );
            const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
            res.end(
              JSON.stringify({
                cacheDir: 'cache/audio',
                count: files.length,
                totalBytes,
                totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
                maxMb: Math.round(AUDIO_CACHE_MAX_BYTES / (1024 * 1024)),
              })
            );
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to inspect cache', details: String(err) }));
          }
          return;
        }

        // 2. Stream Audio Bytes
        if (url.pathname === '/api/stream') {
          const videoId = extractYouTubeVideoId(url.searchParams.get('url') || '');
          if (!videoId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'A valid YouTube url parameter is required' }));
            return;
          }

          try {
            res.setHeader('Content-Type', 'audio/mp4');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'no-cache');

            // Already on disk: serve it (instant, works offline) and mark it recently used
            const cachedFile = cachedAudioPath(videoId);
            const cached = await fs.promises.stat(cachedFile).catch(() => null);
            if (cached?.isFile()) {
              const now = new Date();
              fs.promises.utimes(cachedFile, now, now).catch(() => {});
              res.setHeader('Content-Length', String(cached.size));
              res.setHeader('X-Audio-Cache', 'hit');
              fs.createReadStream(cachedFile).pipe(res);
              return;
            }
            res.setHeader('X-Audio-Cache', 'miss');

            // Download audio stream using ytdl
            const stream = ytdl.download(canonicalYouTubeUrl(videoId), {
              filter: { hasAudio: true, hasVideo: false },
              quality: 'highestaudio',
            });

            // Save a copy while streaming. It is written under a temporary name and only
            // renamed into the cache once complete, so a broken download is never kept.
            await fs.promises.mkdir(AUDIO_CACHE_DIR, { recursive: true });
            const partFile = `${cachedFile}.${process.pid}-${Date.now()}.part`;
            const file = fs.createWriteStream(partFile);
            let downloaded = false;
            let failed = false;
            const discardPart = () => {
              file.destroy();
              fs.promises.unlink(partFile).catch(() => {});
            };
            stream.on('end', () => {
              downloaded = !failed;
            });
            file.on('finish', () => {
              if (!downloaded) return discardPart();
              fs.promises
                .rename(partFile, cachedFile)
                .then(() => pruneAudioCache())
                .catch(() => discardPart());
            });
            file.on('error', (err) => {
              console.warn('Could not save audio to the cache:', err);
              failed = true;
              discardPart();
            });

            // Stop downloading if the browser goes away (tab closed, page reloaded)
            res.on('close', () => {
              if (!downloaded) {
                failed = true;
                stream.destroy();
                discardPart();
              }
            });

            stream.on('error', (streamErr) => {
              console.error('Audio stream error:', streamErr);
              failed = true;
              discardPart();
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Stream error', details: String(streamErr) }));
              }
            });

            stream.pipe(res);
            stream.pipe(file);
          } catch (err: unknown) {
            console.error('Stream setup error:', err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Stream setup failed', details: String(err) }));
            }
          }
          return;
        }

        // 3. Autonomous Recommendations Based on Current Song
        if (url.pathname === '/api/recommend') {
          const currentTitle = url.searchParams.get('title') || 'Bollywood Punjabi Party';
          const artist = url.searchParams.get('artist') || '';
          const mood = url.searchParams.get('mood') || 'normal';

          try {
            res.setHeader('Content-Type', 'application/json');

            // Get curated recommendations using Ollama or genre intelligence (10-12 suggestions)
            const queries = await generateRelatedSongQueries(currentTitle, artist, mood);

            // Run YouTube searches in parallel for speed
            const searchPromises = queries.map(async (q) => {
              try {
                const searchRes = await ytSearch(q);
                if (searchRes.videos && searchRes.videos.length > 0) {
                  return searchRes.videos
                    .filter((v) => !v.seconds || v.seconds <= 300)
                    .slice(0, 2)
                    .map((v) => ({
                      title: v.title,
                      url: v.url,
                      author: v.author?.name || 'Artist',
                      duration: v.seconds || 180,
                      thumbnail: v.thumbnail || '',
                      timestamp: v.timestamp || '',
                    }));
                }
              } catch {
                return [];
              }
              return [];
            });

            let bannedKeys = new Set<string>();
            try {
              if (fs.existsSync(BANNED_SONGS_FILE)) {
                const bannedData = JSON.parse(fs.readFileSync(BANNED_SONGS_FILE, 'utf-8') || '[]');
                for (const b of bannedData) {
                  if (b.url) bannedKeys.add(b.url.toLowerCase());
                  if (b.title) bannedKeys.add(b.title.toLowerCase());
                }
              }
            } catch {}

            const settled = await Promise.all(searchPromises);
            const rawRecommendations = settled.flat();
            const seen = new Set<string>();
            const recommendations: SearchResult[] = [];
            for (const r of rawRecommendations) {
              if (r.duration && r.duration > 300) continue;
              const key = (r.url || r.title).toLowerCase();
              if (bannedKeys.has(key) || (r.title && bannedKeys.has(r.title.toLowerCase()))) continue;
              if (!seen.has(key)) {
                seen.add(key);
                recommendations.push(r);
              }
            }

            res.end(JSON.stringify({ recommendations }));
          } catch (err) {
            console.error('Recommendation error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Recommendation failed', details: String(err) }));
          }
          return;
        }

        // Phone remote links: the laptop's Wi-Fi addresses, since "localhost" in its address bar means nothing to a phone
        if (url.pathname === '/api/remote-info') {
          const address = server.httpServer?.address();
          const port = address && typeof address === 'object' ? address.port : 5173;
          // Home Wi-Fi ranges first; 172.x is usually a WSL/Hyper-V/Docker adapter
          const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
          const ips = Object.values(os.networkInterfaces())
            .flat()
            .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
            .map((i) => i!.address)
            .sort((a, b) => rank(a) - rank(b));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ urls: ips.map((ip) => `http://${ip}:${port}/?remote=true`) }));
          return;
        }

        // 3b. AI Brain Proxy: Local Ollama (1st preference) with Google Gemini Cloud (2nd preference backup).
        // Going through the server avoids browser CORS limits, keeps secrets server-side, and works from any device.
        if (url.pathname === '/api/llm/health') {
          res.setHeader('Content-Type', 'application/json');
          const geminiCfg = getGeminiConfig();
          let ollamaOnline = false;
          try {
            const tags = await (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })).json();
            ollamaOnline = (tags.models || []).some((m: { name: string }) => m.name.startsWith(OLLAMA_MODEL));
            if (ollamaOnline && !ollamaWarmed) {
              ollamaWarmed = true;
              fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: OLLAMA_KEEP_ALIVE }),
              }).catch(() => {
                ollamaWarmed = false;
              });
            }
          } catch {
            ollamaOnline = false;
          }

          const hasAny = Boolean(ollamaOnline || geminiCfg);
          // 1st preference: Local Ollama. 2nd preference: Google Gemini cloud backup.
          const activeProvider = ollamaOnline ? 'ollama' : geminiCfg ? 'gemini' : 'none';
          const activeModel = ollamaOnline ? OLLAMA_MODEL : geminiCfg ? geminiCfg.model : null;

          res.end(
            JSON.stringify({
              online: hasAny,
              provider: activeProvider,
              model: activeModel,
              preference: {
                primary: 'ollama',
                secondary: 'gemini',
              },
              gemini: {
                configured: Boolean(geminiCfg),
                model: geminiCfg?.model || null,
              },
              ollama: {
                online: ollamaOnline,
                model: ollamaOnline ? OLLAMA_MODEL : null,
              },
            })
          );
          return;
        }

        if (url.pathname === '/api/llm' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          try {
            const body = await parseJsonBody(req);
            const maxTokens = Math.min(400, Math.max(16, Number(body?.maxTokens) || 150));
            const timeoutMs = Math.min(60_000, Math.max(2000, Number(body?.timeoutMs) || 20_000));
            const started = Date.now();
            const geminiCfg = getGeminiConfig();

            // 1. First preference: Local Ollama (Qwen 2.5 3B)
            try {
              // If Gemini is available as backup, cap Ollama at 12s so it fails over quickly instead of hanging
              const ollamaTimeout = geminiCfg ? Math.min(12_000, timeoutMs) : timeoutMs;
              const schema = body?.schema && typeof body.schema === 'object' ? body.schema : undefined;
              const response = await ollamaGenerate(String(body?.prompt ?? ''), maxTokens, ollamaTimeout, schema);
              res.end(
                JSON.stringify({
                  response,
                  latencyMs: Date.now() - started,
                  provider: 'ollama',
                  model: OLLAMA_MODEL,
                })
              );
              return;
            } catch (ollamaErr) {
              console.warn(
                'Ollama (1st preference) failed or offline, falling back to 2nd preference (Gemini):',
                (ollamaErr as Error)?.message || ollamaErr
              );
            }

            // 2. Second preference: Google Gemini Cloud (~300ms latency backup)
            if (geminiCfg) {
              try {
                const geminiTimeout = Math.min(10_000, timeoutMs);
                const response = await geminiGenerate(String(body?.prompt ?? ''), maxTokens, geminiTimeout);
                res.end(
                  JSON.stringify({
                    response,
                    latencyMs: Date.now() - started,
                    provider: 'gemini',
                    model: geminiCfg.model,
                  })
                );
                return;
              } catch (geminiErr) {
                console.warn(
                  'Gemini (2nd preference) also failed:',
                  (geminiErr as Error)?.message || geminiErr
                );
              }
            }

            throw new Error('Both Ollama (1st preference) and Gemini (2nd preference) failed or were unavailable');
          } catch (err) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'LLM unavailable (Ollama & Gemini both failed)', details: String(err) }));
          }
          return;
        }

        // 4. Query YouTube Audience Replay Heatmap for any URL
        if (url.pathname === '/api/heatmap') {
          const videoId = extractYouTubeVideoId(url.searchParams.get('url') || '');
          if (!videoId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'A valid YouTube url parameter is required' }));
            return;
          }

          try {
            res.setHeader('Content-Type', 'application/json');
            const heatmap = await extractYouTubeHeatmap(videoId);
            res.end(JSON.stringify({ heatmap }));
          } catch (err) {
            console.error('Heatmap query error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Heatmap query failed', details: String(err) }));
          }
          return;
        }

        // 5. Most Played Song History (GET /api/history & POST /api/history)
        if (url.pathname === '/api/history') {
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'GET') {
            try {
              if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
              }
              if (!fs.existsSync(PLAY_HISTORY_FILE)) {
                fs.writeFileSync(PLAY_HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
              }
              const rawData = fs.readFileSync(PLAY_HISTORY_FILE, 'utf-8');
              const history = JSON.parse(rawData || '[]');
              // Sort descending by playCount, then by lastPlayed
              history.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
              res.end(JSON.stringify({ history }));
            } catch (err) {
              console.error('Error reading play history:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to read history', history: [] }));
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const body = await parseJsonBody(req);
              const song = body?.song;
              if (!song || (!song.id && !song.title)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid song object' }));
                return;
              }

              if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
              }

              let history: any[] = [];
              if (fs.existsSync(PLAY_HISTORY_FILE)) {
                try {
                  const rawData = fs.readFileSync(PLAY_HISTORY_FILE, 'utf-8');
                  history = JSON.parse(rawData || '[]');
                } catch {
                  history = [];
                }
              }

              // Find existing match by ID, URL, or normalized Title
              const normTitle = (song.title || '').trim().toLowerCase();
              const existingIdx = history.findIndex(
                (h: any) =>
                  (song.id && h.id === song.id) ||
                  (song.url && h.url && h.url === song.url) ||
                  (normTitle && h.title && h.title.trim().toLowerCase() === normTitle)
              );

              const now = Date.now();
              if (existingIdx !== -1) {
                history[existingIdx].playCount = (history[existingIdx].playCount || 0) + 1;
                history[existingIdx].lastPlayed = now;
                if (song.highlightTime !== undefined) history[existingIdx].highlightTime = song.highlightTime;
                if (song.thumbnail) history[existingIdx].thumbnail = song.thumbnail;
                if (song.url && !history[existingIdx].url) history[existingIdx].url = song.url;
              } else {
                history.push({
                  id: song.id || `hist_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  title: song.title,
                  artist: song.artist || 'Unknown Artist',
                  playCount: 1,
                  lastPlayed: now,
                  url: song.url,
                  thumbnail: song.thumbnail,
                  duration: song.duration,
                  highlightTime: song.highlightTime,
                });
              }

              // Sort descending by playCount
              history.sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0));

              // Persist locally to play_history.json
              fs.writeFileSync(PLAY_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
              res.end(JSON.stringify({ success: true, history }));
            } catch (err) {
              console.error('Error saving play history:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to update history' }));
            }
            return;
          }
        }

        // 6. User Favorites (GET /api/favorites & POST /api/favorites/toggle)
        if (url.pathname === '/api/favorites' || url.pathname === '/api/favorites/toggle') {
          res.setHeader('Content-Type', 'application/json');

          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          if (!fs.existsSync(FAVORITES_FILE)) {
            fs.writeFileSync(FAVORITES_FILE, JSON.stringify([], null, 2), 'utf-8');
          }

          if (req.method === 'GET') {
            try {
              const rawData = fs.readFileSync(FAVORITES_FILE, 'utf-8');
              const favorites = JSON.parse(rawData || '[]');
              if (Array.isArray(favorites)) {
                favorites.sort((a: any, b: any) => (b.addedAt || 0) - (a.addedAt || 0));
              }
              res.end(JSON.stringify({ favorites: Array.isArray(favorites) ? favorites : [] }));
            } catch (err) {
              console.error('Error reading favorites:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to read favorites', favorites: [] }));
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const body = await parseJsonBody(req);
              const song = body?.song;
              if (!song || (!song.id && !song.title && !song.url)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid song object' }));
                return;
              }

              let favorites: any[] = [];
              try {
                const rawData = fs.readFileSync(FAVORITES_FILE, 'utf-8');
                favorites = JSON.parse(rawData || '[]');
                if (!Array.isArray(favorites)) favorites = [];
              } catch {
                favorites = [];
              }

              const normTitle = (song.title || '').trim().toLowerCase();
              const existingIdx = favorites.findIndex(
                (f: any) =>
                  (song.id && f.id === song.id) ||
                  (song.url && f.url && f.url === song.url) ||
                  (normTitle && f.title && f.title.trim().toLowerCase() === normTitle)
              );

              let isFavorite = false;
              if (existingIdx !== -1) {
                // If it already exists, toggle off (remove)
                favorites.splice(existingIdx, 1);
                isFavorite = false;
              } else {
                // Add to favorites (newest first)
                const newFavorite = {
                  id: song.id || `fav_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  title: (song.title || 'Unknown Track').trim(),
                  artist: (song.artist || 'Unknown Artist').trim(),
                  url: song.url,
                  thumbnail: song.thumbnail,
                  duration: song.duration ? Math.round(song.duration) : undefined,
                  bpm: song.bpm ? Math.round(song.bpm) : undefined,
                  highlightTime: song.highlightTime,
                  addedAt: Date.now(),
                };
                favorites.unshift(newFavorite);
                isFavorite = true;
              }

              // Persist locally to data/favorites.json
              fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2), 'utf-8');
              res.end(JSON.stringify({ success: true, isFavorite, favorites }));
            } catch (err) {
              console.error('Error updating favorites:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to update favorites' }));
            }
            return;
          }
        }

        // 6b. Banned Songs / "Don't Play Again Ever" (GET /api/banned & POST /api/banned/toggle)
        if (url.pathname === '/api/banned' || url.pathname === '/api/banned/toggle') {
          res.setHeader('Content-Type', 'application/json');

          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          if (!fs.existsSync(BANNED_SONGS_FILE)) {
            fs.writeFileSync(BANNED_SONGS_FILE, JSON.stringify([], null, 2), 'utf-8');
          }

          if (req.method === 'GET') {
            try {
              const rawData = fs.readFileSync(BANNED_SONGS_FILE, 'utf-8');
              const banned = JSON.parse(rawData || '[]');
              if (Array.isArray(banned)) {
                banned.sort((a: any, b: any) => (b.bannedAt || 0) - (a.bannedAt || 0));
              }
              res.end(JSON.stringify({ banned: Array.isArray(banned) ? banned : [] }));
            } catch (err) {
              console.error('Error reading banned songs:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to read banned songs', banned: [] }));
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const body = await parseJsonBody(req);
              const song = body?.song;
              if (!song || (!song.id && !song.title && !song.url)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid song object' }));
                return;
              }

              let banned: any[] = [];
              try {
                const rawData = fs.readFileSync(BANNED_SONGS_FILE, 'utf-8');
                banned = JSON.parse(rawData || '[]');
                if (!Array.isArray(banned)) banned = [];
              } catch {
                banned = [];
              }

              const normTitle = (song.title || '').trim().toLowerCase();
              const existingIdx = banned.findIndex(
                (b: any) =>
                  (song.id && b.id === song.id) ||
                  (song.url && b.url && b.url === song.url) ||
                  (normTitle && b.title && b.title.trim().toLowerCase() === normTitle)
              );

              let isBanned = false;
              if (existingIdx !== -1) {
                // If already banned, toggle off (unban)
                banned.splice(existingIdx, 1);
                isBanned = false;
              } else {
                // Add to banned songs (newest first)
                const newBanned = {
                  id: song.id || `banned_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  title: (song.title || 'Unknown Track').trim(),
                  artist: (song.artist || 'Unknown Artist').trim(),
                  url: song.url,
                  thumbnail: song.thumbnail,
                  duration: song.duration ? Math.round(song.duration) : undefined,
                  bannedAt: Date.now(),
                };
                banned.unshift(newBanned);
                isBanned = true;
              }

              fs.writeFileSync(BANNED_SONGS_FILE, JSON.stringify(banned, null, 2), 'utf-8');
              res.end(JSON.stringify({ success: true, isBanned, banned }));
            } catch (err) {
              console.error('Error updating banned songs:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to update banned songs' }));
            }
            return;
          }
        }

        // 6. User Custom Song List (GET /api/my-songs & POST /api/my-songs)
        if (url.pathname === '/api/my-songs') {
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'GET') {
            try {
              if (!fs.existsSync(MY_SONGS_FILE)) {
                const starterContent = `# ==============================================================================
# AI DJ — MY CUSTOM SONG LIST & PARTY PLAYLIST
# ==============================================================================
# Add any song you want the AI DJ to know about and play!
# 
# FORMAT:
# - Write one song per line.
# - You can write Song Names (e.g., "Sidhu Moose Wala - 295")
# - Or paste YouTube / YouTube Music links (e.g., "https://www.youtube.com/watch?v=kJQP7kiw5Fk")
# - Lines starting with '#' are comments and ignored.
# ==============================================================================

Sidhu Moose Wala - 295
Diljit Dosanjh - Lover
AP Dhillon - Brown Munde
Karan Aujla - Softly
Badshah - Kar Gayi Chull
`;
                fs.writeFileSync(MY_SONGS_FILE, starterContent, 'utf-8');
              }

              const raw = fs.readFileSync(MY_SONGS_FILE, 'utf-8');
              const lines = raw.split(/\r?\n/);
              const songs: string[] = [];

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
                  songs.push(trimmed);
                }
              }

              res.end(JSON.stringify({ songs, raw, total: songs.length }));
            } catch (err) {
              console.error('Error reading my_songs.txt:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to read my_songs.txt', songs: [] }));
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const body = await parseJsonBody(req);
              if (body?.content !== undefined) {
                // Overwrite full file
                fs.writeFileSync(MY_SONGS_FILE, body.content, 'utf-8');
              } else if (body?.song) {
                // Append single song line
                const songLine = `\n${String(body.song).trim()}\n`;
                fs.appendFileSync(MY_SONGS_FILE, songLine, 'utf-8');
              }

              const raw = fs.readFileSync(MY_SONGS_FILE, 'utf-8');
              const songs = raw
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

              res.end(JSON.stringify({ success: true, songs, total: songs.length }));
            } catch (err) {
              console.error('Error modifying my_songs.txt:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to update my_songs.txt' }));
            }
            return;
          }
        }

        next();
      });
    },
  };
}

/**
 * Suggests 5 stylistically and energetically compatible song queries
 * using local Ollama if available, with intelligent fallback heuristics.
 */
const MOOD_PROMPTS: Record<string, string> = {
  normal: 'a relaxed house party; mix of popular songs',
  party: 'a high-energy dance party; upbeat, well-known bangers',
  bhangra: 'a Punjabi bhangra / wedding dance floor; dhol-heavy, high energy',
  chill: 'a chill, laid-back evening; mellow, smooth, low-tempo songs',
  romantic: 'a romantic, slow-dance mood; love songs and soft melodies',
};

const MOOD_FALLBACK_SONGS: Record<string, string[]> = {
  party: [
    'Sidhu Moose Wala 295',
    'Diljit Dosanjh Lover',
    'AP Dhillon Brown Munde',
    'Shubh Baller',
    'Karan Aujla Softly',
    'Mankirt Aulakh Badnam',
    'Badshah Kar Gayi Chull',
    'Guru Randhawa High Rated Gabru',
    'Mika Singh Subha Hone Na De',
    'Yo Yo Honey Singh Dope Shope',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh GOAT',
    'Sidhu Moose Wala Same Beef',
    'Shubh Cheques',
    'Yo Yo Honey Singh Blue Eyes',
    'Simmba Aankh Marey',
    'War Jai Jai Shivshankar',
    'Diljit Dosanjh Born to Shine',
    'Badshah Kala Chashma',
    'Arijit Singh Ghungroo Party Mix',
    'Guru Randhawa Lahore',
    'Fisher Losing It',
    'Calvin Harris One Kiss',
    'David Guetta Titanium',
    'Tiësto The Business',
    'Mau P Drugs From Amsterdam',
    'Swedish House Mafia Moth To A Flame',
    'Acraze Do It To It',
    'Peggy Gou Nanana',
    'The Weeknd Blinding Lights',
  ],
  normal: [
    'Diljit Dosanjh Lover',
    'Sidhu Moose Wala 295',
    'AP Dhillon Brown Munde',
    'Karan Aujla Softly',
    'Shubh Cheques',
    'Badshah Kar Gayi Chull',
    'Guru Randhawa High Rated Gabru',
    'Yo Yo Honey Singh Blue Eyes',
    'Mika Singh Subha Hone Na De',
    'Mankirt Aulakh Badnam',
    'Arijit Singh Ghungroo',
    'Diljit Dosanjh GOAT',
    'Shubh Baller',
    'Karan Aujla Tauba Tauba',
    'War Jai Jai Shivshankar',
    'Simmba Aankh Marey',
    'Badshah Kala Chashma',
    'Yo Yo Honey Singh Dope Shope',
    'The Weeknd Blinding Lights',
    'Dua Lipa Levitating',
    'David Guetta Titanium',
    'Calvin Harris One Kiss',
    'Fisher Losing It',
    'Tiësto The Business',
    'AP Dhillon Excuses',
  ],
  chill: [
    'Prateek Kuhad Kasoor',
    'AP Dhillon Excuses',
    'Anuv Jain Baarishein',
    'Arijit Singh Kesariya',
    'The Local Train Choo Lo',
    'Zaeden tere bina',
    'Twin Strings Dhaldha Chand',
    'Jasleen Royal Kho Gaye Hum Kahan',
    'Lucky Ali O Sanam',
    'Prateek Kuhad cold/mess',
    'Anuv Jain Alag Aasmaan',
    'Bayaan Din Dhalay',
    'Lifafa Nikamma',
    'When Chai Met Toast When We Feel Young',
    'Mohit Chauhan Phir Se Ud Chala',
    'Atif Aslam Aadat Acoustic',
    'Arijit Singh Safar',
    'Armaan Malik Ghar Se Nikalte Hi',
    'The Local Train Aaoge Tum Kabhi',
    'Anuv Jain Husn',
    'Mitraz Akhiyaan',
    'Prateek Kuhad Kho Gaye Hum Kahan',
    'Lucky Ali Safarnama',
    'Strings Duur',
    'Silk Route Dooba Dooba',
  ],
  romantic: [
    'Arijit Singh Tum Hi Ho',
    'Atif Aslam Tera Hone Laga Hoon',
    'Jubin Nautiyal Raataan Lambiyan',
    'B Praak Mann Bharrya',
    'Diljit Dosanjh Lover',
    'Arijit Singh Apna Bana Le',
    'Mohit Chauhan Tum Se Hi',
    'Shreya Ghoshal Sun Raha Hai',
    'Atif Aslam Jeene Laga Hoon',
    'Arijit Singh Hawayein',
    'Pritam Shayad',
    'Armaan Malik Bol Do Na Zara',
    'Arijit Singh Raabta',
    'Atif Aslam Pehli Dafa',
    'Mohit Chauhan Pee Loon',
    'Rahat Fateh Ali Khan O Re Piya',
    'Sonu Nigam Abhi Mujh Mein Kahin',
    'Arijit Singh Mast Magan',
    'Shreya Ghoshal Saibo',
    'Kailash Kher Teri Deewani',
    'KK Aankhon Mein Teri',
    'Atif Aslam Tu Jaane Na',
    'Arijit Singh Enna Sona',
    'Pritam Subhanallah',
    'Darshan Raval Chogada',
  ],
  bhangra: [
    'Diljit Dosanjh Lover',
    'AP Dhillon Brown Munde',
    'Karan Aujla Softly',
    'Sidhu Moose Wala Same Beef',
    'Shubh Cheques',
    'Mankirt Aulakh Badnam',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh GOAT',
    'Sidhu Moose Wala 295',
    'Shubh Baller',
    'Guru Randhawa High Rated Gabru',
    'Badshah Jugnu',
    'Diljit Dosanjh Born to Shine',
    'Sidhu Moose Wala So High',
    'Karan Aujla Chitta Kurta',
    'Shubh No Love',
    'AP Dhillon With You',
    'Mickey Singh Phone',
    'Imran Khan Amplifier',
    'Panjabi MC Mundian To Bach Ke',
    'Daler Mehndi Bolo Tara Rara',
    'Bally Sagoo Gur Nalon Ishq Mitha',
    'Surjit Bindrakhia Tera Yaar Bolda',
    'Jazzy B Dil Luteya',
    'Yo Yo Honey Singh Angreji Beat',
    'Garry Sandhu Illegal Weapon',
    'Amrit Maan Bamb Jatt',
    'Jordan Sandhu Teeje Week',
  ],
};

async function generateRelatedSongQueries(currentTitle: string, artist: string, mood: string = 'normal'): Promise<string[]> {
  const combined = `${currentTitle} ${artist}`.toLowerCase();
  const moodDescription = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS.normal;

  // Try local Ollama first for creative curation
  try {
    const prompt = `You are a professional club/party AI DJ.
CURRENT PLAYING SONG: "${currentTitle}" by "${artist}".
THE MOOD OF THE PARTY: ${moodDescription}.
Suggest exactly 25 to 30 songs that fit this mood and are musically, culturally, and energetically compatible to play NEXT in the DJ set.
Return a STRICT JSON object with key "suggestions" containing an array of 25-30 song titles with artists.
Example: { "suggestions": ["Diljit Dosanjh - Lover", "Sidhu Moose Wala - 295", "AP Dhillon - Brown Munde", "Karan Aujla - Softly", "Badshah - Jugnu", "Shubh - Cheques", "Yo Yo Honey Singh - Blue Eyes", "Guru Randhawa - High Rated Gabru", "Mika Singh - Subha Hone Na De", "Arijit Singh - Ghungroo"] }
Output ONLY valid JSON.`;

    // Runs in the background, so give the CPU model time: ~4 s warm, up to ~12 s cold.
    const parsed = JSON.parse(await ollamaGenerate(prompt, 200, 20_000));
    if (Array.isArray(parsed.suggestions) && parsed.suggestions.length >= 3) {
      return parsed.suggestions.slice(0, 30);
    }
  } catch {
    // Fall back to party graph heuristics
  }

  // Heuristic Party Graph: the mood decides first, then the current song's style
  if (MOOD_FALLBACK_SONGS[mood]) {
    return MOOD_FALLBACK_SONGS[mood];
  }
  if (
    combined.includes('moose') ||
    combined.includes('sidhu') ||
    combined.includes('punjabi') ||
    combined.includes('diljit') ||
    combined.includes('aujla') ||
    combined.includes('dhillon') ||
    combined.includes('desi') ||
    combined.includes('bhangra')
  ) {
    return [
      'Diljit Dosanjh Lover',
      'AP Dhillon Brown Munde',
      'Karan Aujla Softly',
      'Sidhu Moose Wala Same Beef',
      'Shubh Cheques',
      'Mankirt Aulakh Badnam',
      'Karan Aujla Tauba Tauba',
      'Diljit Dosanjh GOAT',
      'Sidhu Moose Wala 295',
      'Shubh Baller',
      'Guru Randhawa High Rated Gabru',
      'Badshah Jugnu',
    ];
  }

  if (combined.includes('house') || combined.includes('techno') || combined.includes('club') || combined.includes('remix')) {
    return [
      'Fisher Losing It',
      'Peggy Gou Nanana',
      'Calvin Harris One Kiss',
      'Mau P Drugs From Amsterdam',
      'Meduza Piece Of Your Heart',
      'Fred again.. adore u',
      'Tiësto The Business',
      'Swedish House Mafia Moth To A Flame',
      'David Guetta Titanium',
      'Acraze Do It To It',
      'John Summit Where You Are',
      'Dom Dolla Rhyme Dust',
    ];
  }

  // Default energetic Bollywood / Desi club bangers
  return [
    'Yo Yo Honey Singh Blue Eyes',
    'Badshah Kala Chashma',
    'Diljit Dosanjh GOAT',
    'Mika Singh Subha Hone Na De',
    'Arijit Singh Ghungroo Party Mix',
    'Badshah Kar Gayi Chull',
    'Yo Yo Honey Singh Dope Shope',
    'Guru Randhawa Lahore',
    'Simmba Aankh Marey',
    'War Jai Jai Shivshankar',
    'Karan Aujla Tauba Tauba',
    'Diljit Dosanjh Born to Shine',
  ];
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({ raw: data });
      }
    });
    req.on('error', () => {
      resolve({});
    });
  });
}
