/**
 * Set flow: which of the next few ready songs plays next, when the AI DJ isn't choosing.
 * A DJ doesn't just take the queue in order: no artist twice in a row, keys that fit, small
 * tempo steps, a few songs in one language before switching, and no deflating energy drop on a
 * dance floor. Guest requests are never skipped. Rules: MIXING_RULES.md "Set Flow".
 */

export interface FlowSong {
  title: string;
  artist: string;
  bpm?: number;
  loudnessDb?: number;
  language?: string; // from guessLanguage, only when it was sure
}

export interface FlowCandidate extends FlowSong {
  requested: boolean; // a guest request: never skipped
  keyFit: 'good' | 'ok' | 'clash' | 'unknown';
}

export interface FlowContext {
  current: FlowSong;
  recentArtists: string[]; // artists of the songs before the current one, newest first
  languageRun: number; // how many songs in a row (incl. the current) were in the current one's language
  danceFloor: boolean; // Party / Bhangra mood: keep the energy up
}

const LOOK_AHEAD = 3; // only the next 3 ready songs are considered
const LANGUAGE_RUN = 3; // songs in one language before a switch is welcome
const QUIET_DROP_DB = 3; // this much quieter than the song on air deflates a dance floor

const norm = (s: string) => s.toLowerCase().replace(/vevo$/, '').replace(/[^\p{L}\p{N}]/gu, '');
const sameArtist = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};

/** Tempo change between two songs, allowing half / double time (0.05 = 5 %). */
export function tempoStep(a?: number, b?: number): number | null {
  if (!a || !b) return null;
  return Math.min(...[0.5, 1, 2].map((m) => Math.abs((b * m) / a - 1)));
}

/** A candidate's score and the reasons (shown when it isn't simply the next in line). */
export function scoreCandidate(c: FlowCandidate, index: number, ctx: FlowContext): { score: number; good: string[]; bad: string[] } {
  const good: string[] = [];
  const bad: string[] = [];
  let score = -0.6 * index; // the queue order still counts

  if (sameArtist(c.artist, ctx.current.artist) || ctx.recentArtists.slice(0, 1).some((a) => sameArtist(c.artist, a))) {
    score -= 3;
    bad.push('same artist again');
  } else good.push('a different artist');

  if (c.keyFit === 'good') {
    score += 1;
    good.push('its key fits');
  } else if (c.keyFit === 'clash') {
    score -= 2;
    bad.push('its key clashes');
  }

  const step = tempoStep(ctx.current.bpm, c.bpm);
  if (step !== null) {
    if (step > 0.16) {
      score -= 2;
      bad.push('a big tempo jump');
    } else if (step > 0.08) {
      score -= 1;
      bad.push('a large tempo change');
    } else if (step <= 0.04) {
      score += 0.5;
      good.push('a smooth tempo step');
    }
  }

  if (c.language && ctx.current.language && c.language !== ctx.current.language && ctx.languageRun < LANGUAGE_RUN) {
    score -= 0.7;
    bad.push('a language switch too soon');
  }

  if (ctx.danceFloor && c.loudnessDb !== undefined && ctx.current.loudnessDb !== undefined && c.loudnessDb < ctx.current.loudnessDb - QUIET_DROP_DB) {
    score -= 1;
    bad.push('an energy drop');
  }
  return { score, good, bad };
}

/**
 * The next song: the first ready one, unless one of the next few flows clearly better from the
 * song on air. A guest request first in line always plays; requests further back keep their place.
 */
export function chooseNext<T extends FlowCandidate>(ready: T[], ctx: FlowContext): { pick: T; reason?: string } {
  const first = ready[0];
  if (first.requested) return { pick: first };
  const options = ready.slice(0, LOOK_AHEAD).filter((c, i) => i === 0 || !c.requested);
  const scored = options.map((c, i) => ({ c, ...scoreCandidate(c, i, ctx) }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.c === first) return { pick: first };
  const firstScore = scored[0];
  const why = [...best.good.slice(0, 2), ...firstScore.bad.slice(0, 1).map((b) => `"${first.title}" would be ${b}`)];
  return { pick: best.c, reason: why.join('; ') };
}
