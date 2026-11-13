import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { ROOT_DIR } from './paths';
import { logError } from './logger';

export interface LaptopVolumeState {
  volume: number; // 0.0 to 1.0
  muted: boolean;
  supported: boolean;
}

let cachedState: LaptopVolumeState = {
  volume: 0.5,
  muted: false,
  supported: process.platform === 'win32',
};

let isUpdating = false;
let pendingTargetVolume: number | null = null;

// --- The volume worker ---
// Windows' Smart App Control blocks a home-built, unsigned .exe ("spawn UNKNOWN"), so the volume
// code (laptopVolume.cs) runs inside Windows' own, signed PowerShell instead: one process, compiled
// once at start, then one command per line on stdin ("get", "set 0.5", "mute true", "toggle") and
// one JSON answer per line on stdout. Far lighter than starting a program on every 4 s poll.

const CS_SOURCE = path.join(ROOT_DIR, 'server', 'laptopVolume.cs');
const ANSWER_TIMEOUT_MS = 15_000; // the first answer includes PowerShell starting and compiling (~2 s, more under load)
const RETRY_AFTER_MS = 5 * 60_000; // after the worker fails, the last known volume is shown for this long before trying again

type Reading = { volume: number; muted: boolean } | null;

const workerScript = (csFile: string) =>
  [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${csFile.replace(/'/g, "''")}') -Language CSharp`,
    "[Console]::Out.WriteLine('{\"ready\":true}')",
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    "  try { [void][LaptopVolumeControl.Program]::Main($line.Trim().Split(' ')) } catch { [Console]::Out.WriteLine('{\"error\":\"failed\"}') }",
    '}',
  ].join('\n');

let worker: ChildProcessWithoutNullStreams | null = null;
let workerDownUntil = 0;
let waiting: Array<{ resolve: (r: Reading) => void; timer: ReturnType<typeof setTimeout> }> = [];

function parseReading(line: string): Reading {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.volume === 'number') return { volume: parsed.volume, muted: !!parsed.muted };
  } catch {
    // not a reading
  }
  return null;
}

/** Stops the worker, answers everyone waiting with "unknown", and waits RETRY_AFTER_MS before the next try. */
function stopWorker(reason: unknown) {
  const child = worker;
  worker = null;
  workerDownUntil = Date.now() + RETRY_AFTER_MS;
  logError('laptop-volume', reason);
  try {
    child?.kill();
  } catch {
    // already gone
  }
  const stranded = waiting;
  waiting = [];
  for (const w of stranded) {
    clearTimeout(w.timer);
    w.resolve(null);
  }
}

function startWorker(): ChildProcessWithoutNullStreams | null {
  if (worker) return worker;
  if (process.platform !== 'win32' || Date.now() < workerDownUntil || !fs.existsSync(CS_SOURCE)) return null;
  let child: ChildProcessWithoutNullStreams;
  try {
    const encoded = Buffer.from(workerScript(CS_SOURCE), 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
  } catch (err) {
    // Windows can refuse to start a program at all (spawn UNKNOWN). Callers don't catch, so this
    // must not throw: an unhandled error stops the whole server.
    workerDownUntil = Date.now() + RETRY_AFTER_MS;
    logError('laptop-volume', err);
    return null;
  }
  worker = child;
  let pendingText = '';
  let errText = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    pendingText += chunk;
    let end: number;
    while ((end = pendingText.indexOf('\n')) >= 0) {
      const line = pendingText.slice(0, end).trim();
      pendingText = pendingText.slice(end + 1);
      if (!line || line.includes('"ready"')) continue;
      const next = waiting.shift();
      if (!next) continue;
      clearTimeout(next.timer);
      next.resolve(parseReading(line));
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    errText = (errText + chunk).slice(-500);
  });
  child.stdin.on('error', () => {}); // a closed pipe shows up as 'exit' below
  child.on('error', (err) => {
    if (worker === child) stopWorker(err);
  });
  child.on('exit', (code) => {
    if (worker === child) stopWorker(new Error(`volume worker stopped (exit ${code}) ${errText.trim()}`));
  });
  return child;
}

/** Runs one volume command; null when the volume can't be read (the caller keeps the last known state). */
function runLaptopVolume(args: string[]): Promise<Reading> {
  return new Promise((resolve) => {
    const child = startWorker();
    if (!child) return resolve(null);
    const timer = setTimeout(() => {
      if (worker === child) stopWorker(new Error(`volume worker didn't answer "${args.join(' ')}" within ${ANSWER_TIMEOUT_MS / 1000} s`));
    }, ANSWER_TIMEOUT_MS);
    waiting.push({ resolve, timer });
    try {
      child.stdin.write(`${args.join(' ')}\n`);
    } catch (err) {
      if (worker === child) stopWorker(err);
    }
  });
}

export async function setLaptopVolume(target: number): Promise<LaptopVolumeState> {
  const clamped = Math.max(0, Math.min(1, target));
  cachedState.volume = clamped;
  if (clamped > 0.01) cachedState.muted = false;

  if (isUpdating) {
    pendingTargetVolume = clamped;
    return cachedState;
  }

  isUpdating = true;
  try {
    const res = await runLaptopVolume(['set', clamped.toFixed(3)]);
    if (res) {
      cachedState = { volume: res.volume, muted: res.muted, supported: true };
    }
  } catch (err) {
    logError('laptop-volume', err);
  } finally {
    isUpdating = false;
    if (pendingTargetVolume !== null) {
      const next = pendingTargetVolume;
      pendingTargetVolume = null;
      return setLaptopVolume(next);
    }
  }
  return cachedState;
}

export async function toggleLaptopMute(): Promise<LaptopVolumeState> {
  cachedState.muted = !cachedState.muted;
  const res = await runLaptopVolume(['toggle']);
  if (res) {
    cachedState = { volume: res.volume, muted: res.muted, supported: true };
  }
  return cachedState;
}

export async function setLaptopMute(muted: boolean): Promise<LaptopVolumeState> {
  cachedState.muted = muted;
  const res = await runLaptopVolume(['mute', muted ? 'true' : 'false']);
  if (res) {
    cachedState = { volume: res.volume, muted: res.muted, supported: true };
  }
  return cachedState;
}

export async function getLaptopVolume(): Promise<LaptopVolumeState> {
  const res = await runLaptopVolume(['get']);
  if (res) {
    cachedState = { volume: res.volume, muted: res.muted, supported: true };
  }
  return cachedState;
}

export async function handleLaptopVolume(req: IncomingMessage, res: ServerResponse, _url: URL): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    const state = await getLaptopVolume();
    res.end(JSON.stringify(state));
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        let state: LaptopVolumeState;
        if (data.toggle) {
          state = await toggleLaptopMute();
        } else if (typeof data.muted === 'boolean') {
          state = await setLaptopMute(data.muted);
        } else if (typeof data.volume === 'number') {
          state = await setLaptopVolume(data.volume);
        } else {
          state = await getLaptopVolume();
        }
        res.end(JSON.stringify(state));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }
  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
