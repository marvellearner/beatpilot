import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiBlocked, geminiGenerate } from '../server/llm';

// Google's answer when the free quota is used up (shortened)
const quotaAnswer = () =>
  new Response(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota', details: [{ retryDelay: '30s' }] } }).replace('"details"', '"details"').replace('[{"retryDelay":"30s"}]', '[{"@type":"RetryInfo","retryDelay":"30s"}]'), { status: 429 });

describe('Gemini quota (the light said green while every request failed with 429)', () => {
  const origDailyLimit = process.env.GEMINI_DAILY_LIMIT_INR;
  beforeEach(() => {
    process.env.GEMINI_DAILY_LIMIT_INR = '999999';
  });
  afterEach(() => {
    if (origDailyLimit === undefined) {
      delete process.env.GEMINI_DAILY_LIMIT_INR;
    } else {
      process.env.GEMINI_DAILY_LIMIT_INR = origDailyLimit;
    }
    vi.unstubAllGlobals();
  });

  it('tries every model, then holds Gemini back for the wait Google asks for', async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    const fetchMock = vi.fn(async () => quotaAnswer());
    vi.stubGlobal('fetch', fetchMock);
    await expect(geminiGenerate('{}', 10, 1000)).rejects.toThrow(/429/);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2); // the other models were tried too
    const held = geminiBlocked();
    expect(held?.error).toMatch(/quota/);
    expect(held!.until - Date.now()).toBeGreaterThan(25_000);
    expect(held!.until - Date.now()).toBeLessThanOrEqual(30_000);

    // While held back, Google isn't called again
    fetchMock.mockClear();
    await expect(geminiGenerate('{}', 10, 1000)).rejects.toThrow(/held back/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is available again after the wait, and a request that answers clears it', async () => {
    vi.setSystemTime(Date.now() + 31_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })));
    await expect(geminiGenerate('{}', 10, 1000)).resolves.toBe('{"ok":true}');
    expect(geminiBlocked()).toBeNull();
    vi.useRealTimers();
  });
});
