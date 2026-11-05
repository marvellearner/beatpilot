import { describe, expect, it } from 'vitest';
import { RHYTHM_STYLES, getRhythmStyle } from '../src/audio/rhythm/styles';
import { barHits } from '../src/audio/rhythm/dholEvents';
import { planDholScore } from '../src/audio/rhythm/dholScore';
import { computeVocalMap, planRhythm, type SongRhythmFeatures } from '../src/audio/rhythm/rhythmPlan';
import { parseRhythmCue } from '../src/ai/DJAgent';

const BEAT = 0.6; // 100 BPM

describe('taals', () => {
  it('are dhol / dholak only, with valid 16-step bars', () => {
    expect(RHYTHM_STYLES.map((s) => s.id).sort()).toEqual(['bhangra_chaal', 'dhol_dhamaal', 'dholak_keherwa', 'luddi']);
    for (const s of RHYTHM_STYLES) {
      const all = [...Object.values(s.light), ...Object.values(s.groove), ...Object.values(s.break)].flat();
      all.push(...(Object.values(s.answer) as string[]));
      for (const bar of all) expect(bar).toMatch(/^[Xxom F.]{16}$/);
      for (const bars of Object.values(s.break)) expect(bars).toHaveLength(2);
      // The answer is a phrase on beats 3–4 only
      for (const bar of Object.values(s.answer) as string[]) {
        expect(bar.slice(0, 8)).toBe('........');
        expect(bar.slice(8)).not.toBe('........');
      }
    }
  });
});

describe('strokes of a bar', () => {
  const chaal = getRhythmStyle('bhangra_chaal');

  it('a roll replaces the rest of the bar, getting louder up to the bar line', () => {
    const hits = barHits(chaal, { kind: 'groove', variation: 0 }, { roll: { fromBeat: 2 } }, 0, BEAT);
    const roll = hits.filter((h) => h.beat >= 2 && h.voice === chaal.treble);
    expect(roll.length).toBeGreaterThanOrEqual(12); // ~14 strokes a second over 2 beats
    for (let i = 1; i < roll.length; i++) expect(roll[i].velocity).toBeGreaterThanOrEqual(roll[i - 1].velocity);
    expect(Math.max(...hits.map((h) => h.beat))).toBeLessThan(4);
    // Nothing from the groove pattern is left after the roll starts: the only bass strokes there
    // are the roll's own, on beats 2 and 3 (the groove's bass has swung off-beat strokes)
    expect(hits.filter((h) => h.beat >= 2 && h.voice === chaal.bass).map((h) => h.beat)).toEqual([2, 3]);
  });

  it('a tihai is one phrase three times, louder each time, its last stroke landing on the next 1', () => {
    const hits = barHits(chaal, { kind: 'groove', variation: 0 }, { tihai: true }, 0, BEAT).filter((h) => h.voice === chaal.treble);
    expect(hits.map((h) => h.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(hits[6].velocity).toBeGreaterThan(hits[0].velocity);
  });

  it('an accent is a full boom on the 1 with a flammed crack (grace stroke just before)', () => {
    const hits = barHits(chaal, { kind: 'groove', variation: 0 }, { accent: true }, 0, BEAT);
    expect(hits.find((h) => h.beat === 0 && h.voice === chaal.bass)?.velocity).toBeGreaterThan(1);
    const grace = hits.find((h) => h.beat < 0);
    expect(grace?.voice).toBe(chaal.treble);
    expect(grace!.beat * BEAT).toBeCloseTo(-0.022, 3);
  });

  it('an answer plays the light taal, then the answer phrase on beats 3–4', () => {
    const plain = barHits(chaal, { kind: 'light' }, {}, 0, BEAT);
    const answered = barHits(chaal, { kind: 'light', answer: true }, {}, 0, BEAT);
    expect(answered.filter((h) => h.beat < 2)).toEqual(plain.filter((h) => h.beat < 2));
    expect(answered.filter((h) => h.beat >= 2).length).toBeGreaterThan(plain.filter((h) => h.beat >= 2).length);
  });

  it('a rest bar is silent', () => {
    expect(barHits(chaal, { kind: 'rest' }, {}, 0, BEAT)).toEqual([]);
  });
});

/** A synthetic song: per bar, a loudness and whether someone sings in each half of the bar. */
function song(bars: Array<[loud: number, singFirst: boolean, singSecond: boolean]>) {
  const barSeconds = 4 * BEAT;
  const rate = 10;
  const n = Math.ceil(bars.length * barSeconds * rate);
  const full = new Float32Array(n);
  const vocal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const b = Math.min(bars.length - 1, Math.floor(t / barSeconds));
    const firstHalf = (t % barSeconds) < barSeconds / 2;
    full[i] = bars[b][0];
    vocal[i] = (firstHalf ? bars[b][1] : bars[b][2]) ? 1 : 0.05;
  }
  return {
    profile: { rate, full, mid: full },
    vocal: { rate, values: vocal, duration: n / rate },
    barSeconds,
    downbeat: 0,
    duration: bars.length * barSeconds,
  };
}

describe('the dhol wala score', () => {
  const quiet: [number, boolean, boolean] = [0.2, false, false];
  const verseLine: [number, boolean, boolean] = [0.7, true, false]; // sings, then a gap
  const verseFull: [number, boolean, boolean] = [0.7, true, true];
  const chorus: [number, boolean, boolean] = [1, true, true];
  const instrumental: [number, boolean, boolean] = [0.8, false, false];
  const bars = [
    ...Array(4).fill(quiet), // 0-3 intro
    ...Array(8).fill(verseLine), // 4-11 verse with gaps between lines
    ...Array(8).fill(chorus), // 12-19 chorus
    ...Array(4).fill(verseFull), // 20-23 verse, no gaps
    ...Array(4).fill(instrumental), // 24-27 instrumental break
    ...Array(4).fill(verseFull), // 28-31
  ];
  const score = planDholScore(song(bars));

  it('stays out of the quiet intro and keeps time softly under the verse', () => {
    expect(score.slice(0, 3).every((b) => b.role === 'out')).toBe(true);
    expect(score.slice(4, 11).every((b) => b.role === 'light')).toBe(true);
  });

  it('answers in the gaps between vocal lines, at most every other bar, never when there is no gap', () => {
    const answers = score.map((b, i) => (b.answer ? i : -1)).filter((i) => i >= 0);
    expect(answers.length).toBeGreaterThanOrEqual(3);
    expect(answers.every((i) => i >= 4 && i <= 11)).toBe(true);
    for (let k = 1; k < answers.length; k++) expect(answers[k] - answers[k - 1]).toBeGreaterThanOrEqual(2);
    expect(score.slice(20, 24).some((b) => b.answer)).toBe(false);
  });

  it('rolls into the chorus, lands it with an accent, and closes it with a tihai', () => {
    expect(score[11].roll).toBe(true);
    expect(score[12].role).toBe('groove');
    expect(score[12].accent).toBe(true);
    expect(score[19].tihai).toBe(true);
    expect(score[20].accent).toBe(true); // the tihai lands
  });

  it('plays the full taal in an instrumental part (nobody singing, music going)', () => {
    expect(score.slice(24, 28).every((b) => b.role === 'groove')).toBe(true);
  });
});

describe('vocal map', () => {
  it('hears a centred voice-range sound, not a wide stereo one', () => {
    const sr = 8000;
    const seconds = 4;
    const L = new Float32Array(sr * seconds);
    const R = new Float32Array(sr * seconds);
    for (let i = 0; i < L.length; i++) {
      const t = i / sr;
      const centre = t < 2 ? 0.5 * Math.sin(2 * Math.PI * 800 * t) : 0; // first half: a centred "voice"
      const wide = t >= 2 ? 0.5 * Math.sin(2 * Math.PI * 800 * t) : 0; // second half: L = -R (a wide pad)
      L[i] = centre + wide;
      R[i] = centre - wide;
    }
    const buffer = { sampleRate: sr, length: L.length, numberOfChannels: 2, getChannelData: (c: number) => (c ? R : L) } as unknown as AudioBuffer;
    const map = computeVocalMap(buffer);
    const avg = (from: number, to: number) => {
      const v = map.values.slice(from * map.rate, to * map.rate);
      return v.reduce((s, x) => s + x, 0) / v.length;
    };
    expect(avg(0.5, 1.5)).toBeGreaterThan(0.6);
    expect(avg(2.5, 3.5)).toBeLessThan(0.1);
  });
});

describe('which songs get the dhol', () => {
  const feat: SongRhythmFeatures = { midShare: 0.5, contrastDb: 6, punch: 0.11 };
  const song = (title: string, bpm = 100) => ({ title, artist: '', bpm, bpmConfidence: 0.9 });

  it('Punjabi: bhangra chaal; folk titles: luddi; chill: dholak', () => {
    expect(planRhythm(song('Lover'), 'party', feat, 'punjabi', 'known')).toMatchObject({ play: true, styleId: 'bhangra_chaal' });
    expect(planRhythm(song('Boliyan'), 'normal', feat, 'punjabi', 'known')).toMatchObject({ play: true, styleId: 'luddi' });
    expect(planRhythm(song('Lover'), 'chill', feat, 'punjabi', 'known')).toMatchObject({ play: true, styleId: 'dholak_keherwa' });
  });

  it('Hindi: dhol when people dance, dholak otherwise', () => {
    expect(planRhythm(song('Kar Gayi Chull', 120), 'party', feat, 'hindi', 'ai').styleId).toBe('bhangra_chaal');
    expect(planRhythm(song('Kesariya', 92), 'normal', feat, 'hindi', 'ai').styleId).toBe('dholak_keherwa');
  });

  it('no dhol on English pop, devotional songs or an unclear beat, unless Bhangra mood', () => {
    expect(planRhythm(song('Blinding Lights', 171), 'party', feat, 'english', 'ai').play).toBe(false);
    expect(planRhythm(song('Blinding Lights', 171), 'bhangra', feat, 'english', 'ai')).toMatchObject({ play: true, styleId: 'bhangra_chaal' });
    expect(planRhythm(song('Hanuman Chalisa'), 'party', feat, 'hindi', 'known').play).toBe(false);
    expect(planRhythm({ ...song('Lover'), bpmConfidence: 0.3 }, 'party', feat, 'punjabi', 'known').play).toBe(false);
  });

  it('soft drums at a dance: the dhol carries the beat with dhamaal', () => {
    expect(planRhythm(song('Lover'), 'party', { ...feat, punch: 0.08 }, 'punjabi', 'known').styleId).toBe('dhol_dhamaal');
  });
});

describe('live cues in words', () => {
  it.each([
    ['dhol roll', 'roll'],
    ['give me a dhol break', 'break'],
    ['dhol solo please', 'break'],
    ['dhamaal!', 'dhamaal'],
    ['dhol full power', 'dhamaal'],
    ['rest the dhol', 'rest'],
    ['let the dhol breathe', 'rest'],
  ])('"%s" -> %s', (text, cue) => expect(parseRhythmCue(text)).toBe(cue));

  it('ignores requests that are not cues', () => {
    expect(parseRhythmCue('play dhol')).toBeNull();
    expect(parseRhythmCue('play Lover by Diljit')).toBeNull();
    // A mixing transition, not a dhol cue
    expect(parseRhythmCue('do a stutter loop roll into the next song')).toBeNull();
  });
});
