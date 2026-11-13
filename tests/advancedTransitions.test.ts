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

    // 1. Large tempo gap (> 5% BPM diff) -> one of the rotating DJ moves, never a plain fade
    engine.mood = 'party';
    const fastSong: any = { bpm: 140, bpmConfidence: 0.9, title: 'Speedy Track' };
    const slowSong: any = { bpm: 100, bpmConfidence: 0.9, title: 'Slow Groove' };
    const fxUnmatched = (engine as any).chooseExitFx(fastSong, slowSong, false);
    expect(['echo', 'filter', 'roll', 'reverb', 'brake']).toContain(fxUnmatched);

    // 2. Beatmatched on a dance floor -> a filter sweep blend first, then roll / echo now and then
    const trackA: any = { bpm: 128, bpmConfidence: 0.9, title: 'House Anthem A' };
    const trackB: any = { bpm: 128, bpmConfidence: 0.9, title: 'House Anthem B' };
    expect((engine as any).chooseExitFx(trackA, trackB, false)).toBe('filter');
    (engine as any).recentExitFx = ['filter'];
    expect(['roll', 'echo']).toContain((engine as any).chooseExitFx(trackA, trackB, false));

    // 3. Chill / Romantic mood, beatmatched -> filter sweep or echo, never a roll
    engine.mood = 'chill';
    (engine as any).recentExitFx = [];
    expect((engine as any).chooseExitFx(trackA, trackB, false)).toBe('filter');
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

    // 1b. The 'filter' move chosen by a planned mix plays as the filter sweep and joins the rotation
    engine.startTransition({
      sourceDeck: 'A',
      targetDeck: 'B',
      style: 'filter_bass_swap',
      exitFx: 'filter',
      durationSeconds: 8,
    });
    expect(engine.acquisitionStatus).toContain('Resonant Filter Sweep');
    expect((engine as any).recentExitFx[0]).toBe('filter');
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

  it('guarantees ONLY advance level DJ transitions via resolveAdvancedTransition', () => {
    const engine = new AudioEngine();
    const trackFast: any = { id: 'fast', title: 'Fast Track', bpm: 140, bpmConfidence: 0.9, key: '8A', keyConfidence: 0.9 };
    const trackSlow: any = { id: 'slow', title: 'Slow Track', bpm: 95, bpmConfidence: 0.9, key: '8A', keyConfidence: 0.9 };
    const trackMatchA: any = { id: 'a', title: 'Track A', bpm: 128, bpmConfidence: 0.9, key: '8A', keyConfidence: 0.9 };
    const trackMatchB: any = { id: 'b', title: 'Track B', bpm: 128, bpmConfidence: 0.9, key: '8A', keyConfidence: 0.9 };

    // 1. Large tempo gap (> 5% BPM difference) resolves to vinyl brake drop, loop roll or echo throw
    const advGap = engine.resolveAdvancedTransition(trackFast, trackSlow);
    expect(['vinyl_brake_drop', 'loop_roll_riser', 'echo_freeze_throw', 'reverb_wash_drop']).toContain(advGap.style);

    // 2. Chill mood tempo gap resolves to stadium reverb wash drop
    engine.mood = 'chill';
    const advChill = engine.resolveAdvancedTransition(trackFast, trackSlow);
    expect(advChill.style).toBe('reverb_wash_drop');
    expect(advChill.exitFx).toBe('reverb');

    // 3. Beatmatched tracks with harmonic compatibility resolve to 3-band stem handoff, loop roll, or filter bass swap
    engine.mood = 'normal';
    const advMatch = engine.resolveAdvancedTransition(trackMatchA, trackMatchB);
    expect(['showcase_3band_handoff', 'loop_roll_riser', 'filter_bass_swap']).toContain(advMatch.style);

    // 4. Gap cut resolves to drop_cut
    const advCut = engine.resolveAdvancedTransition(trackMatchA, trackMatchB, { gapCut: true });
    expect(advCut.style).toBe('drop_cut');
  });
});

describe('Special mixes: drop mix and vocal overlay', () => {
  function setup() {
    const engine = new AudioEngine();
    const a: any = { id: 'a', title: 'Song A', bpm: 120, bpmConfidence: 0.9, duration: 240, musicStartTime: 0 };
    const b: any = { id: 'b', title: 'Song B', bpm: 120, bpmConfidence: 0.9, duration: 240, musicStartTime: 0 };
    engine.deckA.loadTrack(a);
    engine.deckB.loadTrack(b);
    // Song A on air and playing
    const real = engine.deckA.getPlaybackState.bind(engine.deckA);
    vi.spyOn(engine.deckA, 'getPlaybackState').mockImplementation(() => ({ ...real(), isPlaying: true, track: a }));
    const logged: any[] = [];
    vi.spyOn((engine as any).transitionLogger, 'logTransition').mockImplementation(async (r: any) => { logged.push(r); });
    const play = vi.spyOn(engine.deckB, 'play');
    return { engine, logged, play };
  }

  it('drop mix: logs drop_mix and starts song B on its drop', () => {
    const { engine, logged, play } = setup();
    engine.startTransition({ sourceDeck: 'A', targetDeck: 'B', style: 'drop_mix', dropMix: true, targetEntryTime: 64 });
    expect(logged[0].style).toBe('drop_mix');
    expect(play.mock.calls[0][0]).toBe(64);
    expect(engine.acquisitionStatus).toContain('Drop mix');
    engine.cancelTransition();
  });

  it('vocal overlay: song B vocals only, its music back at the reveal, given back if the mix is cancelled', () => {
    const { engine, logged, play } = setup();
    const music = vi.spyOn(engine.deckB, 'scheduleMusicLevel');
    engine.startTransition({ sourceDeck: 'A', targetDeck: 'B', style: 'vocal_overlay', vocalOverlay: { revealSeconds: 16 }, targetEntryTime: 40, durationSeconds: 16.3 });
    expect(logged[0].style).toBe('vocal_overlay');
    expect(music.mock.calls[0][0]).toBe(0); // vocals only first
    expect(music.mock.calls[1][0]).toBe(1); // full music at the reveal...
    const startAt = play.mock.calls[0][1] as number;
    expect(music.mock.calls[1][1]).toBeCloseTo(startAt + 16, 5); // ...16 s after song B starts
    expect(play.mock.calls[0][0]).toBeGreaterThanOrEqual(40);
    expect(engine.acquisitionStatus).toContain('Vocal overlay');

    const restore = vi.spyOn(engine.deckB, 'setMusicLevel');
    engine.cancelTransition();
    expect(restore).toHaveBeenCalledWith(1);
  });
});
