import React, { useState, useCallback, useMemo } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { useEnginePlayback, useEngineMood } from '../hooks/useEngineStore';
import { SyncedVideoPlayer } from './SyncedVideoPlayer';
import { VuMeter } from './VuMeter';
import { TempoControl } from './TempoControl';
import { MusicLevelControl } from './MusicLevelControl';
import { getCamelotDetails } from '../../audio/KeyDetector';
import { isStrictStartSong } from '../../audio/songMatch';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Square,
  Heart,
  ThumbsDown,
  Flame,
  Lock,
  Scissors,
  Target,
  Video,
  VideoOff,
  Disc3,
} from 'lucide-react';

interface NowPlayingHeroProps {
  engine: AudioEngine;
  formatTime: (secs: number) => string;
}

export const NowPlayingHero: React.FC<NowPlayingHeroProps> = ({ engine, formatTime }) => {
  const playback = useEnginePlayback(engine);
  const moodState = useEngineMood(engine);

  const [videoEnabled, setVideoEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('ai_dj_video_enabled') === '1';
    } catch {
      return false;
    }
  });

  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('ai_dj_video_enabled', next ? '1' : '0');
      } catch {
        // Storage unavailable
      }
      return next;
    });
  }, []);

  const activeDeck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    remaining,
    progress,
    playbackRate,
    loop,
    loopInTime,
    hasLastLoop,
    isTransitioning,
    transitionProgress,
    pendingMix,
    cueRatio,
    hookRatios,
    hookTimes,
    originalBpm,
    effectiveBpm,
    peaks,
    deckStatus,
  } = playback;

  const currentEffectiveBpm = effectiveBpm ?? (currentTrack?.bpm || 128);

  const markerRatio = (time?: number) =>
    duration > 0 && time !== undefined && time > 0 && time < duration ? time / duration : null;

  // The waveform bars only rebuild when the track's peaks change; playhead moves clip over them
  const waveBars = useMemo(() => {
    const bars = (color: string) =>
      (peaks ?? Array.from({ length: 120 }, () => 0.15)).map((peak, i) => (
        <div
          key={i}
          className={`flex-1 rounded-full ${color}`}
          style={{ height: `${Math.max(6, Math.min(100, peak * 100))}%` }}
        />
      ));
    return { upcoming: bars('bg-slate-600/60'), played: bars('bg-cyan-400') };
  }, [peaks]);

  return (
    <div
      id="party-console-now-playing"
      className="dj-panel rounded-2xl border border-white/10 bg-gradient-to-b from-[#121826] to-[#0a0d16] shadow-xl overflow-hidden flex flex-col"
    >
      {/* Header strip: deck + live status */}
      <div
        id="party-console-now-playing-header"
        className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/[0.06] bg-black/20"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold tracking-[0.18em] text-slate-400">NOW PLAYING</span>
          <span
            id="party-console-deck-badge"
            className="text-[10px] font-bold tracking-wider text-slate-300 bg-white/5 border border-white/10 px-1.5 py-px rounded"
          >
            DECK {playback.activeDeckId}
          </span>
          {pendingMix?.harmonicShift && (
            <span
              id="party-console-pending-mix-harmonic-badge"
              className="flex items-center gap-1 text-[9px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm animate-pulse"
              title={`Next Mix Energy/Harmonic Transition: ${pendingMix.harmonicShift}`}
            >
              <span>⚡</span>
              <span>{pendingMix.harmonicShift}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            id="party-console-video-toggle"
            type="button"
            onClick={toggleVideo}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider border transition-all ${
              videoEnabled
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm'
                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
            }`}
            title={
              videoEnabled
                ? 'Video Display ON (click to turn off and save bandwidth)'
                : 'Video Display OFF (click to stream music video synced to deck)'
            }
          >
            {videoEnabled ? <Video className="w-3 h-3 text-rose-400" /> : <VideoOff className="w-3 h-3 text-slate-400" />}
            <span>VIDEO {videoEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <span
            id="party-console-deck-status"
            className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${deckStatus.className}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${deckStatus.dotClassName}`} />
            {deckStatus.label}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Optional Synced Live Video Stream */}
        {videoEnabled && (
          <SyncedVideoPlayer
            track={currentTrack}
            currentTime={currentTime}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            videoEnabled={videoEnabled}
            onToggleVideo={toggleVideo}
            onTogglePlay={() => engine.togglePlayCurrent()}
            incomingTrack={isTransitioning ? (engine.activeDeck === 'A' ? engine.deckB.getTrack() : engine.deckA.getTrack()) : null}
            isTransitioning={isTransitioning}
            transitionProgress={transitionProgress}
            className="mb-1"
          />
        )}

        {/* Hero: artwork, title/artist/chips, VU meter */}
        <div id="party-console-track-info" className="flex items-center gap-4">
          {!videoEnabled && (
            <div id="party-console-vinyl" className="relative shrink-0 w-28 h-28 sm:w-32 sm:h-32 mr-4">
              <div
                className={`absolute inset-y-1 -right-4 aspect-square rounded-full bg-[radial-gradient(circle,#1e293b_0%,#0b1120_45%,#020617_46%,#111827_60%,#020617_61%,#0f172a_100%)] border border-white/10 shadow-lg ${
                  isPlaying ? 'animate-spin [animation-duration:6s]' : ''
                }`}
                aria-hidden="true"
              />
              <div
                id="party-console-center-label-art"
                className={`relative w-full h-full rounded-xl overflow-hidden border shadow-2xl bg-gradient-to-br from-slate-800 to-slate-950 group transition-all duration-300 ${
                  currentTrack && engine.isFavorite(currentTrack)
                    ? 'border-rose-500/50 ring-2 ring-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.35)]'
                    : 'border-white/10'
                }`}
              >
                {currentTrack?.thumbnail ? (
                  <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Disc3 className="w-10 h-10 text-slate-600" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  className="text-lg sm:text-xl font-extrabold text-white leading-tight line-clamp-2"
                  title={currentTrack ? currentTrack.title : 'No track loaded'}
                >
                  {currentTrack ? currentTrack.title : 'No track loaded'}
                </h2>
                <p className="text-sm text-slate-400 truncate">
                  {currentTrack ? currentTrack.artist : 'Pick a song from Up Next or Most Played to start'}
                </p>
              </div>

              {/* Clean Action Buttons: Favorite & Dislike */}
              {currentTrack && (
                <div className="flex items-center gap-1 shrink-0 bg-white/5 p-1 rounded-xl border border-white/10 shadow-sm">
                  <button
                    id="party-console-favorite-btn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      engine.toggleFavorite(currentTrack);
                    }}
                    className={`p-1.5 rounded-lg transition-all duration-200 ${
                      engine.isFavorite(currentTrack)
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-rose-400 hover:bg-white/10'
                    }`}
                    title={engine.isFavorite(currentTrack) ? 'Saved in Favourites (Click to remove)' : 'Save song to Favourites'}
                    aria-label={engine.isFavorite(currentTrack) ? 'Saved in Favourites' : 'Save song to Favourites'}
                  >
                    <Heart
                      className={`w-4 h-4 transition-transform ${
                        engine.isFavorite(currentTrack) ? 'fill-rose-500 text-rose-500' : ''
                      }`}
                    />
                  </button>

                  <button
                    id="party-console-dislike-btn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      engine.toggleDontPlayAgain(currentTrack);
                    }}
                    className={`p-1.5 rounded-lg transition-all duration-200 ${
                      engine.isDontPlayAgain(currentTrack)
                        ? 'bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-red-400 hover:bg-white/10'
                    }`}
                    title={
                      engine.isDontPlayAgain(currentTrack)
                        ? "Saved in Don't Play Again Ever (Click to unblock)"
                        : "Don't play again ever (Thumbs Down)"
                    }
                    aria-label="Don't play again ever"
                  >
                    <ThumbsDown
                      className={`w-4 h-4 transition-transform ${
                        engine.isDontPlayAgain(currentTrack) ? 'fill-red-500 text-red-500' : ''
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Chips: set tempo, harmonic key, hook, intro skipped */}
            <div id="party-console-bpm-badges" className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {currentTrack?.key && (() => {
                const keyDetails = getCamelotDetails(currentTrack.key);
                return (
                  <span
                    id="party-console-now-playing-key-badge"
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"
                    title={`Key: ${keyDetails.musicalKey} (${currentTrack.key}) — Camelot Wheel`}
                  >
                    <span>🎵</span>
                    <span className="font-extrabold">{currentTrack.key}</span>
                    <span className="text-[10px] text-purple-200/80">({keyDetails.shortName})</span>
                  </span>
                );
              })()}
              {engine.sessionBpm && (() => {
                const sessionBpm = engine.sessionBpm;
                const onTempo = [0.5, 1, 2].some(
                  (m) => Math.abs(currentEffectiveBpm * m - sessionBpm) <= 1
                );
                const label = moodState.mood === 'party' ? 'Party' : 'Set';
                const detail = engine.tempoBusy
                  ? 'tuning…'
                  : onTempo
                    ? 'locked'
                    : !moodState.keyLock
                      ? 'key lock off'
                      : `this song ${Math.round(currentEffectiveBpm)}`;
                return (
                  <button
                    type="button"
                    id="party-console-party-tempo-badge"
                    onClick={() => {
                      const el = document.getElementById('tempo-control');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const input = el?.querySelector('input');
                      input?.focus();
                    }}
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer hover:scale-105 active:scale-95 transition-all ${
                      onTempo || engine.tempoBusy
                        ? 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/25'
                        : 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/25'
                    }`}
                    title={
                      onTempo
                        ? `Click to edit tempo. Currently ${Math.round(sessionBpm)} BPM (key lock on).`
                        : `Click to edit tempo. Currently target ${Math.round(sessionBpm)} BPM (${detail}).`
                    }
                  >
                    <Lock className="w-2.5 h-2.5" />
                    {label} {Math.round(sessionBpm)} · {detail}
                  </button>
                );
              })()}
              {hookTimes.length > 0 && (
                <span
                  id="party-console-hook-badge"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/25 px-2 py-0.5 rounded-full"
                  title="Hooks found in the audio: each chorus and a drop. Best part jumps to the next one."
                >
                  <Flame className="w-2.5 h-2.5" />
                  {hookTimes.length > 1 ? 'Hooks' : 'Hook'} {hookTimes.map(formatTime).join(' · ')}
                </span>
              )}
              {currentTrack?.musicStartTime && currentTrack.musicStartTime > 0 && (
                <span
                  id="party-console-intro-skipped-badge"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded-full"
                  title={currentTrack.introSkipReason || `Skipped initial ${formatTime(currentTrack.musicStartTime)} dialogue/conversation`}
                >
                  <Scissors className="w-2.5 h-2.5" />
                  Intro skipped {formatTime(currentTrack.musicStartTime)}
                </span>
              )}
              {isStrictStartSong(currentTrack) && (
                <span
                  id="party-console-strict-start-badge"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full"
                  title="Strict Start Song: always plays strictly from 0:00 without skipping intro build-up"
                >
                  <Target className="w-2.5 h-2.5 text-emerald-400" />
                  Start 0:00
                </span>
              )}
            </div>
          </div>

          {/* Master level meter */}
          <div id="party-console-vu-meter" className="hidden sm:flex shrink-0 items-center">
            <VuMeter
              analyserL={engine.masterAnalyserL}
              analyserR={engine.masterAnalyserR}
              analyser={engine.masterAnalyser}
              isPlaying={isPlaying}
              height={112}
              barWidth={7}
              barGap={3}
              segments={14}
              showLabels={true}
              showPeakText={false}
              title="LEVEL"
            />
          </div>
        </div>

        {/* Stat tiles */}
        <div id="party-console-stats" className="grid grid-cols-4 gap-2">
          {[
            {
              id: 'bpm',
              label: 'BPM',
              value: currentTrack ? currentEffectiveBpm.toFixed(1) : '—',
              accent: originalBpm !== undefined && Math.abs(currentEffectiveBpm - originalBpm) > 0.5,
            },
            {
              id: 'original',
              label: currentTrack?.aiPerceivedMeter === 'half_time_folk' ? 'Folk Pulse' : 'Original',
              value:
                currentTrack?.aiPerceivedMeter === 'half_time_folk' && currentTrack?.aiDanceBpm
                  ? `${currentTrack.aiDanceBpm.toFixed(0)} BPM`
                  : originalBpm !== undefined
                    ? originalBpm.toFixed(1)
                    : '—',
              accent: currentTrack?.aiPerceivedMeter === 'half_time_folk',
            },
            {
              id: 'hook',
              label: 'Hook',
              value: currentTrack?.highlightTime !== undefined ? formatTime(currentTrack.highlightTime) : '—',
              accent: false,
            },
            { id: 'remaining', label: 'Remaining', value: currentTrack ? `-${formatTime(remaining)}` : '—', accent: false },
          ].map((stat) => (
            <div
              id={`party-console-stat-${stat.id}`}
              key={stat.id}
              className={`flex flex-col items-center justify-center rounded-lg border px-1 py-1.5 ${
                stat.accent ? 'bg-cyan-500/10 border-cyan-500/25' : 'bg-white/[0.03] border-white/[0.06]'
              }`}
            >
              <span className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase">{stat.label}</span>
              <span className={`text-sm font-bold tabular-nums ${stat.accent ? 'text-cyan-200' : 'text-slate-100'}`}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        {/* Waveform progress: click or drag to seek, hook and cue markers */}
        <div id="party-console-time-scrubber" className="flex flex-col gap-1">
          <div id="party-console-waveform" className="relative h-14 rounded-lg bg-black/30 border border-white/[0.06] overflow-hidden">
            <div className="absolute inset-0 flex items-center gap-px px-1" aria-hidden="true">
              {waveBars.upcoming}
            </div>
            {/* The played part: the same bars in cyan, uncovered up to the playhead */}
            <div
              className="absolute inset-0 flex items-center gap-px px-1"
              style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
              aria-hidden="true"
            >
              {waveBars.played}
            </div>
            {cueRatio !== null && (
              <div
                className="absolute inset-y-0 w-px bg-emerald-400/80"
                style={{ left: `${cueRatio * 100}%` }}
                title="Mix-in cue point"
                aria-hidden="true"
              />
            )}
            {hookRatios.map((ratio) => (
              <div key={ratio} className="absolute inset-y-0 flex flex-col items-center" style={{ left: `${ratio * 100}%` }} aria-hidden="true">
                <div className="w-px h-full bg-orange-400" />
                <Flame className="absolute top-0.5 -translate-x-1/2 left-0 w-3 h-3 text-orange-400" />
              </div>
            ))}
            {/* Loop Region on Waveform */}
            {loop && (() => {
              const lStartRatio = markerRatio(loop.start);
              const lEndRatio = markerRatio(loop.end);
              if (lStartRatio === null || lEndRatio === null) return null;
              return (
                <div
                  className="absolute inset-y-0 bg-emerald-500/25 border-x-2 border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.4)] pointer-events-none z-10"
                  style={{ left: `${lStartRatio * 100}%`, width: `${Math.max(0.5, (lEndRatio - lStartRatio) * 100)}%` }}
                >
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono font-black text-emerald-300 bg-black/60 px-1 rounded">
                    IN
                  </span>
                  <span className="absolute top-0.5 right-1 text-[8px] font-mono font-black text-emerald-300 bg-black/60 px-1 rounded">
                    OUT
                  </span>
                </div>
              );
            })()}
            {loopInTime !== null && !loop && (() => {
              const inRatio = markerRatio(loopInTime);
              if (inRatio === null) return null;
              return (
                <div
                  className="absolute inset-y-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] z-10 animate-pulse pointer-events-none"
                  style={{ left: `${inRatio * 100}%` }}
                >
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono font-black text-amber-300 bg-black/80 px-1 rounded">
                    IN
                  </span>
                </div>
              );
            })()}
            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
              style={{ left: `${progress * 100}%` }}
              aria-hidden="true"
            />
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="1"
              value={currentTime || 0}
              onChange={(e) => activeDeck.seek(parseFloat(e.target.value))}
              disabled={!currentTrack}
              aria-label="Song position"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
            <span>{formatTime(currentTime)}</span>
            <span className="text-slate-500">{duration > 0 ? formatTime(duration) : '0:00'}</span>
          </div>
        </div>

        {/* Manual Loop (IN / OUT / EXIT) & Beat Loop Bar */}
        <div
          id="party-console-loop-controls"
          className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/10 shadow-inner"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-[10px] font-black tracking-wider text-slate-400 px-1 font-mono">
              <RotateCw className="w-3 h-3 text-cyan-400" />
              <span>LOOP:</span>
            </div>

            <button
              id="party-console-loop-in-btn"
              type="button"
              onClick={() => engine.setLoopIn()}
              disabled={!currentTrack || !isPlaying}
              className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide border transition-all active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5 ${
                loopInTime !== null && !loop
                  ? 'bg-amber-500 text-black border-amber-400 animate-pulse shadow-md shadow-amber-500/30'
                  : loop
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-white/5 hover:bg-white/15 text-slate-200 border-white/10 hover:border-white/20'
              }`}
              title="Press to set Loop IN (Start point) at current playback position"
            >
              <span>Loop in</span>
              {loopInTime !== null && !loop && <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping" />}
            </button>

            <button
              id="party-console-loop-out-btn"
              type="button"
              onClick={() => engine.setLoopOut()}
              disabled={!currentTrack || !isPlaying}
              className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide border transition-all active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5 ${
                loop
                  ? 'bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/30'
                  : loopInTime !== null
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400 animate-bounce'
                  : 'bg-white/5 hover:bg-white/15 text-slate-200 border-white/10 hover:border-white/20'
              }`}
              title={
                loop
                  ? 'Song is stuck in loop! Click to exit loop and continue playing'
                  : 'Press to set Loop OUT (End point) and start looping'
              }
            >
              <span>Loop out</span>
              {loop && <span className="font-mono text-[10px]">⟲</span>}
            </button>

            <button
              id="party-console-reloop-btn"
              type="button"
              onClick={() => engine.reloop()}
              disabled={!currentTrack || (!loop && !hasLastLoop)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-30 cursor-pointer ${
                loop
                  ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40 shadow-sm'
                  : 'bg-white/5 hover:bg-white/15 text-slate-300 border-white/10'
              }`}
              title={loop ? 'Exit current loop (play forward)' : 'Reloop (re-enter last saved loop)'}
            >
              {loop ? 'EXIT LOOP' : 'RELOOP'}
            </button>
          </div>

          {/* Quick Auto Beat Loops (1, 2, 4, 8 Bars) */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-2">
            <span className="text-[9px] font-mono text-slate-500 mr-1 hidden sm:inline">BEAT:</span>
            {[1, 2, 4, 8].map((bars) => {
              const isBarsActive = engine.getLoopBars(engine.activeDeck) === bars;
              return (
                <button
                  key={bars}
                  id={`party-console-loop-${bars}b`}
                  type="button"
                  onClick={() => engine.toggleBeatLoop(engine.activeDeck, bars)}
                  disabled={!currentTrack || !isPlaying}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-black border transition-all active:scale-95 disabled:opacity-40 cursor-pointer ${
                    isBarsActive
                      ? 'bg-emerald-500 text-black border-emerald-400 shadow-sm shadow-emerald-500/30'
                      : 'bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white border-white/10'
                  }`}
                  title={isBarsActive ? 'Leave loop' : `Instant ${bars}-bar beat loop`}
                >
                  {bars} bar
                </button>
              );
            })}
          </div>
        </div>

        {/* Transport */}
        <div id="party-console-track-panel" className="flex flex-col gap-3">
          <div id="party-console-transport" className="flex items-center justify-center gap-2 sm:gap-3">
            <button
              id="party-console-stop-button"
              onClick={() => engine.stopAll()}
              className="p-2 rounded-full text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
              title="Stop everything (music and drums)"
              aria-label="Stop"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
            <button
              id="party-console-prev-button"
              onClick={() => engine.prevTrack()}
              className="p-2.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Restart / previous song"
              aria-label="Previous"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              id="party-console-rewind-button"
              onClick={() => engine.seekCurrent(-10)}
              className="p-2.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Back 10 seconds"
              aria-label="Back 10 seconds"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              id="party-console-play-pause-button"
              onClick={() => engine.togglePlayCurrent()}
              className="w-14 h-14 rounded-full flex items-center justify-center bg-white text-slate-950 hover:scale-105 active:scale-95 shadow-lg shadow-white/10 transition-transform"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
            </button>
            <button
              id="party-console-forward-button"
              onClick={() => engine.seekCurrent(10)}
              className="p-2.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
            >
              <RotateCw className="w-5 h-5" />
            </button>
            <button
              id="party-console-next-button"
              onClick={() => engine.nextTrack()}
              className="p-2.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title={pendingMix ? 'Mix now (skip the 45s wait)' : 'Mix into the next song at the best point in the next 45 s'}
              aria-label="Next / mix"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
            <span className="w-8" aria-hidden="true" />
          </div>

          {/* Hook controls */}
          <div id="party-console-hook-controls" className="flex items-center justify-center gap-3">
            <button
              onClick={() => engine.jumpToHook()}
              disabled={!currentTrack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-orange-200 bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors disabled:opacity-40"
              title="Jump to the next hook (each chorus / the drop in turn)"
            >
              <Flame className="w-3.5 h-3.5" />
              Best part
            </button>
            <label
              className="inline-flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none"
              title="For a dancing crowd: each song plays only its build-up and hook (at most the length picked next to this switch), then mixes into the next"
            >
              <span>Best parts only</span>
              <button
                role="switch"
                aria-label="Best parts only"
                aria-checked={moodState.bestPartsMode}
                onClick={() => engine.toggleBestParts()}
                className={`relative w-8 h-[18px] rounded-full transition-colors ${
                  moodState.bestPartsMode ? 'bg-orange-500' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                    moodState.bestPartsMode ? 'translate-x-3.5' : ''
                  }`}
                />
              </button>
            </label>
            {moodState.bestPartsMode && (
              <select
                aria-label="Most of each song that plays"
                title="The most of each song that plays, from where it comes in (the mix included)"
                value={engine.bestPartsMaxSeconds}
                onChange={(e) => engine.setBestPartsMaxSeconds(Number(e.target.value))}
                className="bg-white/5 border border-orange-500/30 text-orange-200 text-[11px] rounded-md px-1.5 py-1 focus:outline-none focus:border-orange-400"
              >
                {[60, 75, 90, 120, 150].map((s) => (
                  <option key={s} value={s} className="bg-[#0b0f1a]">
                    max {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Music fader: lower the music, keep the vocals */}
          <MusicLevelControl engine={engine} />
        </div>
      </div>

      {/* Tempo: speed presets, exact BPM, key lock */}
      <div className="px-4 pb-4">
        <TempoControl
          tempo={engine.getTempoInfo()}
          onSetTempo={(ratio) => engine.setTempo(ratio)}
          onSetBpm={(bpm) => engine.setBpm(bpm)}
          onToggleKeyLock={() => engine.toggleKeyLock()}
          onToggleSetLock={() => engine.toggleSetTempoLock()}
          onTogglePlayOriginal={() => engine.togglePlayOriginal()}
        />
      </div>
    </div>
  );
};

