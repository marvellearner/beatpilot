import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  checkGeminiDailyBudget,
  recordGeminiUsage,
  getGeminiDailyUsage,
  estimateCostInr,
  getDailyLimitInr,
  getTodayDateString,
  GEMINI_USAGE_FILE,
} from '../server/geminiUsage';

describe('Gemini Token Budget & Daily Spending Limiter', () => {
  const backupFile = `${GEMINI_USAGE_FILE}.test-backup`;
  const origEnv = process.env.GEMINI_DAILY_LIMIT_INR;

  beforeEach(() => {
    process.env.GEMINI_DAILY_LIMIT_INR = '100';
    if (fs.existsSync(GEMINI_USAGE_FILE)) {
      try {
        fs.copyFileSync(GEMINI_USAGE_FILE, backupFile);
        fs.unlinkSync(GEMINI_USAGE_FILE);
      } catch {
        // ignore
      }
    }
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.GEMINI_DAILY_LIMIT_INR = origEnv;
    } else {
      delete process.env.GEMINI_DAILY_LIMIT_INR;
    }
    if (fs.existsSync(backupFile)) {
      try {
        fs.copyFileSync(backupFile, GEMINI_USAGE_FILE);
        fs.unlinkSync(backupFile);
      } catch {
        // ignore
      }
    } else if (fs.existsSync(GEMINI_USAGE_FILE)) {
      try {
        fs.unlinkSync(GEMINI_USAGE_FILE);
      } catch {
        // ignore
      }
    }
  });

  it('defaults to a ₹100 INR daily limit when not configured in env', () => {
    expect(getDailyLimitInr()).toBe(100);
  });

  it('accurately estimates cost in INR with tax buffer', () => {
    // 100,000 input tokens on flash ($0.075/1M) = 0.0075 USD * 90 = 0.675 INR
    const cost = estimateCostInr(100_000, 10_000, 'gemini-3.5-flash-lite');
    expect(cost).toBeGreaterThan(0.5);
    expect(cost).toBeLessThan(1.5);
  });

  it('initializes today usage ledger with 0 spend and ₹100 remaining', () => {
    const usage = getGeminiDailyUsage();
    expect(usage.date).toBe(getTodayDateString());
    expect(usage.estimatedSpendInr).toBe(0);
    expect(usage.dailyLimitInr).toBe(100);
    expect(usage.remainingInr).toBe(100);
  });

  it('allows requests when under budget', () => {
    const check = checkGeminiDailyBudget();
    expect(check.allowed).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it('records tokens, accumulates spend, and blocks when limit is exceeded', () => {
    // Record moderate usage
    const usage1 = recordGeminiUsage(50_000, 10_000, 'gemini-3.5-flash-lite');
    expect(usage1.totalTokens).toBe(60_000);
    expect(usage1.requestsCount).toBe(1);
    expect(usage1.estimatedSpendInr).toBeGreaterThan(0);
    expect(checkGeminiDailyBudget().allowed).toBe(true);

    // Simulate reaching ₹100 threshold
    // 15,000,000 output tokens on flash = ~$4.50 USD * 90 = ~₹405 INR
    const usage2 = recordGeminiUsage(100_000, 15_000_000, 'gemini-3.5-flash-lite');
    expect(usage2.estimatedSpendInr).toBeGreaterThanOrEqual(100);
    expect(usage2.remainingInr).toBe(0);

    // Now budget check must block further requests
    const checkBlocked = checkGeminiDailyBudget();
    expect(checkBlocked.allowed).toBe(false);
    expect(checkBlocked.reason).toMatch(/Daily budget cap of ₹100 INR reached/);
  });
});
