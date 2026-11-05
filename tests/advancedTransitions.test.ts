import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import { DJAgent } from '../src/ai/DJAgent';

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
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  frequency = {
    value: 1000,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
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

beforeEach(() => {
  (globalThis as any).window = globalThis;
  (globalThis as any).window.addEventListener = vi.fn();
  (globalThis as any).window.removeEventListener = vi.fn();
  (globalThis as any).window.AudioContext = MockAudioContext;
  (globalThis as any).window.webkitAudioContext = MockAudioContext;
});

describe('Advanced AI Transitions Suite', () => {
  it('correctly maps natural language transition requests to advanced DJ styles', async () => {
    const agent = new DJAgent();

    const rollRes = await agent.interpretCommand('do a stutter loop roll riser into deck B');
    expect(rollRes.plan.action).toBe('execute_transition');
    expect(rollRes.plan.transition?.style).toBe('loop_roll_riser');

    const brakeRes = await agent.interpretCommand('vinyl brake into deck A');
    expect(brakeRes.plan.action).toBe('execute_transition');
    expect(brakeRes.plan.transition?.style).toBe('vinyl_brake_drop');

    const echoRes = await agent.interpretCommand('echo throw cut into deck B');
    expect(echoRes.plan.action).toBe('execute_transition');
    expect(echoRes.plan.transition?.style).toBe('echo_freeze_throw');

    const reverbRes = await agent.interpretCommand('stadium reverb wash into deck A');
    expect(reverbRes.plan.action).toBe('execute_transition');
    expect(reverbRes.plan.transition?.style).toBe('reverb_wash_drop');

    const stemRes = await agent.interpretCommand('3 band stem handover into deck B');
    expect(stemRes.plan.action).toBe('execute_transition');
    expect(stemRes.plan.transition?.style).toBe('showcase_3band_handoff');

    const filterRes = await agent.interpretCommand('filter bass swap into deck B');
    expect(filterRes.plan.action).toBe('execute_transition');
    expect(filterRes.plan.transition?.style).toBe('filter_bass_swap');

    const dropCutRes = await agent.interpretCommand('hard drop cut into deck A');
    expect(dropCutRes.plan.action).toBe('execute_transition');
    expect(dropCutRes.plan.transition?.style).toBe('drop_cut');
  });

  it('selects advanced exit FX intelligently based on tempo, mood, and energy', () => {
    const engine = new AudioEngine();

    // 1. Large tempo gap (> 5% BPM diff) -> Turntable Vinyl Brake
    const fastSong: any = { bpm: 140, bpmConfidence: 0.9, title: 'Speedy Track' };
    const slowSong: any = { bpm: 100, bpmConfidence: 0.9, title: 'Slow Groove' };
    const fxBrake = (engine as any).chooseExitFx(fastSong, slowSong, false);
    expect(fxBrake).toBe('brake');

    // 2. High energy party mood with beatmatch -> Alternates Loop Roll Riser & Echo Freeze
    engine.mood = 'party';
    const trackA: any = { bpm: 128, bpmConfidence: 0.9, title: 'House Anthem A' };
    const trackB: any = { bpm: 128, bpmConfidence: 0.9, title: 'House Anthem B' };
    const fxRollOrEcho = (engine as any).chooseExitFx(trackA, trackB, false);
    expect(['roll', 'echo']).toContain(fxRollOrEcho);

    // 3. Chill / Romantic mood -> Stadium Reverb Wash
    engine.mood = 'chill';
    const fxChill = (engine as any).chooseExitFx(trackA, trackB, false);
    expect(fxChill).toBe('reverb');
  });

  it('AudioEngine executes startTransition with advanced styles without degrading to flat crossfade', () => {
    const engine = new AudioEngine();
    const fakeTrackA: any = { id: 'track-a', title: 'Track Alpha', bpm: 128, duration: 200, musicStartTime: 0 };
    const fakeTrackB: any = { id: 'track-b', title: 'Track Beta', bpm: 128, duration: 200, musicStartTime: 0 };

    engine.deckA.loadTrack(fakeTrackA);
    engine.deckB.loadTrack(fakeTrackB);

    // 1. Test Filter Bass Swap
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'filter_bass_swap',
      durationSeconds: 8,
    });
    expect(engine.isTransitioning).toBe(true);
    expect(engine.acquisitionStatus).toContain('Resonant Filter Sweep');
    engine.cancelTransition();

    // 2. Test Stutter Loop Roll Riser
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'loop_roll_riser',
    });
    expect(engine.isTransitioning).toBe(true);
    expect(engine.acquisitionStatus).toContain('Stutter Loop Roll Riser');
    engine.cancelTransition();

    // 3. Test Turntable Vinyl Brake Drop
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'vinyl_brake_drop',
    });
    expect(engine.isTransitioning).toBe(true);
    expect(engine.acquisitionStatus).toContain('Turntable Vinyl Brake');
    engine.cancelTransition();

    // 4. Test Echo Freeze Throw
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'echo_freeze_throw',
    });
    expect(engine.isTransitioning).toBe(true);
    expect(engine.acquisitionStatus).toContain('Echo Freeze Throw');
    engine.cancelTransition();

    // 5. Test 3-Band Frequency Stem Isolation Handoff
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'showcase_3band_handoff',
    });
    expect(engine.isTransitioning).toBe(true);
    expect(engine.acquisitionStatus).toContain('3-Band Frequency Stem Isolation Handoff');
    engine.cancelTransition();

    // 6. Test Transitions Logger automatically logged all executed transitions
    expect(engine.transitionHistory.length).toBeGreaterThanOrEqual(5);
    expect(engine.transitionHistory[0].outgoing.title).toBe('Track Alpha');
    expect(engine.transitionHistory[0].incoming.title).toBe('Track Beta');
    const analytics = engine.getTransitionAnalytics();
    expect(analytics.totalTransitions).toBeGreaterThanOrEqual(5);
    expect(analytics.styleCounts['showcase_3band_handoff']).toBeGreaterThanOrEqual(1);
    expect(analytics.styleCounts['loop_roll_riser']).toBeGreaterThanOrEqual(1);
  });
});
