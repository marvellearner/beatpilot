import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import type { QueuedTrack } from '../src/types';

// Mock Web Audio API for Node.js test environment
class MockGainNode {
  gain = {
    value: 1,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockBiquadFilterNode {
  gain = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
  frequency = { value: 1000, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
  Q = { value: 1 };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockDynamicsCompressorNode {
  threshold = { value: -1 };
  knee = { value: 0 };
  ratio = { value: 20 };
  attack = { value: 0.001 };
  release = { value: 0.05 };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockWaveShaperNode {
  curve = null;
  oversample = 'none';
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockAudioContext {
  state = 'running';
  currentTime = 10;
  sampleRate = 44100;
  destination = {};
  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createWaveShaper() { return new MockWaveShaperNode(); }
  createDelay() {
    return {
      delayTime: { value: 0, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createConvolver() {
    return { buffer: null, connect: vi.fn(), disconnect: vi.fn() };
  }
  createChannelSplitter() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createChannelMerger() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createStereoPanner() {
    return {
      pan: { value: 0, setValueAtTime: vi.fn() },
      connect: vi.fn((dest: any) => dest),
      disconnect: vi.fn(),
    };
  }
  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteTimeDomainData: vi.fn(),
      getByteFrequencyData: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

describe('Pending Mix Queue Retention', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).window.addEventListener = vi.fn();
    (globalThis as any).window.removeEventListener = vi.fn();
    (globalThis as any).window.AudioContext = MockAudioContext;
    (globalThis as any).window.webkitAudioContext = MockAudioContext;
    (globalThis as any).window.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ songs: [] }),
    }));
    engine = new AudioEngine();
  });

  const createDummyBuffer = () => {
    const ctx = new MockAudioContext();
    return ctx.createBuffer(2, 44100 * 180, 44100) as unknown as AudioBuffer;
  };

  const createTrack = (id: string, title: string, artist: string): QueuedTrack => ({
    id,
    title,
    artist,
    duration: 180,
    url: `http://test.com/${id}`,
    status: 'ready',
    audioBuffer: createDummyBuffer(),
    bpm: 128,
    bpmConfidence: 0.9,
    key: '8B',
  });

  it('keeps the planned song in Up Next queue when a mix is scheduled', () => {
    const song1 = createTrack('s1', 'Tera Yaar Bolda', 'Surjit Bindrakhia');
    const song2 = createTrack('s2', 'Sadi Gali', 'T-Series');

    // Simulate song1 currently on air
    const deckA = (engine as any).deckA;
    deckA.loadTrack((engine as any).queuedItemToTrack(song1));
    deckA.play(10);
    (engine as any).activeDeck = 'A';

    // Put song2 in the queue
    (engine as any).queue = [song2];

    // Plan mix into song2
    const planned = (engine as any).planMixInto(song2.id, 30);
    expect(planned).toBe(true);

    // Verify pendingMix is active
    expect((engine as any).pendingMix).not.toBeNull();
    expect((engine as any).pendingMix.item.id).toBe(song2.id);

    // CRITICAL: song2 MUST STILL BE IN Up Next queue!
    const queue = (engine as any).queue as QueuedTrack[];
    expect(queue.some((q) => q.id === song2.id)).toBe(true);
    expect(queue[0].id).toBe(song2.id);
  });

  it('does NOT lose or skip the planned song when user explicitly mixes another song', () => {
    const onAirSong = createTrack('onair', 'Winning Speech', 'Karan Aujla');
    const plannedSong = createTrack('planned', 'Sadi Gali', 'T-Series');
    const userChosenSong = createTrack('explicit', 'Tera Yaar Bolda', 'Surjit Bindrakhia');

    // Load on air song
    const deckA = (engine as any).deckA;
    deckA.loadTrack((engine as any).queuedItemToTrack(onAirSong));
    deckA.play(10);
    (engine as any).activeDeck = 'A';

    // Queue has both plannedSong and userChosenSong
    (engine as any).queue = [plannedSong, userChosenSong];

    // Plan mix into plannedSong
    (engine as any).planMixInto(plannedSong.id, 30);
    expect((engine as any).pendingMix?.item.id).toBe(plannedSong.id);

    // User explicitly decides to mix userChosenSong instead!
    engine.mixQueuedTrack(userChosenSong.id);

    // plannedSong MUST NOT be lost, removed, or added to skippedUntil!
    const queue = (engine as any).queue as QueuedTrack[];
    expect(queue.some((q) => q.id === plannedSong.id)).toBe(true);
    expect((engine as any).skippedUntil.has(plannedSong.id)).toBe(false);
  });

  it('removes the song from the queue only when the mix actually executes', () => {
    const song1 = createTrack('s1', 'Tera Yaar Bolda', 'Surjit Bindrakhia');
    const song2 = createTrack('s2', 'Sadi Gali', 'T-Series');

    const deckA = (engine as any).deckA;
    deckA.loadTrack((engine as any).queuedItemToTrack(song1));
    deckA.play(10);
    (engine as any).activeDeck = 'A';

    (engine as any).queue = [song2];

    // Plan mix into song2
    (engine as any).planMixInto(song2.id, 30);
    expect((engine as any).queue.some((q: QueuedTrack) => q.id === song2.id)).toBe(true);

    // Execute the mix now
    (engine as any).executePendingMix(true);

    // Now that the mix has actually executed and transitioned, song2 is removed from queue
    expect((engine as any).queue.some((q: QueuedTrack) => q.id === song2.id)).toBe(false);
  });
});
