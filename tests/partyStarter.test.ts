import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DJAgent, CURATED_PARTY_STARTERS } from '../src/ai/DJAgent';

describe('DJAgent decidePartyStarter', () => {
  let agent: DJAgent;

  beforeEach(() => {
    agent = new DJAgent();
  });

  it('provides curated party starter fallbacks for dance, bhangra, and chill', () => {
    expect(CURATED_PARTY_STARTERS.dance.length).toBeGreaterThan(0);
    expect(CURATED_PARTY_STARTERS.bhangra.length).toBeGreaterThan(0);
    expect(CURATED_PARTY_STARTERS.chill.length).toBeGreaterThan(0);

    const levels = CURATED_PARTY_STARTERS.dance.find((s) => s.title.toLowerCase().includes('levels'));
    expect(levels).toBeDefined();

    const mundian = CURATED_PARTY_STARTERS.bhangra.find((s) => s.title.toLowerCase().includes('mundian'));
    expect(mundian).toBeDefined();
  });

  it('returns a high-energy dance party starter when dance vibe is requested', async () => {
    // When LLM fetch fails or is offline, it falls back to curated bangers
    const starter = await agent.decidePartyStarter('dance');
    expect(starter).toBeDefined();
    expect(starter.title).toBeTruthy();
    expect(starter.query).toBeTruthy();
    expect(starter.vibe).toBe('dance');
    expect(starter.energyLevel).toBe('peak');
  });

  it('returns a bhangra party starter when bhangra vibe is requested', async () => {
    const starter = await agent.decidePartyStarter('bhangra');
    expect(starter).toBeDefined();
    expect(starter.title).toBeTruthy();
    expect(starter.vibe).toBe('bhangra');
    expect(starter.energyLevel).toBe('peak');
  });

  it('defaults auto vibe to dance party opener', async () => {
    const starter = await agent.decidePartyStarter('auto');
    expect(starter).toBeDefined();
    expect(starter.title).toBeTruthy();
    expect(starter.vibe).toBe('dance');
  });

  it('uses LLM response when askJson returns a valid party opener', async () => {
    const mockLlmResponse = {
      data: {
        title: 'Pepas',
        artist: 'Farruko',
        query: 'Farruko - Pepas',
        reason: 'Maximum crowd energy and driving tribal rhythm',
      },
      provider: 'gemini',
    };

    // Spy on private askJson by mocking fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify(mockLlmResponse.data),
        provider: 'gemini',
      }),
    } as any);

    try {
      const starter = await agent.decidePartyStarter('dance');
      expect(starter.title).toBe('Pepas');
      expect(starter.artist).toBe('Farruko');
      expect(starter.source).toBe('gemini');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

