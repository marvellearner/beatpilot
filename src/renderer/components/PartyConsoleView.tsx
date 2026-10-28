import React, { useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import { PERCUSSION_PATTERNS } from '../../audio/PercussionDeck';
import { MoodEqPanel } from './MoodEqPanel';
import { TempoControl } from './TempoControl';
import { PreviouslyPlayedPanel, timeAgo } from './PreviouslyPlayedPanel';
import { VuMeter } from './VuMeter';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Sparkles,
  Music,
  Disc3,
  Search,
  Plus,
  Radio,
  Sliders,
  CheckCircle2,
  Star,
  FileText,
  Edit3,
  Check,
  X,
  Square,
  Flame,
  Lock,
  Scissors,
} from 'lucide-react';

interface PartyConsoleViewProps {
  engine: AudioEngine;
  onSwitchToProMode: () => void;
}

export const PartyConsoleView: React.FC<PartyConsoleViewProps> = ({ engine, onSwitchToProMode }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeDeck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
  const playbackState = activeDeck.getPlaybackState();
  const currentTrack = playbackState.track;
  const isPlaying = playbackState.isPlaying;
  const pendingMix = engine.getSyncState().pendingMix;

  // Now Playing card
  const duration = playbackState.duration || 0;
  const remaining = Math.max(0, duration - playbackState.currentTime);
  const progress = duration > 0 ? Math.min(1, playbackState.currentTime / duration) : 0;
  const peaks = currentTrack?.waveformPeaks?.length ? currentTrack.waveformPeaks : null;
  const originalBpm = currentTrack ? currentTrack.original?.bpm ?? currentTrack.bpm : undefined;
  const markerRatio = (time?: number) => (duration > 0 && time !== undefined && time > 0 && time < duration ? time / duration : null);
  const hookRatio = markerRatio(currentTrack?.highlightTime);
  const cueRatio = markerRatio(currentTrack?.cueInTime);
  const deckStatus = engine.isTransitioning
    ? { label: 'MIXING', className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30', dotClassName: 'bg-cyan-400 animate-pulse' }
    : pendingMix
      ? {
          label: `MIX IN ${Math.ceil(pendingMix.startsInSeconds)}s`,
          className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30',
          dotClassName: 'bg-cyan-400',
        }
      : isPlaying
        ? { label: 'ON AIR', className: 'text-rose-200 bg-rose-500/10 border-rose-500/30', dotClassName: 'bg-rose-500 animate-pulse' }
        : currentTrack
          ? { label: 'PAUSED', className: 'text-amber-200 bg-amber-500/10 border-amber-500/30', dotClassName: 'bg-amber-400' }
          : { label: 'IDLE', className: 'text-slate-400 bg-white/5 border-white/10', dotClassName: 'bg-slate-500' };

  const percussion = engine.percussionDeck.getState();
  const activePattern = PERCUSSION_PATTERNS.find((p) => p.id === percussion.activePatternId);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleLoadMySongs = async () => {
    setIsLoadingSongs(true);
    try {
      const res = await engine.loadSongsFromTextFile();
      showToast(`Loaded ${res.count} songs from my_songs.txt!`);
    } catch {
      showToast('Failed to load songs from my_songs.txt');
    } finally {
      setIsLoadingSongs(false);
    }
  };

  const handleOpenEditor = async () => {
    try {
      const res = await fetch('/api/my-songs');
      const data = await res.json();
      setFileContent(data.raw || '');
      setIsEditingFile(true);
    } catch {
      showToast('Could not load my_songs.txt content');
    }
  };

  const handleSaveEditor = async () => {
    setIsSavingFile(true);
    try {
      const res = await fetch('/api/my-songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        showToast('Saved my_songs.txt successfully!');
      }
    } catch {
      showToast('Failed to save my_songs.txt');
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent, autoMix: boolean = false) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Clear the box right away so the next song can be typed while this one downloads
    const query = searchQuery;
    setSearchQuery('');
    await engine.acquireTrack(query, autoMix);
  };

  return (
    <div id="party-console" className="flex flex-col gap-2.5 max-w-[1440px] mx-auto w-full relative">
      {/* Floating Toast Notification */}
      {toastMessage && (
        <div id="party-console-toast" className="fixed top-5 right-5 z-50 bg-black/90 border border-cyan-500/40 text-cyan-200 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Bar: Mode switcher, Status & Custom File Actions */}
      <div id="party-console-top-bar" className="flex flex-wrap items-center justify-between gap-2.5 bg-white/5 border border-white/10 px-3.5 py-2 rounded-2xl">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-black shadow-md shadow-amber-500/20">
            <Sparkles className="w-3.5 h-3.5 fill-current" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-white tracking-wide">PARTY MASTER CONSOLE</span>
            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AI Auto-Pilot Active
            </span>
            <span className="hidden md:inline text-[11px] text-slate-400 font-medium">
              • Clean player with beat-sync and auto-queue
            </span>
          </div>
        </div>

        {/* Action Buttons: Load & Edit my_songs.txt + Switch to Pro Decks */}
        <div id="party-console-top-bar-actions" className="flex items-center gap-2">
          <button
            onClick={handleLoadMySongs}
            disabled={isLoadingSongs}
            className="flex items-center gap-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all shadow-sm"
            title="Load songs from my_songs.txt"
          >
            <FileText className="w-3 h-3 text-cyan-400" />
            <span>{isLoadingSongs ? 'Loading...' : 'Load my_songs.txt'}</span>
          </button>

          <button
            onClick={handleOpenEditor}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all"
            title="View or add songs to my_songs.txt"
          >
            <Edit3 className="w-3 h-3 text-amber-400" />
            <span>Edit my_songs.txt</span>
          </button>

          <button
            onClick={onSwitchToProMode}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white px-2.5 py-1 rounded-xl text-[11px] font-semibold border border-white/10 transition-colors"
            title="Switch to detailed dual-deck console with EQ faders and mixer"
          >
            <Sliders className="w-3 h-3 text-slate-400" />
            <span>Pro Decks</span>
          </button>
        </div>
      </div>

      {/* 3-Column Dashboard Grid: player (6 cols / 50%) | sound controls (3 cols / 25%) | queue & history (3 cols / 25%) */}
      <div id="party-console-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left Column (6 cols): Live Party Player */}
        <div id="party-console-left-column" className="lg:col-span-6 flex flex-col gap-3">
          {/* Now Playing: status header, artwork + track info + VU, stats, waveform, transport, tempo */}
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
                  DECK {engine.activeDeck}
                </span>
              </div>
              <span
                id="party-console-deck-status"
                className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${deckStatus.className}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${deckStatus.dotClassName}`} />
                {deckStatus.label}
              </span>
            </div>

            <div className="flex flex-col gap-4 p-4">
              {/* Hero: artwork, title/artist/chips, VU meter */}
              <div id="party-console-track-info" className="flex items-center gap-4">
                {/* Artwork with a vinyl edge that spins while playing */}
                <div id="party-console-vinyl" className="relative shrink-0 w-28 h-28 sm:w-32 sm:h-32 mr-4">
                  <div
                    className={`absolute inset-y-1 -right-4 aspect-square rounded-full bg-[radial-gradient(circle,#1e293b_0%,#0b1120_45%,#020617_46%,#111827_60%,#020617_61%,#0f172a_100%)] border border-white/10 shadow-lg ${
                      isPlaying ? 'animate-spin [animation-duration:6s]' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <div
                    id="party-console-center-label-art"
                    className="relative w-full h-full rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-gradient-to-br from-slate-800 to-slate-950"
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

                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  <h2
                    className="text-lg sm:text-xl font-extrabold text-white leading-tight line-clamp-2"
                    title={currentTrack ? currentTrack.title : 'No track loaded'}
                  >
                    {currentTrack ? currentTrack.title : 'No track loaded'}
                  </h2>
                  <p className="text-sm text-slate-400 truncate">
                    {currentTrack ? currentTrack.artist : 'Pick a song from Up Next or Most Played to start'}
                  </p>

                  {/* Chips: set tempo, hook, intro skipped */}
                  <div id="party-console-bpm-badges" className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {engine.sessionBpm && (() => {
                      // Is the song on air actually at the set tempo (half/double time counts)?
                      const sessionBpm = engine.sessionBpm;
                      const onTempo = [0.5, 1, 2].some(
                        (m) => Math.abs(playbackState.effectiveBpm * m - sessionBpm) <= 1
                      );
                      const label = engine.mood === 'party' ? 'Party' : 'Set';
                      const detail = engine.tempoBusy
                        ? 'tuning…'
                        : onTempo
                          ? 'locked'
                          : !engine.keyLock
                            ? 'key lock off'
                            : `this song ${Math.round(playbackState.effectiveBpm)}`;
                      return (
                        <span
                          id="party-console-party-tempo-badge"
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            onTempo || engine.tempoBusy
                              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                              : 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                          }`}
                          title={
                            onTempo
                              ? 'Every song, including this one, plays at this tempo with key lock (pitch unchanged).'
                              : `This song is ${Math.round(originalBpm ?? 0)} BPM originally. Key lock can stretch about ±25% cleanly, so it is played as close to ${Math.round(sessionBpm)} as possible without distorting voices. The next songs are tuned exactly.`
                          }
                        >
                          <Lock className="w-2.5 h-2.5" />
                          {label} {Math.round(sessionBpm)} · {detail}
                        </span>
                      );
                    })()}
                    {currentTrack?.highlightTime !== undefined && (
                      <span
                        id="party-console-hook-badge"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/25 px-2 py-0.5 rounded-full"
                        title="The world's most replayed part of this song"
                      >
                        <Flame className="w-2.5 h-2.5" />
                        Hook {formatTime(currentTrack.highlightTime)}
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
                    value: currentTrack ? playbackState.effectiveBpm.toFixed(1) : '—',
                    accent: originalBpm !== undefined && Math.abs(playbackState.effectiveBpm - originalBpm) > 0.5,
                  },
                  { id: 'original', label: 'Original', value: originalBpm !== undefined ? originalBpm.toFixed(1) : '—', accent: false },
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
                    {(peaks ?? Array.from({ length: 120 }, () => 0.15)).map((peak, i, all) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-full ${i / all.length <= progress ? 'bg-cyan-400' : 'bg-slate-600/60'}`}
                        style={{ height: `${Math.max(6, Math.min(100, peak * 100))}%` }}
                      />
                    ))}
                  </div>
                  {cueRatio !== null && (
                    <div
                      className="absolute inset-y-0 w-px bg-emerald-400/80"
                      style={{ left: `${cueRatio * 100}%` }}
                      title="Mix-in cue point"
                      aria-hidden="true"
                    />
                  )}
                  {hookRatio !== null && (
                    <div className="absolute inset-y-0 flex flex-col items-center" style={{ left: `${hookRatio * 100}%` }} aria-hidden="true">
                      <div className="w-px h-full bg-orange-400" />
                      <Flame className="absolute top-0.5 -translate-x-1/2 left-0 w-3 h-3 text-orange-400" />
                    </div>
                  )}
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
                    value={playbackState.currentTime || 0}
                    onChange={(e) => activeDeck.seek(parseFloat(e.target.value))}
                    disabled={!currentTrack}
                    aria-label="Song position"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
                  />
                </div>
                <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
                  <span>{formatTime(playbackState.currentTime)}</span>
                  <span className="text-slate-500">{duration > 0 ? formatTime(duration) : '0:00'}</span>
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
                    title={pendingMix ? 'Mix now (skip the wait)' : 'Mix into the next song at the best point in the next 30 s'}
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
                    title="Jump to the world's most replayed part of this song"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Play best part
                  </button>
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none" title="Start the next songs just before their hook">
                    <span>Auto-cue hook</span>
                    <button
                      role="switch"
                      aria-checked={engine.autoCueViralHook}
                      onClick={() => engine.toggleAutoCueHook()}
                      className={`relative w-8 h-[18px] rounded-full transition-colors ${
                        engine.autoCueViralHook ? 'bg-orange-500' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                          engine.autoCueViralHook ? 'translate-x-3.5' : ''
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>

              {/* Planned mix: waits for the best blend point instead of mixing immediately */}
              {pendingMix && (
                <div id="party-console-pending-mix" className="flex items-center justify-between gap-2 bg-cyan-500/10 border border-cyan-500/25 rounded-xl px-3 py-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="font-semibold text-cyan-100 truncate">
                      Mixing into "{pendingMix.title}" in {Math.ceil(pendingMix.startsInSeconds)}s
                    </div>
                    <div className="text-cyan-300/70 truncate" title={pendingMix.reason}>
                      {pendingMix.reason} · enters at {formatTime(pendingMix.entryTime)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => engine.nextTrack()}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-colors"
                    >
                      Mix now
                    </button>
                    <button
                      onClick={() => engine.cancelPendingMix()}
                      className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
        </div>

        {/* Middle Column (3 cols): Live Rhythm Enhancer + Mood & Equalizer */}
        <div id="party-console-middle-column" className="lg:col-span-3 flex flex-col gap-3">
          {/* Compact Live Rhythm Enhancer (Deck P - Cherry on Top) */}
          <div id="party-console-rhythm-enhancer" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#14101e]/95 to-[#0c0914]/95 shadow-xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-base">🥁</span>
                <div>
                  <h3 className="font-extrabold text-xs text-white">LIVE RHYTHM ENHANCER</h3>
                  <span className="text-[10px] text-purple-300">
                    {activePattern ? activePattern.name : 'Dhol'} • Cherry on top
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold border ${
                    percussion.isPlaying
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-white/5 text-slate-400 border-white/10'
                  }`}
                >
                  <CheckCircle2 className="w-2.5 h-2.5 text-slate-400" />
                  <span>{percussion.isPlaying ? 'Live Rhythm Active' : 'Drums Stopped (Silent)'}</span>
                </div>
                <span className="text-[10px] font-mono text-purple-300 font-bold">
                  {Math.round(percussion.currentBpm)} BPM
                </span>
              </div>
            </div>

            {/* Compact 4-Style Drum Selector */}
            <div id="party-console-drum-styles" className="grid grid-cols-2 gap-1.5">
              {PERCUSSION_PATTERNS.map((p) => (
                <button id={`party-console-drum-style-${p.id}`}
                  key={p.id}
                  onClick={() => engine.percussionDeck.switchPattern(p.id)}
                  className={`p-2 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                    percussion.activePatternId === p.id
                      ? 'bg-rose-500/20 border-rose-500 text-rose-200 font-bold shadow-sm'
                      : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span className="text-xs truncate">{p.name}</span>
                  <span className="text-[9px] text-slate-400 font-mono">{p.defaultBpm} BPM Base</span>
                </button>
              ))}
            </div>

            {/* Groove Energy Level & Start/Stop Controls Row */}
            <div id="party-console-drum-controls" className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 font-medium">Energy:</span>
                <button
                  onClick={() => {
                    engine.percussionDeck.setVolume(0.5);
                    engine.percussionDeck.setIntensity(0.7);
                  }}
                  className={`py-1 px-2 rounded-lg text-[10px] font-bold border transition-all ${
                    percussion.volume < 0.6
                      ? 'bg-purple-600/30 border-purple-500 text-white'
                      : 'bg-white/5 border-white/5 text-slate-400'
                  }`}
                >
                  Subtle
                </button>
                <button
                  onClick={() => {
                    engine.percussionDeck.setVolume(0.8);
                    engine.percussionDeck.setIntensity(1.0);
                  }}
                  className={`py-1 px-2 rounded-lg text-[10px] font-bold border transition-all ${
                    percussion.volume >= 0.6 && percussion.volume <= 0.85
                      ? 'bg-purple-600/30 border-purple-500 text-white'
                      : 'bg-white/5 border-white/5 text-slate-400'
                  }`}
                >
                  Bounce
                </button>
                <button
                  onClick={() => {
                    engine.percussionDeck.setVolume(1.0);
                    engine.percussionDeck.setIntensity(1.3);
                  }}
                  className={`py-1 px-2 rounded-lg text-[10px] font-bold border transition-all ${
                    percussion.volume > 0.85
                      ? 'bg-purple-600/30 border-purple-500 text-white'
                      : 'bg-white/5 border-white/5 text-slate-400'
                  }`}
                >
                  Peak 🔥
                </button>
              </div>

              {/* Start/Stop Drums & Auto-Pilot */}
              <div id="party-console-drum-buttons" className="flex items-center gap-1.5">
                <button
                  onClick={() => engine.togglePercussion()}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shadow-sm ${
                    percussion.isPlaying
                      ? 'bg-rose-500 text-white shadow-rose-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  {percussion.isPlaying ? 'STOP DRUMS' : 'START DRUMS'}
                </button>

                <button
                  onClick={() => engine.toggleAutoPercussion()}
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-semibold border transition-all ${
                    engine.autoPercussionEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-white/5 text-slate-400 border-white/10'
                  }`}
                  title="Automatically switches drums and tempos based on playing track"
                >
                  AI Drums: {engine.autoPercussionEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>

          {/* Mood tabs + master equalizer (bass control) */}
          <MoodEqPanel
            compact
            mood={engine.mood}
            eqGains={engine.eqGains}
            onSetMood={(m) => engine.setMood(m)}
            onSetEq={(band, db) => engine.setEqBand(band, db)}
            onResetEq={() => engine.resetEq()}
          />
        </div>

        {/* Right Column (3 cols, decreased by ~10% width): Up Next Party Queue + Previously Played + Most Played Bangers */}
        <div id="party-console-right-column" className="lg:col-span-3 flex flex-col gap-3">
          {/* Up Next Party Queue & Instant Song Search */}
          <div id="party-console-queue" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
              <div className="flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-cyan-400" />
                <h3 className="font-extrabold text-xs text-white">
                  UP NEXT QUEUE ({engine.queue.length})
                </h3>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                <Radio className="w-2.5 h-2.5 animate-pulse" />
                <span>Auto-Mix Ready</span>
              </div>
            </div>

            {/* Easy Song Request Input */}
            <form id="party-console-song-request-form" onSubmit={(e) => handleSearchSubmit(e, false)} className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Song name or YouTube URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <button
                type="submit"
                disabled={!searchQuery.trim()}
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-3 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Queue</span>
              </button>
            </form>

            {/* Scrollable Queue List (Expanded to display 8 songs without scroll) */}
            <div id="party-console-queue-list" className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto pr-1">
              {engine.queue.length === 0 ? (
                <div id="party-console-queue-empty" className="text-center py-8 text-[11px] text-slate-500 font-medium">
                  Queue empty. AI will auto-curate bangers when track plays!
                </div>
              ) : (
                engine.queue.map((item, idx) => (
                  <div id={`party-console-queue-item-${item.id}`}
                    key={item.id}
                    className="p-1.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between gap-2 text-xs hover:border-white/20 transition-all"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                      <span className="font-mono text-[9px] text-slate-500 w-3 shrink-0">#{idx + 1}</span>
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="Thumb" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                          <Music className="w-3 h-3 text-slate-400" />
                        </div>
                      )}
                      <div className="flex flex-col truncate min-w-0 flex-1">
                        <span className="font-bold text-white text-[11px] truncate" title={item.title}>
                          {item.title}
                        </span>
                        <span className="text-[9px] text-slate-400 truncate">
                          {item.artist}
                          {item.lastPlayedAt !== undefined && (
                            <span className="text-violet-300" title="You asked for it, so it was added even though it played within the last hour">
                              {' '}• 🔁 played {timeAgo(item.lastPlayedAt)}
                            </span>
                          )}
                          {item.bpm !== undefined && item.bpmConfidence !== undefined && (
                            <span className="font-mono text-slate-300">
                              {' '}• {Math.round(item.bpm)} BPM
                              {item.tempoLockedTo !== undefined && item.original && (
                                <span className="text-emerald-300" title={`Tuned from ${Math.round(item.original.bpm)} BPM, key-locked`}>
                                  {' '}🔒
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-bold ${
                          item.status === 'ready'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.status === 'failed'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-yellow-500/20 text-yellow-300 animate-pulse'
                        }`}
                      >
                        {item.status.toUpperCase()}
                      </span>
                      {item.status === 'ready' && (
                        <button
                          onClick={() => engine.mixQueuedTrack(item.id)}
                          disabled={engine.isTransitioning}
                          className="text-[9px] font-bold text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/30 px-1.5 py-0.5 rounded transition-colors disabled:opacity-40"
                          title="Mix into this song now"
                        >
                          MIX
                        </button>
                      )}
                      <button
                        onClick={() => engine.removeFromQueue(item.id)}
                        className="text-slate-500 hover:text-white p-0.5 rounded transition-colors"
                        title="Remove from queue"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Previously played songs (newest first); the last hour's are kept out of Up Next */}
          <PreviouslyPlayedPanel
            entries={engine.playLog.slice(0, 30)}
            onQueueAgain={(entry) => engine.acquireTrack(entry.url || `${entry.artist} ${entry.title}`, false)}
          />

          {/* Most Played Bangers (Quick Starters) */}
          <div id="party-console-most-played" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#131926]/95 to-[#0b0e17]/95 shadow-xl flex flex-col gap-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
              <div className="flex items-center gap-1.5">
                <div className="p-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Star className="w-3.5 h-3.5 fill-current" />
                </div>
                <div>
                  <h3 className="font-extrabold text-xs text-white tracking-wide flex items-center gap-1.5">
                    <span>MOST PLAYED BANGERS</span>
                    <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                      {engine.mostPlayedSongs.length} Saved
                    </span>
                  </h3>
                </div>
              </div>
              <span className="text-[10px] text-slate-400">Click to start night</span>
            </div>

            {/* List of most played starters: 5 visible upfront with smooth scrolling to see the rest */}
            <div id="party-console-most-played-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
              {engine.mostPlayedSongs.length === 0 ? (
                <div id="party-console-most-played-empty" className="text-center py-4 text-[11px] text-slate-500 font-medium">
                  No play history yet. Play songs to see your top party bangers here!
                </div>
              ) : (
                engine.mostPlayedSongs.map((song) => (
                  <div id={`party-console-most-played-item-${song.id}`}
                    key={song.id}
                    className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-amber-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 relative">
                        {song.thumbnail ? (
                          <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-purple-900 to-indigo-900">
                            <Music className="w-3.5 h-3.5 text-amber-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition-colors" title={song.title}>
                          {song.title}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span className="truncate">{song.artist}</span>
                          <span className="font-mono text-amber-400/90 font-bold shrink-0">
                            ⭐ {song.playCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => engine.playStarterSong(song.id)}
                      className="py-1 px-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500 hover:to-orange-500 text-amber-300 hover:text-black border border-amber-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 shadow-sm"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>Start</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* In-App Editor Modal for my_songs.txt */}
      {isEditingFile && (
        <div id="party-console-song-list-editor" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#101422] border border-white/20 rounded-3xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Edit Custom Song List (my_songs.txt)</h3>
                  <p className="text-xs text-slate-400">
                    Write one song name or YouTube link per line. Lines starting with # are comments.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEditingFile(false)}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              rows={12}
              className="w-full p-3.5 bg-black/60 border border-white/15 rounded-2xl text-xs font-mono text-emerald-300 placeholder-slate-600 focus:outline-none focus:border-cyan-400 resize-none"
              placeholder="# Add songs below:&#10;Sidhu Moose Wala - 295&#10;Diljit Dosanjh - Lover&#10;https://www.youtube.com/watch?v=kJQP7kiw5Fk"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-400">
                Saves directly to <code className="text-amber-400 font-mono">my_songs.txt</code> in project root
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditingFile(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditor}
                  disabled={isSavingFile}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:opacity-95 shadow-md flex items-center gap-1.5"
                >
                  {saveSuccess ? (
                    <>
                      <Check className="w-4 h-4 text-black" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <span>{isSavingFile ? 'Saving...' : 'Save File'}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
