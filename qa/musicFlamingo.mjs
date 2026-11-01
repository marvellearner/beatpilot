// Music Flamingo (NVIDIA's music-understanding audio language model) as a QA listener for our
// transitions: it hears a recorded clip of a mix and rates it like a DJ would.
//
// The model (~8B parameters) needs a big NVIDIA GPU, so it isn't run on this laptop: the clip is
// sent to NVIDIA's public Hugging Face Space (nvidia/music-flamingo, A100) through its Gradio API.
// Set HF_TOKEN in .env for a larger free GPU quota; MUSIC_FLAMINGO_SPACE points at another Space or
// a self-hosted copy of the same app (same "/infer" endpoint).
// Licence: NVIDIA OneWay Noncommercial (research / non-commercial use only).
//
// CLI:  node qa/musicFlamingo.mjs <clip.wav> [mix start second in the clip]
import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile?.(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  // no .env: the Space is used anonymously
}

const SPACE = process.env.MUSIC_FLAMINGO_SPACE || 'nvidia/music-flamingo';
const TIMEOUT_MS = 6 * 60_000; // a busy Space queues requests

let clientPromise = null;
function client() {
  clientPromise ??= Client.connect(SPACE, process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : {}).catch((err) => {
    clientPromise = null; // a failed connection isn't kept: the next call connects again
    throw err;
  });
  return clientPromise;
}

const RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The question asked about a transition clip: a DJ's critique, answered as JSON. */
export function transitionPrompt({ mixAt, mixSeconds, from, to, style } = {}) {
  const when = mixAt !== undefined ? `The DJ starts mixing at about ${Math.round(mixAt)} s` : 'Somewhere in the middle the DJ mixes';
  const how = mixSeconds !== undefined ? ` and the transition lasts about ${Math.round(mixSeconds)} s` : '';
  const songs = from && to ? ` from "${from}" into "${to}"` : ' from one song into another';
  const styled = style ? ` (the app called this mix: ${style})` : '';
  return [
    `This clip is a DJ transition. ${when}${songs}${how}${styled}.`,
    'Listen like an experienced club DJ and judge the transition only (not the songs themselves):',
    '- Is it abrupt (a song stops or starts suddenly while it is playing), or smooth?',
    '- Are the beats of the two songs aligned while they overlap, or do the kicks flam / clash?',
    '- Do the keys or two vocals clash during the overlap?',
    '- Is the energy and loudness steady, or is there a drop-out, a jump, or a muddy double bass?',
    'Answer with ONLY this JSON, no other text:',
    '{"score": <1-10 overall transition quality>, "abrupt": <true|false>, "beats_aligned": <true|false|null if no overlap>,',
    ' "key_clash": "none|mild|strong", "vocal_clash": <true|false>, "energy": "steady|dip|jump|muddy",',
    ' "issues": ["<short problem>", ...], "verdict": "<one sentence>"}',
  ].join('\n');
}

/** A Python-style dict ({'a': True, "b": None}), which the model sometimes answers with, as JSON text. */
function pythonToJson(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      let str = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\' && j + 1 < s.length) j++;
        str += s[j++];
      }
      out += JSON.stringify(str);
      i = j;
    } else {
      const word = s.slice(i).match(/^(True|False|None)\b/)?.[1];
      if (word) {
        out += word === 'True' ? 'true' : word === 'False' ? 'false' : 'null';
        i += word.length - 1;
      } else out += c;
    }
  }
  return out;
}

const camel = (k) => k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());

/** The first JSON (or Python dict) object in the model's answer, keys in camelCase; null for prose. */
export function parseReview(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = text.slice(start, end + 1);
  for (const attempt of [body, pythonToJson(body)]) {
    try {
      const j = JSON.parse(attempt);
      if (typeof j === 'object' && j) return Object.fromEntries(Object.entries(j).map(([k, v]) => [camel(k), v]));
    } catch {
      // try the next form
    }
  }
  return null;
}

/**
 * Asks Music Flamingo about one clip. Returns { review, raw } (review null if no JSON came back).
 * The public Space sometimes refuses a connection for a moment: tried up to RETRIES times.
 */
export async function reviewTransition(wavPath, context = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(wavPath, context);
    } catch (err) {
      // Out of free GPU time: waiting won't help, a Hugging Face token (HF_TOKEN in .env) will
      if (attempt >= RETRIES || /^❌|quota/i.test(err.message)) throw err;
      await sleep(attempt * 20_000);
    }
  }
}

async function askOnce(wavPath, context) {
  const app = await client();
  const blob = new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' });
  const job = app.predict('/infer', { audio_path: handle_file(blob), youtube_url: '', prompt_text: transitionPrompt(context) });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer from ${SPACE} in ${TIMEOUT_MS / 60000} min`)), TIMEOUT_MS));
  const result = await Promise.race([job, timeout]);
  const raw = String(result?.data?.[0] ?? '').replace(/^✅[^\n]*\n+/, '').trim();
  if (/^❌/.test(raw)) throw new Error(raw);
  return { review: parseReview(raw), raw };
}

// CLI: review one clip
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, mixAt] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node qa/musicFlamingo.mjs <clip.wav> [mix start second in the clip]');
    process.exit(1);
  }
  try {
    const { review, raw } = await reviewTransition(file, { mixAt: mixAt ? Number(mixAt) : undefined });
    console.log(review ? JSON.stringify(review, null, 2) : raw);
    process.exit(0);
  } catch (err) {
    console.error(`Music Flamingo failed: ${err.message}`);
    process.exit(1);
  }
}
