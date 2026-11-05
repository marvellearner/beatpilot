import { describe, expect, it } from 'vitest';
import type { QueuedTrack } from '../src/types';
import {
  inferSongVibe,
  isSongVibeCompatible,
  detectPrevailingVibe,
  alignQueueTopWithVibe,
} from '../src/audio/engine/queueRules';
import { scoreCandidate, chooseNext, type FlowCandidate, type FlowContext } from '../src/audio/engine/setFlow';

const track = (id: string, title: string, artist = 'Artist', extra: Partial<QueuedTrack> = {}): QueuedTrack =>
  ({ id, title, artist, duration: 200, url: `search:${id}`, status: 'queued', ...extra }) as QueuedTrack;

describe('Vibe Detection & Set Alignment (Previous 3-5 Songs)', () => {
  describe('inferSongVibe', () => {
    it('correctly classifies romantic ballads vs dance party bangers', () => {
      expect(inferSongVibe({ title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan - Topic' })).toBe('romantic');
      expect(inferSongVibe({ title: 'Gehra Hua', artist: 'Arijit Singh' })).toBe('romantic');
      expect(inferSongVibe({ title: 'Tum Hi Ho', artist: 'Arijit Singh' })).toBe('romantic');
      expect(inferSongVibe({ title: 'Kasoor (Acoustic)', artist: 'Prateek Kuhad' })).toBe('romantic');

      expect(inferSongVibe({ title: 'Sadi Gali Full Song Tanu Weds Manu', artist: 'T-Series' })).toBe('dance');
      expect(inferSongVibe({ title: 'Tera Yaar Bolda', artist: 'Surjit Bindrakhia' })).toBe('bhangra');
      expect(inferSongVibe({ title: 'OG', artist: 'Karan Aujla' })).toBe('dance');
      expect(inferSongVibe({ title: 'Gasolina (Bhangra Remix)', artist: 'Daddy Yankee' })).toBe('bhangra');
      expect(inferSongVibe({ title: 'Lean On', artist: 'Major Lazer & DJ Snake' })).toBe('dance');
      expect(inferSongVibe({ title: 'Daru Badnaam', artist: 'Kamal Kahlon & Param Singh' })).toBe('dance');
      expect(inferSongVibe({ title: 'Mitran De Boot', artist: 'Jazzy B' })).toBe('bhangra');
    });

    it('gives dance remix priority even when sung by a romantic artist', () => {
      expect(inferSongVibe({ title: 'Tum Hi Ho (Club Remix / DJ Party Mix)', artist: 'Arijit Singh' })).toBe('dance');
    });
  });

  describe('isSongVibeCompatible', () => {
    it('rejects slow romantic ballads when target vibe is dance or bhangra', () => {
      expect(isSongVibeCompatible('dance', { title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan' })).toBe(false);
      expect(isSongVibeCompatible('dance', { title: 'Gehra Hua', artist: 'Arijit Singh' })).toBe(false);
      expect(isSongVibeCompatible('dance', { title: 'Baarishein', artist: 'Anuv Jain' })).toBe(false);
      expect(isSongVibeCompatible('bhangra', { title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan' })).toBe(false);

      expect(isSongVibeCompatible('dance', { title: 'Sadi Gali', artist: 'T-Series' })).toBe(true);
      expect(isSongVibeCompatible('dance', { title: 'Tera Yaar Bolda', artist: 'Surjit Bindrakhia' })).toBe(true);
      expect(isSongVibeCompatible('dance', { title: 'Brown Munde', artist: 'AP Dhillon' })).toBe(true);
    });

    it('rejects dance bangers when target vibe is romantic', () => {
      expect(isSongVibeCompatible('romantic', { title: 'Gasolina (Remix)', artist: 'Daddy Yankee' })).toBe(false);
      expect(isSongVibeCompatible('romantic', { title: 'Mitran De Boot', artist: 'Jazzy B' })).toBe(false);
      expect(isSongVibeCompatible('romantic', { title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan' })).toBe(true);
    });
  });

  describe('detectPrevailingVibe', () => {
    it('detects dance vibe when the previous 3-5 songs were dance/bhangra', () => {
      const recentSession = [
        { title: 'Sadi Gali', artist: 'T-Series' },
        { title: 'Tera Yaar Bolda', artist: 'Surjit Bindrakhia' },
        { title: 'OG', artist: 'Karan Aujla' },
        { title: 'Gasolina (Remix)', artist: 'Daddy Yankee' },
        { title: 'VIBE', artist: 'Diljit Dosanjh' },
      ];
      expect(detectPrevailingVibe(recentSession)).toBe('dance');
    });

    it('detects dance vibe with 3 out of 4 songs', () => {
      const recentSession = [
        { title: 'Tera Yaar Bolda', artist: 'Surjit Bindrakhia' },
        { title: 'Sadi Gali', artist: 'T-Series' },
        { title: 'OG', artist: 'Karan Aujla' },
        { title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan' },
      ];
      expect(detectPrevailingVibe(recentSession)).toBe('dance');
    });

    it('detects romantic vibe when majority of previous songs are romantic', () => {
      const romanticSession = [
        { title: 'Tune Jo Na Kaha', artist: 'Mohit Chauhan' },
        { title: 'Tum Hi Ho', artist: 'Arijit Singh' },
        { title: 'Baarishein', artist: 'Anuv Jain' },
        { title: 'Sadi Gali', artist: 'T-Series' },
      ];
      expect(detectPrevailingVibe(romanticSession)).toBe('romantic');
    });

    it('returns null when history has fewer than 3 songs', () => {
      expect(detectPrevailingVibe([{ title: 'Sadi Gali', artist: 'T-Series' }])).toBeNull();
    });
  });

  describe('alignQueueTopWithVibe', () => {
    it('ensures top 10 queue songs match the prevailing dance vibe by pushing ballads down', () => {
      const initialQueue = [
        track('q0', 'Current Loading', 'Artist'), // keepTop slot
        track('q1', 'Tune Jo Na Kaha', 'Mohit Chauhan'), // romantic ballad
        track('q2', 'Gehra Hua', 'Arijit Singh'), // romantic ballad
        track('q3', 'Brown Munde', 'AP Dhillon'),
        track('q4', 'Lover', 'Diljit Dosanjh'),
        track('q5', '295', 'Sidhu Moose Wala'),
        track('q6', 'Winning Speech', 'Karan Aujla'),
        track('q7', 'Lean On', 'Major Lazer'),
        track('q8', 'Gasolina', 'Daddy Yankee'),
        track('q9', 'Daru Badnaam', 'Kamal Kahlon'),
        track('q10', 'Mitran De Boot', 'Jazzy B'),
        track('q11', 'Morni', 'Diljit Dosanjh'),
        track('q12', 'Kabira', 'Arijit Singh'), // romantic ballad
        track('q13', 'Angreji Beat', 'Honey Singh'),
      ];

      const aligned = alignQueueTopWithVibe(initialQueue, 'dance', 10, 1);

      // Slot 0 (loading track) kept
      expect(aligned[0].id).toBe('q0');

      // The top 10 slots (indices 0..9) must ALL be compatible with dance
      const top10 = aligned.slice(0, 10);
      for (let i = 1; i < 10; i++) {
        expect(isSongVibeCompatible('dance', top10[i])).toBe(true);
      }

      // "Tune Jo Na Kaha" and "Gehra Hua" must NOT be in top 10
      expect(top10.map((t) => t.title)).not.toContain('Tune Jo Na Kaha');
      expect(top10.map((t) => t.title)).not.toContain('Gehra Hua');

      // But they are preserved further down in the queue (indices 10+)
      const rest = aligned.slice(10);
      expect(rest.map((t) => t.title)).toContain('Tune Jo Na Kaha');
      expect(rest.map((t) => t.title)).toContain('Gehra Hua');
    });

    it('preserves user guest requests even if differing in vibe', () => {
      const initialQueue = [
        track('q0', 'Dance Opener', 'AP Dhillon'),
        track('req1', 'Tune Jo Na Kaha', 'Mohit Chauhan', { source: 'request' }),
        track('q2', 'Lover', 'Diljit Dosanjh'),
      ];

      const aligned = alignQueueTopWithVibe(initialQueue, 'dance', 10, 1);
      // Explicit guest request stays in place
      expect(aligned[1].id).toBe('req1');
    });
  });

  describe('setFlow dancefloor protection', () => {
    it('penalizes slow romantic songs and forbids them from taking a breather bonus on a dance floor', () => {
      const currentTrack: FlowCandidate = {
        title: 'Sadi Gali',
        artist: 'T-Series',
        bpm: 130,
        loudnessDb: -6,
        keyFit: 'good',
        requested: false,
      };

      const romanticBallad: FlowCandidate = {
        title: 'Tune Jo Na Kaha',
        artist: 'Mohit Chauhan',
        bpm: 80,
        loudnessDb: -10, // would otherwise look like a quieter track
        keyFit: 'good',
        requested: false,
      };

      const danceTrack: FlowCandidate = {
        title: 'Lover',
        artist: 'Diljit Dosanjh',
        bpm: 128,
        loudnessDb: -7,
        keyFit: 'good',
        requested: false,
      };

      const ctx: FlowContext = {
        current: currentTrack,
        recentArtists: ['Surjit Bindrakhia', 'Karan Aujla'],
        languageRun: 3,
        danceFloor: true,
        peakRun: 7, // peak run >= 5 (breatherDue = true)
        prevailingVibe: 'dance',
      };

      const balladScore = scoreCandidate(romanticBallad, 0, ctx);
      const danceScore = scoreCandidate(danceTrack, 1, ctx);

      // Ballad receives severe penalty and no breather bonus
      expect(balladScore.bad).toContain('a slow romantic song on a dance floor');
      expect(balladScore.score).toBeLessThan(danceScore.score);

      // chooseNext picks the dance track over the ballad even if ballad is index 0
      const nextChoice = chooseNext([romanticBallad, danceTrack], ctx);
      expect(nextChoice.pick.title).toBe('Lover');
    });
  });
});

