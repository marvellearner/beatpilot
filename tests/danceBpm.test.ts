import { describe, expect, it } from 'vitest';
import { DJAgent } from '../src/ai/DJAgent';

describe('DJAgent.decideDanceBpm heuristic fallback', () => {
  const agent = new DJAgent();

  it('identifies Chappa Chappa Charkha Chale as half-time folk and sets party dance BPM', () => {
    const decision = agent.heuristicDanceBpm({
      title: 'Chappa Chappa Charkha Chale',
      artist: 'Vishal Bhardwaj, Suresh Wadkar, Hariharan',
      rawBpm: 152,
      mood: 'party',
      sessionBpm: 126,
    });

    expect(decision.perceivedMeter).toBe('half_time_folk');
    expect(decision.effectiveDanceBpm).toBe(76);
    expect(decision.targetPartyBpm).toBe(126);
    expect(decision.rhythmStyle).toBe('dhol_dhamaal');
    expect(decision.reason).toContain('Half-time folk meter');
  });

  it('keeps standard 4/4 electronic dance songs at standard meter', () => {
    const decision = agent.heuristicDanceBpm({
      title: 'Titanium',
      artist: 'David Guetta',
      rawBpm: 126,
      mood: 'party',
      sessionBpm: 126,
    });

    expect(decision.perceivedMeter).toBe('standard_4_4');
    expect(decision.effectiveDanceBpm).toBe(126);
    expect(decision.targetPartyBpm).toBe(126);
  });

  it('evaluates Born to Shine at party tempo without dragging below 90 BPM', () => {
    const decision = agent.heuristicDanceBpm({
      title: 'Born to Shine',
      artist: 'Diljit Dosanjh',
      rawBpm: 90,
      mood: 'party',
      sessionBpm: null,
    });

    // In party mode, target tempo matches at least party floor (120-130)
    expect(decision.targetPartyBpm).toBeGreaterThanOrEqual(90);
  });
});

