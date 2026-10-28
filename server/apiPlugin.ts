import { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { Ytdl } from '@distube/ytdl-core';
// @ts-expect-error yt-search has untyped default export
import ytSearch from 'yt-search';
import { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5:3b';
// Keep the model in RAM: a cold load takes ~3–12 s on this laptop, a warm answer ~4 s
const OLLAMA_KEEP_ALIVE = '30m';

/** One JSON-mode completion from the local model (CPU only, see SETUP_AND_OPERATIONS.md §2). */
async function ollamaGenerate(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: 'json',
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { num_gpu: 0, temperature: 0.2, num_predict: maxTokens },
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
const PLAY_HISTORY_FILE = path.join(DATA_DIR, 'play_history.json');

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
  const connectedClients = new Set<WebSocket>();

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
        connectedClients.add(ws);

        ws.on('message', (message) => {
          // Broadcast incoming message from one client (e.g. mobile) to all other clients (e.g. desktop host)
          const data = message.toString();
          for (const client of connectedClients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          }
        });

        ws.on('close', () => {
          connectedClients.delete(ws);
        });
      });

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
            const searchResults = await ytSearch(query);
            const videos: SearchResult[] = (searchResults.videos || []).slice(0, 5).map((v: { title: string; url: string; author: { name: string }; seconds: number; thumbnail: string; timestamp: string }) => ({
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

            // Download audio stream using ytdl
            const stream = ytdl.download(canonicalYouTubeUrl(videoId), {
              filter: { hasAudio: true, hasVideo: false },
              quality: 'highestaudio',
            });

            // Stop downloading if the browser goes away (tab closed, page reloaded)
            res.on('close', () => stream.destroy());

            stream.on('error', (streamErr) => {
              console.error('Audio stream error:', streamErr);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Stream error', details: String(streamErr) }));
              }
            });

            stream.pipe(res);
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
                  const v = searchRes.videos[0];
                  return {
                    title: v.title,
                    url: v.url,
                    author: v.author?.name || 'Artist',
                    duration: v.seconds || 180,
                    thumbnail: v.thumbnail || '',
                    timestamp: v.timestamp || '',
                  };
                }
              } catch {
                return null;
              }
              return null;
            });

            const settled = await Promise.all(searchPromises);
            const recommendations: SearchResult[] = settled.filter((r): r is SearchResult => r !== null);

            res.end(JSON.stringify({ recommendations }));
          } catch (err) {
            console.error('Recommendation error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Recommendation failed', details: String(err) }));
          }
          return;
        }

        // 3b. Local LLM (Ollama) proxy: status, and JSON completions for the AI DJ.
        // Going through the server avoids browser CORS limits and works from any device.
        if (url.pathname === '/api/llm/health') {
          res.setHeader('Content-Type', 'application/json');
          try {
            const tags = await (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })).json();
            const hasModel = (tags.models || []).some((m: { name: string }) => m.name.startsWith(OLLAMA_MODEL));
            if (hasModel && !ollamaWarmed) {
              ollamaWarmed = true;
              // Load the model into RAM now so the first DJ decision isn't a 12 s cold start
              fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: OLLAMA_KEEP_ALIVE }),
              }).catch(() => {
                ollamaWarmed = false;
              });
            }
            res.end(JSON.stringify({ online: hasModel, model: hasModel ? OLLAMA_MODEL : null }));
          } catch {
            ollamaWarmed = false;
            res.end(JSON.stringify({ online: false, model: null }));
          }
          return;
        }

        if (url.pathname === '/api/llm' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          try {
            const body = await parseJsonBody(req);
            const maxTokens = Math.min(400, Math.max(16, Number(body?.maxTokens) || 150));
            const timeoutMs = Math.min(60_000, Math.max(2000, Number(body?.timeoutMs) || 20_000));
            const started = Date.now();
            const response = await ollamaGenerate(String(body?.prompt ?? ''), maxTokens, timeoutMs);
            res.end(JSON.stringify({ response, latencyMs: Date.now() - started }));
          } catch (err) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'Local LLM unavailable', details: String(err) }));
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
Suggest exactly 10 to 12 songs that fit this mood and are musically, culturally, and energetically compatible to play NEXT in the DJ set.
Return a STRICT JSON object with key "suggestions" containing an array of 10-12 song titles with artists.
Example: { "suggestions": ["Diljit Dosanjh - Lover", "Sidhu Moose Wala - 295", "AP Dhillon - Brown Munde", "Karan Aujla - Softly", "Badshah - Jugnu", "Shubh - Cheques", "Yo Yo Honey Singh - Blue Eyes", "Guru Randhawa - High Rated Gabru", "Mika Singh - Subha Hone Na De", "Arijit Singh - Ghungroo"] }
Output ONLY valid JSON.`;

    // Runs in the background, so give the CPU model time: ~4 s warm, up to ~12 s cold.
    const parsed = JSON.parse(await ollamaGenerate(prompt, 120, 20_000));
    if (Array.isArray(parsed.suggestions) && parsed.suggestions.length >= 3) {
      return parsed.suggestions.slice(0, 12);
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
