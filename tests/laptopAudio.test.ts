import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain function, not vi.fn: Vitest reports an error thrown through a vi.fn even when the code catches it
const { spawn } = vi.hoisted(() => {
  const spawn = Object.assign((...args: unknown[]) => { spawn.calls.push(args); return spawn.impl(...args); }, {
    calls: [] as unknown[][],
    impl: (..._args: unknown[]): unknown => undefined,
  });
  return { spawn };
});
vi.mock('child_process', () => ({ spawn }));
vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>();
  return { ...real, default: { ...real, existsSync: () => true }, existsSync: () => true };
});
vi.mock('../server/logger', () => ({ logError: () => {} }));

/** A stand-in for the PowerShell worker: answers each command line like laptopVolume.cs does. */
function fakeWorker(answer: (command: string) => string | null) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => child.emit('exit', null)),
  });
  child.stdout.write('{"ready":true}\n');
  let text = '';
  child.stdin.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    let end: number;
    while ((end = text.indexOf('\n')) >= 0) {
      const reply = answer(text.slice(0, end));
      text = text.slice(end + 1);
      if (reply !== null) child.stdout.write(`${reply}\n`);
    }
  });
  return child;
}

async function load() {
  vi.resetModules();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  return import('../server/laptopAudio');
}

beforeEach(() => {
  spawn.calls = [];
});

describe('laptop volume', () => {
  it('keeps one PowerShell worker and reads its answers in order', async () => {
    let volume = 0.34;
    let muted = false;
    spawn.impl = () =>
      fakeWorker((cmd) => {
        const [action, arg] = cmd.split(' ');
        if (action === 'set') volume = Number(arg);
        if (action === 'toggle') muted = !muted;
        return JSON.stringify({ volume, muted });
      });
    const audio = await load();
    await expect(audio.getLaptopVolume()).resolves.toEqual({ volume: 0.34, muted: false, supported: true });
    await expect(audio.setLaptopVolume(0.6)).resolves.toMatchObject({ volume: 0.6 });
    await expect(audio.toggleLaptopMute()).resolves.toMatchObject({ volume: 0.6, muted: true });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0][0]).toBe('powershell.exe');
  });

  it('keeps the last known state when Windows refuses to start the worker (spawn UNKNOWN)', async () => {
    spawn.impl = () => {
      throw new Error('spawn UNKNOWN');
    };
    const audio = await load();
    await expect(audio.getLaptopVolume()).resolves.toMatchObject({ volume: 0.5 });
    await expect(audio.setLaptopVolume(0.8)).resolves.toMatchObject({ volume: 0.8 });
    await expect(audio.toggleLaptopMute()).resolves.toMatchObject({ muted: true });
    await expect(audio.setLaptopMute(false)).resolves.toMatchObject({ muted: false });
    expect(spawn.calls).toHaveLength(1); // and waits before trying again, instead of every 4 s poll
  });

  it('answers waiting calls and backs off when the worker dies', async () => {
    let child: ReturnType<typeof fakeWorker> | undefined;
    spawn.impl = () => (child = fakeWorker(() => null));
    const audio = await load();
    const reading = audio.getLaptopVolume();
    await new Promise((r) => setTimeout(r, 10));
    child!.emit('exit', 1);
    await expect(reading).resolves.toMatchObject({ volume: 0.5 });
    await audio.getLaptopVolume();
    expect(spawn.calls).toHaveLength(1);
  });
});
