import { describe, expect, it } from 'vitest';
import { equalPowerCrossfade, SAFETY_CEILING, SAFETY_KNEE } from '../src/audio/engine/AudioGraph';

describe('equalPowerCrossfade', () => {
  it('gives 1.0 to Deck A and 0.0 to Deck B at full left (-1)', () => {
    const [gainA, gainB] = equalPowerCrossfade(-1);
    expect(gainA).toBeCloseTo(1.0, 3);
    expect(gainB).toBeCloseTo(0.0, 3);
  });

  it('gives 0.0 to Deck A and 1.0 to Deck B at full right (+1)', () => {
    const [gainA, gainB] = equalPowerCrossfade(1);
    expect(gainA).toBeCloseTo(0.0, 3);
    expect(gainB).toBeCloseTo(1.0, 3);
  });

  it('preserves equal power (gainA^2 + gainB^2 == 1) at center (0)', () => {
    const [gainA, gainB] = equalPowerCrossfade(0);
    expect(gainA).toBeCloseTo(Math.SQRT1_2, 3);
    expect(gainB).toBeCloseTo(Math.SQRT1_2, 3);
    const totalPower = gainA * gainA + gainB * gainB;
    expect(totalPower).toBeCloseTo(1.0, 3);
  });

  it('clamps values beyond -1 and +1 safely', () => {
    const [gainA, gainB] = equalPowerCrossfade(-2.5);
    expect(gainA).toBeCloseTo(1.0, 3);
    expect(gainB).toBeCloseTo(0.0, 3);

    const [gainA2, gainB2] = equalPowerCrossfade(3.0);
    expect(gainA2).toBeCloseTo(0.0, 3);
    expect(gainB2).toBeCloseTo(1.0, 3);
  });

  it('has safety constants properly bounded', () => {
    expect(SAFETY_KNEE).toBeGreaterThan(0.5);
    expect(SAFETY_CEILING).toBeGreaterThan(SAFETY_KNEE);
    expect(SAFETY_CEILING).toBeLessThan(1.0);
  });
});

