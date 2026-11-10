/**
 * Gemini Token Budget & Spending Limiter
 * Enforces a daily hard limit (e.g. ₹100 INR / day) on Gemini API token usage
 * to prevent accidental drain of the user's account balance.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths';
import { writeJsonAtomic } from './jsonFile';

export const GEMINI_USAGE_FILE = path.join(DATA_DIR, 'gemini_usage.json');

export interface GeminiDailyUsage {
  date: string; // YYYY-MM-DD (local)
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestsCount: number;
  estimatedSpendInr: number;
  dailyLimitInr: number;
  remainingInr: number;
  lastUpdated: number;
}

/**
 * Returns the daily limit in INR.
 * Gemini max limit capping is completely removed/disabled per user request (returns 0 = uncapped).
 * If a custom limit is explicitly passed in process.env.GEMINI_DAILY_LIMIT_INR (e.g. in tests), it is supported.
 */
export function getDailyLimitInr(): number {
  const envVal = process.env.GEMINI_DAILY_LIMIT_INR;
  if (envVal !== undefined && envVal.trim() !== '') {
    const num = Number(envVal);
    if (!isNaN(num) && num > 0) return num;
  }
  return 0; // Uncapped by default (0 = no max limit capping)
}

/** Formats today's local date as YYYY-MM-DD */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Milliseconds until next midnight (00:00:00 local time) */
export function getMsUntilMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, tomorrow.getTime() - now.getTime());
}

/**
 * Calculates estimated cost in Indian Rupees (INR) based on token counts and model pricing.
 * Flash / Flash-Lite: $0.075 / 1M input, $0.30 / 1M output.
 * Exchange rate: ₹90 / USD (conservative, includes 18% GST buffer & forex fee).
 */
export function estimateCostInr(inputTokens: number, outputTokens: number, model: string): number {
  const isPro = /pro/i.test(model);
  const inputCostUsdPerMillion = isPro ? 1.25 : 0.075;
  const outputCostUsdPerMillion = isPro ? 5.00 : 0.30;
  const usdToInr = 90; // ₹90 per USD (covers $1 = ~₹88.50 + 18% GST buffer)

  const inputCostInr = (inputTokens / 1_000_000) * inputCostUsdPerMillion * usdToInr;
  const outputCostInr = (outputTokens / 1_000_000) * outputCostUsdPerMillion * usdToInr;
  return inputCostInr + outputCostInr;
}

/** Loads or initializes today's Gemini usage ledger */
export function getGeminiDailyUsage(): GeminiDailyUsage {
  const today = getTodayDateString();
  const limit = getDailyLimitInr();

  let data: any = null;
  try {
    if (fs.existsSync(GEMINI_USAGE_FILE)) {
      data = JSON.parse(fs.readFileSync(GEMINI_USAGE_FILE, 'utf-8'));
    }
  } catch {
    data = null;
  }

  if (!data || data.date !== today) {
    // New day or first run: initialize fresh ledger for today
    data = {
      date: today,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestsCount: 0,
      estimatedSpendInr: 0,
      dailyLimitInr: limit,
      remainingInr: limit > 0 ? limit : 0,
      lastUpdated: Date.now(),
    };
    try {
      writeJsonAtomic(GEMINI_USAGE_FILE, data);
    } catch {
      // ignore
    }
  } else {
    data.dailyLimitInr = limit;
    data.remainingInr = limit > 0 ? Math.max(0, Number((limit - (data.estimatedSpendInr || 0)).toFixed(4))) : 0;
  }

  return data as GeminiDailyUsage;
}

/** Checks whether another Gemini API call is permitted under today's budget (uncapped when dailyLimitInr <= 0) */
export function checkGeminiDailyBudget(): { allowed: boolean; reason?: string; usage: GeminiDailyUsage } {
  const usage = getGeminiDailyUsage();
  if (usage.dailyLimitInr > 0 && usage.estimatedSpendInr >= usage.dailyLimitInr) {
    const msLeft = getMsUntilMidnight();
    const hoursLeft = Math.ceil(msLeft / 3_600_000);
    return {
      allowed: false,
      reason: `Daily budget cap of ₹${usage.dailyLimitInr.toFixed(0)} INR reached (spent ₹${usage.estimatedSpendInr.toFixed(2)} today across ${usage.requestsCount} requests). Gemini cloud calls paused for ~${hoursLeft}h until midnight to safeguard your balance. Local Ollama and rule-based DJ decisions are active.`,
      usage,
    };
  }
  return { allowed: true, usage };
}

/** Records token usage from a completed Gemini API call */
export function recordGeminiUsage(inputTokens: number, outputTokens: number, model: string): GeminiDailyUsage {
  const usage = getGeminiDailyUsage();
  const cost = estimateCostInr(inputTokens, outputTokens, model);

  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.totalTokens += inputTokens + outputTokens;
  usage.requestsCount += 1;
  usage.estimatedSpendInr = Number((usage.estimatedSpendInr + cost).toFixed(4));
  usage.remainingInr = Math.max(0, Number((usage.dailyLimitInr - usage.estimatedSpendInr).toFixed(4)));
  usage.lastUpdated = Date.now();

  try {
    writeJsonAtomic(GEMINI_USAGE_FILE, usage);
  } catch (err) {
    console.error('[Gemini Budget Guard] Failed to persist usage:', err);
  }

  return usage;
}

