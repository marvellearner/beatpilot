/** AI DJ brain proxy: local Ollama first, Google Gemini as the cloud backup. */
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { ROOT_DIR } from './paths';
import { parseJsonBody } from './http';

export const OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b';
export let OLLAMA_MODEL = (process.env.OLLAMA_MODEL || '').trim() || DEFAULT_OLLAMA_MODEL;
// Keep the model in RAM: a cold load takes ~2–5 s on this laptop, a warm answer ~1–3 s
export const OLLAMA_KEEP_ALIVE = '30m';

/**
 * One JSON-mode completion from the local model (CPU only, see SETUP_AND_OPERATIONS.md §2).
 * With a JSON schema the answer is constrained to it (e.g. one value from an enum), which a
 * small model needs for reliable classification; such answers also use temperature 0.
 */
// The CPU by default. The GTX 1050 works with driver 582.78 and generates 3x faster (23 vs 7
// tokens/s), but on this laptop Ollama re-checks the GPU on requests: ~6 s before each answer, and
// some requests hang or fail ("GPU discovery watchdog timed out"). A short decision took 0.4 s on
// the CPU and 6.8 s on the GPU, and this app only sends short ones (long song ideas go to Gemini).
// OLLAMA_GPU=1 in .env turns the GPU on; after GPU_FAILURES_TO_CPU failures in a row the CPU is
// then used for GPU_RETRY_AFTER_MS. Ollama not running at all ("fetch failed") isn't counted.
const gpuWanted = envFlag('OLLAMA_GPU');
let ollamaCpuUntil = 0;
let ollamaGpuFailures = 0;
const GPU_FAILURES_TO_CPU = 2;
const GPU_RETRY_AFTER_MS = 15 * 60_000;
// 99 = every layer on the GPU (it fits: 1.1 of 3 GB); 0 = CPU only
export const ollamaNumGpu = () => (gpuWanted && Date.now() >= ollamaCpuUntil ? 99 : 0);

/** A yes/no setting from the environment or the project's .env (Vite doesn't put .env in process.env). */
function envFlag(name: string): boolean {
  let value = process.env[name];
  if (value === undefined) {
    try {
      value = fs.readFileSync(path.join(ROOT_DIR, '.env'), 'utf-8').match(new RegExp(`^\\s*${name}\\s*=\\s*([^\\r\\n#]+)`, 'm'))?.[1];
    } catch {
      // no .env
    }
  }
  return /^(1|true|yes|on)$/i.test((value ?? '').trim());
}

export async function ollamaGenerate(prompt: string, maxTokens: number, timeoutMs: number, schema?: object, modelOverride?: string): Promise<string> {
  const modelToUse = modelOverride || OLLAMA_MODEL;
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: false,
        format: schema ?? 'json',
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: { num_gpu: ollamaNumGpu(), temperature: schema ? 0 : 0.2, num_predict: maxTokens, num_ctx: 2048 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = (await resp.json()) as { response?: string };
    ollamaGpuFailures = 0;
    return data.response ?? '';
  } catch (err) {
    const notRunning = /fetch failed|ECONNREFUSED/i.test(`${(err as Error)?.message} ${String((err as { cause?: unknown })?.cause ?? '')}`);
    if (!notRunning && ollamaNumGpu() > 0 && ++ollamaGpuFailures >= GPU_FAILURES_TO_CPU) {
      ollamaCpuUntil = Date.now() + GPU_RETRY_AFTER_MS;
      ollamaGpuFailures = 0;
      console.warn(`Ollama on the GPU failed ${GPU_FAILURES_TO_CPU} times in a row (${(err as Error)?.message}): using the CPU for ${GPU_RETRY_AFTER_MS / 60_000} min, then the GPU again.`);
    }
    throw err;
  }
}

export let ollamaWarmed = false;
export interface GeminiConfig {
  apiKey: string;
  model: string;
}

/** Detects Gemini API key from process.env or .env file */
export function getGeminiConfig(): GeminiConfig | null {
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

// Whether Gemini answers with this key and model: a models.get call (no tokens used), cached
// so the once-a-minute health checks don't call Google every time
export let geminiCheck: { key: string; at: number; online: boolean; error?: string } | null = null;
export const GEMINI_CHECK_TTL_MS = 5 * 60_000;

export async function checkGemini(cfg: GeminiConfig): Promise<{ online: boolean; error?: string }> {
  const key = `${cfg.model}|${cfg.apiKey.slice(-6)}`;
  if (geminiCheck && geminiCheck.key === key && Date.now() - geminiCheck.at < GEMINI_CHECK_TTL_MS) return geminiCheck;
  let online = false;
  let error: string | undefined;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}?key=${encodeURIComponent(cfg.apiKey)}`,
      { signal: AbortSignal.timeout(3000) }
    );
    online = resp.ok;
    if (!resp.ok) error = resp.status === 400 || resp.status === 403 ? 'API key rejected' : resp.status === 404 ? `model ${cfg.model} not found` : `HTTP ${resp.status}`;
  } catch (err) {
    error = (err as Error)?.name === 'TimeoutError' ? 'no response (offline?)' : 'unreachable (offline?)';
  }
  geminiCheck = { key, at: Date.now(), online, error };
  return geminiCheck;
}

// Real requests that failed for a reason that won't pass in seconds (quota used up, key rejected):
// Gemini counts as unavailable until then. The models.get check above uses no tokens, so it kept
// saying "online" (green light) while every real request failed with HTTP 429.
export let geminiBlock: { until: number; error: string } | null = null;
const GEMINI_QUOTA_COOLDOWN_MS = 15 * 60_000;
const GEMINI_KEY_COOLDOWN_MS = 60 * 60_000;

/** The wait Google asks for in a 429 answer ("retryDelay": "37s"), in ms. */
function retryDelayMs(errorText: string): number | null {
  const m = errorText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

/** Whether Gemini is held back after such a failure (and why). */
export function geminiBlocked(now = Date.now()): { until: number; error: string } | null {
  return geminiBlock && now < geminiBlock.until ? geminiBlock : null;
}

/** One JSON-mode completion from Google Gemini API (cloud backup, ~300ms latency). */
export async function geminiGenerate(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const cfg = getGeminiConfig();
  if (!cfg) throw new Error('GEMINI_API_KEY not configured');

  const modelsToTry = [cfg.model, 'gemini-3.5-flash-lite', 'gemini-3.5-flash'].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  const blocked = geminiBlocked();
  if (blocked) throw new Error(`Gemini held back until ${new Date(blocked.until).toLocaleTimeString()}: ${blocked.error}`);

  let lastError: Error | null = null;
  let quotaWait: number | null = null; // every model so far said "quota exceeded"
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
        if (resp.status === 429) {
          // Each model has its own quota: the next one may still answer
          quotaWait = Math.max(quotaWait ?? 0, retryDelayMs(errorText) ?? GEMINI_QUOTA_COOLDOWN_MS);
          lastError = new Error(`Gemini (${model}) HTTP 429: quota exceeded`);
          continue;
        }
        if (resp.status === 401 || resp.status === 403) {
          geminiBlock = { until: Date.now() + GEMINI_KEY_COOLDOWN_MS, error: 'API key rejected (HTTP ' + resp.status + ')' };
        }
        throw new Error(`Gemini (${model}) HTTP ${resp.status}: ${errorText.slice(0, 200)}`);
      }

      const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned empty response candidate');
      }
      geminiBlock = null; // it answers again
      return text;
    } catch (err: unknown) {
      lastError = err as Error;
      if ((err as Error)?.name === 'AbortError') throw err;
    }
  }

  if (quotaWait !== null && lastError?.message.includes('429')) {
    geminiBlock = { until: Date.now() + quotaWait, error: 'quota used up (HTTP 429): free tier limit reached' };
  }
  throw lastError || new Error('Gemini generation failed');
}

// 3b. AI Brain Proxy: Local Ollama (1st preference) with Google Gemini Cloud (2nd preference backup).
// Going through the server avoids browser CORS limits, keeps secrets server-side, and works from any device.
export async function handleLlmHealth(_req: IncomingMessage, res: ServerResponse, _url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  const geminiCfg = getGeminiConfig();
  let ollamaOnline = false;
  try {
    const tags = (await (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })).json()) as { models?: Array<{ name: string }> };
    const installed = (tags.models || []).map((m) => m.name);

    // Candidates in order of preference: configured env var, lightweight 1.5b (fast on CPU), 3b, 0.5b
    const candidates = [
      (process.env.OLLAMA_MODEL || '').trim(),
      'qwen2.5:1.5b',
      'qwen2.5:3b',
      'qwen2.5:0.5b',
      'qwen2.5',
    ].filter(Boolean);

    const matched = candidates.find((cand) => installed.some((m) => m === cand || m.startsWith(`${cand}:`) || m.startsWith(cand)));
    if (matched) {
      const full = installed.find((m) => m === matched || m.startsWith(`${matched}:`) || m.startsWith(matched));
      OLLAMA_MODEL = full || matched;
      ollamaOnline = true;
    } else {
      ollamaOnline = installed.some((m) => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL}:`) || m.startsWith(OLLAMA_MODEL));
    }

    if (ollamaOnline && !ollamaWarmed) {
      ollamaWarmed = true;
      fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        // Loaded where requests will run (a different GPU setting would load it a second time)
        body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_gpu: ollamaNumGpu() } }),
      }).catch(() => {
        ollamaWarmed = false;
      });
    }
  } catch {
    ollamaOnline = false;
  }

  const gemini = geminiCfg ? await checkGemini(geminiCfg) : null;
  // Reachable isn't enough: a real request that just failed on quota or the key counts too
  const held = geminiBlocked();
  const geminiOnline = Boolean(gemini?.online) && !held;
  const hasAny = ollamaOnline || geminiOnline;
  // 1st preference: Local Ollama. 2nd preference: Google Gemini cloud backup.
  const activeProvider = ollamaOnline ? 'ollama' : geminiOnline ? 'gemini' : 'none';
  const activeModel = ollamaOnline ? OLLAMA_MODEL : geminiOnline ? geminiCfg!.model : null;

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
        online: geminiOnline,
        model: geminiCfg?.model || null,
        error: held ? `${held.error}; tried again after ${new Date(held.until).toLocaleTimeString()}` : (gemini?.error ?? null),
      },
      ollama: {
        online: ollamaOnline,
        model: ollamaOnline ? OLLAMA_MODEL : null,
      },
    })
  );
  return;
}

export async function handleLlm(req: IncomingMessage, res: ServerResponse, _url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  try {
    const body = await parseJsonBody(req);
    const maxTokens = Math.min(400, Math.max(16, Number(body?.maxTokens) || 150));
    const timeoutMs = Math.min(60_000, Math.max(2000, Number(body?.timeoutMs) || 20_000));
    const started = Date.now();
    const geminiCfg = getGeminiConfig();

    // 1. First preference: Local Ollama (Qwen 2.5 1.5B / configured model)
    try {
      // With Gemini usable as backup, Ollama gets 12 s so a slow answer fails over quickly. Without
      // it (not set up, or held back after a quota error) there's nothing to fail over to: cutting
      // Ollama off then only wasted its work (every long answer "timed out" while Gemini was out of
      // quota). qwen2.5:1.5b on CPU: short answers 2-8 s, ~7 tokens/s for long ones.
      const geminiUsable = Boolean(geminiCfg) && !geminiBlocked();
      const ollamaTimeout = geminiUsable ? Math.min(12_000, timeoutMs) : timeoutMs;
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
      const timedOut = /timeout|aborted/i.test((ollamaErr as Error)?.message ?? '');
      console.warn(
        timedOut
          ? `Ollama (1st preference) was still answering after ${Math.round((Date.now() - started) / 1000)} s (${maxTokens}-token answer on CPU), trying Gemini`
          : 'Ollama (1st preference) failed or offline, falling back to 2nd preference (Gemini):',
        timedOut ? '' : (ollamaErr as Error)?.message || ollamaErr
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
