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
export async function ollamaGenerate(prompt: string, maxTokens: number, timeoutMs: number, schema?: object, modelOverride?: string): Promise<string> {
  const modelToUse = modelOverride || OLLAMA_MODEL;
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelToUse,
      prompt,
      stream: false,
      format: schema ?? 'json',
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { num_gpu: 0, temperature: schema ? 0 : 0.2, num_predict: maxTokens, num_ctx: 2048 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
  const data = (await resp.json()) as { response?: string };
  return data.response ?? '';
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

/** One JSON-mode completion from Google Gemini API (cloud backup, ~300ms latency). */
export async function geminiGenerate(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
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

      const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
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

// 3b. AI Brain Proxy: Local Ollama (1st preference) with Google Gemini Cloud (2nd preference backup).
// Going through the server avoids browser CORS limits, keeps secrets server-side, and works from any device.
export async function handleLlmHealth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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
        body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: OLLAMA_KEEP_ALIVE }),
      }).catch(() => {
        ollamaWarmed = false;
      });
    }
  } catch {
    ollamaOnline = false;
  }

  const gemini = geminiCfg ? await checkGemini(geminiCfg) : null;
  const geminiOnline = Boolean(gemini?.online);
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
        error: gemini?.error ?? null,
      },
      ollama: {
        online: ollamaOnline,
        model: ollamaOnline ? OLLAMA_MODEL : null,
      },
    })
  );
  return;
}

export async function handleLlm(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  try {
    const body = await parseJsonBody(req);
    const maxTokens = Math.min(400, Math.max(16, Number(body?.maxTokens) || 150));
    const timeoutMs = Math.min(60_000, Math.max(2000, Number(body?.timeoutMs) || 20_000));
    const started = Date.now();
    const geminiCfg = getGeminiConfig();

    // 1. First preference: Local Ollama (Qwen 2.5 1.5B / configured model)
    try {
      // If Gemini is available as backup, cap Ollama at 12s so it fails over quickly instead of hanging.
      // With qwen2.5:1.5b on CPU, completions typically take 2-5s.
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
