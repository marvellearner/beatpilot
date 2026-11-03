import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

class MockGainNode {
  gain = {
    value: 1,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockBiquadFilterNode {
  gain = { value: 0, setTargetAtTime: vi.fn() };
  frequency = { value: 1000 };
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
class MockAnalyserNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  smoothingTimeConstant = 0.8;
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
  getByteFrequencyData = vi.fn();
  getByteTimeDomainData = vi.fn();
}
class MockDelayNode {
  delayTime = { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockConvolverNode {
  buffer = null;
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockBufferSourceNode {
  buffer = null;
  playbackRate = { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  loop = false;
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class MockStereoPannerNode {
  pan = { value: 0 };
  connect = vi.fn((dest: any) => dest);
  disconnect = vi.fn();
}
class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination = {};
  createGain() { return new MockGainNode(); }
  createDelay() { return new MockDelayNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createBufferSource() { return new MockBufferSourceNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createBuffer(channels: number, length: number, rate: number) {
    return { duration: length / rate, numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => new Float32Array(length) };
  }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createWaveShaper() { return new MockWaveShaperNode(); }
  createAnalyser() { return new MockAnalyserNode(); }
  createChannelSplitter() { return { connect: vi.fn((dest: any) => dest) }; }
  createChannelMerger() { return { connect: vi.fn((dest: any) => dest) }; }
  createMediaElementSource() { return { connect: vi.fn((dest: any) => dest) }; }
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 1, numberOfChannels: 2, getChannelData: () => new Float32Array(100) });
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

describe('AudioEngine Subscription & Store Infrastructure', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    const storage: Record<string, string> = {};
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, val: string) => {
          storage[key] = val;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
      },
    };
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    (globalThis as any).Audio = class {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      play = vi.fn();
      pause = vi.fn();
      load = vi.fn();
    };

    engine = new AudioEngine();
  });

  it('allows multiple subscribers and notifies all on engine mutation', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const unsub1 = engine.subscribe(fn1);
    const unsub2 = engine.subscribe(fn2);

    const initialVersion = engine.storeVersion;

    engine.notify();

    expect(engine.storeVersion).toBe(initialVersion + 1);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    unsub1();

    engine.notify();
    expect(engine.storeVersion).toBe(initialVersion + 2);
    expect(fn1).toHaveBeenCalledTimes(1); // Unsubscribed
    expect(fn2).toHaveBeenCalledTimes(2);

    unsub2();
  });

  it('preserves backwards-compatibility with onEngineUpdate', () => {
    const legacyCallback = vi.fn();
    const subscriber = vi.fn();

    engine.onEngineUpdate = legacyCallback;
    const unsub = engine.subscribe(subscriber);

    engine.notify();

    expect(legacyCallback).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('isolates subscriber errors so other listeners still execute', () => {
    const faultySubscriber = vi.fn(() => {
      throw new Error('Subscriber exploded');
    });
    const healthySubscriber = vi.fn();

    const unsub1 = engine.subscribe(faultySubscriber);
    const unsub2 = engine.subscribe(healthySubscriber);

    expect(() => engine.notify()).not.toThrow();
    expect(faultySubscriber).toHaveBeenCalledTimes(1);
    expect(healthySubscriber).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it('correctly tracks isAnyDeckPlaying', () => {
    expect(engine.isAnyDeckPlaying()).toBe(false);

    // Mock deckA isPlaying
    vi.spyOn(engine.deckA, 'getPlaybackState').mockReturnValue({
      deckId: 'A',
      isPlaying: true,
      currentTime: 10,
      duration: 200,
      playbackRate: 1.0,
      effectiveBpm: 124,
      volume: 1.0,
      lowGain: 0,
      midGain: 0,
      highGain: 0,
      isCue: false,
      isBuffering: false,
      isStreaming: false,
      track: null,
      loop: null,
      loopInTime: null,
      hasLastLoop: false,
    });

    expect(engine.isAnyDeckPlaying()).toBe(true);
  });
});
