/**
 * What the phone remote receives from the laptop.
 *
 * The full state (~50 KB: queue, history, favourites…) is sent only when its slow parts change,
 * which syncSignature() detects cheaply; otherwise just the live part (under 1 KB: time, mix
 * progress, rhythm status…), several times a second. See App.tsx broadcastSyncState.
 */
import type { AudioEngine } from '../AudioEngine';
import { PLAY_LOG_MAX } from './SongLibrary';
import type { HostSyncState, LiveSyncState } from '../../types';

export function buildSyncState(engine: AudioEngine): HostSyncState {
  const curState = engine.getOnAirDeck().getPlaybackState();
  // Decoded audio, analysis envelopes and peaks are large; keep them out of the broadcast
  const currentTrack = curState.track
    ? { ...curState.track, audioBuffer: undefined, originalBuffer: undefined, energyProfile: undefined }
    : null;
  return {
    ...buildLiveSyncState(engine),
    type: 'SYNC_STATE',
    currentTrack,
    queue: engine.queue.map((q) => ({
      ...q,
      audioBuffer: undefined,
      originalBuffer: undefined,
      energyProfile: undefined,
      waveformPeaks: undefined,
    })),
    mostPlayedSongs: engine.mostPlayedSongs,
    favorites: engine.favorites,
    bannedSongs: engine.bannedSongs,
    recentlyPlayed: engine.dedupeConsecutivePlayLog(engine.playLog).slice(0, PLAY_LOG_MAX), // all of Previously Played (100)
    introAnalysis: curState.track ? engine.getIntroAnalysis(curState.track.id) : null,
  };
}

export function buildLiveSyncState(engine: AudioEngine): LiveSyncState {
  const curState = engine.getOnAirDeck().getPlaybackState();
  return {
    type: 'SYNC_LIVE',
    activeDeck: engine.activeDeck,
    isPlaying: curState.isPlaying,
    currentTime: curState.currentTime,
    duration: curState.duration,
    bpm: curState.effectiveBpm,
    crossfader: engine.getCrossfader(),
    rhythm: engine.rhythm.getState(),
    acquisitionStatus: engine.acquisitionStatus,
    pendingMix: engine.getPendingMixInfo(),
    isTransitioning: engine.isTransitioning,
    transitionProgress: engine.transitionProgress,
    autoCurationEnabled: engine.autoCurationEnabled,
    bestPartsMode: engine.bestPartsMode,
    mood: engine.mood,
    eqGains: engine.eqGains,
    sessionBpm: engine.sessionBpm,
    aiStatus: engine.aiStatus,
    lastAiDecision: engine.lastAiDecision,
    tempo: engine.getTempoInfo(),
    masterVolume: engine.masterVolume,
    aiProvider: engine.aiProvider,
    aiModelName: engine.aiModelName,
    isAiThinking: engine.isAiThinking,
    aiResult: engine.lastAiResult,
  };
}

/** A cheap fingerprint of the slow parts (queue, history, favourites, the song on air). */
export function syncSignature(engine: AudioEngine): string {
  const track = engine.getOnAirDeck().getTrack();
  const queue = engine.queue
    .map((q) => `${q.id}:${q.status}:${q.bpm ?? ''}:${q.tempoLockedTo ?? ''}:${q.isDiskCached ? 1 : 0}:${q.lastPlayedAt ?? ''}`)
    .join(',');
  return [
    queue,
    track ? `${track.id}:${track.bpm}:${track.highlightTime ?? ''}:${track.musicStartTime ?? ''}` : '-',
    engine.playLog.length,
    engine.playLog[0]?.playedAt,
    engine.getTopBangers().length,
    engine.getTopBangersKey(),
    engine.favorites.length,
    engine.favorites[0]?.id,
    engine.bannedSongs.length,
    engine.bannedSongs[0]?.id,
    track ? (engine.getIntroAnalysis(track.id) ? 1 : 0) : 0,
  ].join('|');
}
