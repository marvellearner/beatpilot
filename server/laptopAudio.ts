import { execFile } from 'child_process';
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

const exePath = path.join(ROOT_DIR, 'server', 'laptopVolume.exe');
let isUpdating = false;
let pendingTargetVolume: number | null = null;

function runLaptopVolume(args: string[]): Promise<{ volume: number; muted: boolean } | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !fs.existsSync(exePath)) {
      return resolve(null);
    }
    execFile(exePath, args, { timeout: 3000 }, (error, stdout) => {
      if (error || !stdout) {
        return resolve(null);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (typeof parsed.volume === 'number') {
          return resolve({ volume: parsed.volume, muted: !!parsed.muted });
        }
      } catch {
        // ignore parse error
      }
      resolve(null);
    });
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

export async function handleLaptopVolume(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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
