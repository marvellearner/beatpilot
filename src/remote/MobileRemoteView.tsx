import React, { useState, useEffect, useRef } from 'react';
import { HostSyncState, MobileAction, SearchResult, TempoInfo } from '../types';
import { MoodEqPanel } from '../renderer/components/MoodEqPanel';
import { TempoControl } from '../renderer/components/TempoControl';
import { PreviouslyPlayedPanel } from '../renderer/components/PreviouslyPlayedPanel';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Flame,
  Volume2,
  VolumeX,
  Search,
  Plus,
  Zap,
  Disc3,
  Wifi,
  Sparkles,
  ListMusic,
  ArrowRightLeft,
  Bot,
  Radio,
  Star,
  Heart,
  FileText,
  Square,
  Music,
  Loader2,
  X,
} from 'lucide-react';

interface MobileRemoteViewProps {
  syncState: HostSyncState;
  connected: boolean;
  onSendAction: (action: MobileAction) => void;
}

export const MobileRemoteView: React.FC<MobileRemoteViewProps> = ({ syncState, connected, onSendAction }) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const acquisitionStatus = syncState.acquisitionStatus;
  const readyCount = syncState.queue.filter((q) => q.status === 'ready').length;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentTrack = syncState.currentTrack;
  const isPlaying = syncState.isPlaying;
  const perc = syncState.percussion;

  const fallbackBpm = (syncState.bpm && syncState.bpm > 0)
    ? syncState.bpm
    : (syncState.sessionBpm ?? 128);

  const effectiveTempo: TempoInfo = syncState.tempo ?? {
    naturalBpm: fallbackBpm,
    currentBpm: fallbackBpm,
    ratio: 1,
    keyLock: true,
    busy: false,
    setLocked: syncState.sessionBpm !== null,
    playOriginal: false,
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setIsDropdownOpen(false);
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
        searchAbortControllerRef.current = null;
      }
      return;
    }

    setIsDropdownOpen(true);
    setIsSearching(true);

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    searchAbortControllerRef.current = abortCtrl;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`, {
          signal: abortCtrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results)) {
            setSearchResults(data.results);
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Error fetching mobile search matches:', err);
        }
      } finally {
        if (!abortCtrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSong = (song: SearchResult, autoMix: boolean = false) => {
    onSendAction({
      type: autoMix ? 'CMD_MIX_NOW' : 'CMD_ADD_QUEUE',
      query: song.url || `${song.title} ${song.author}`,
    });
    setQuery('');
    setSearchResults([]);
    setIsDropdownOpen(false);
  };

  // The laptop downloads and plays the song; progress shows up in the status line
  const handleAcquire = (autoMix: boolean) => {
    if (!query.trim()) return;
    const topMatch = searchResults[0];
    const targetQuery = topMatch ? topMatch.url : query.trim();
    onSendAction({ type: autoMix ? 'CMD_MIX_NOW' : 'CMD_ADD_QUEUE', query: targetQuery });
    setQuery('');
    setSearchResults([]);
    setIsDropdownOpen(false);
  };

  return (
    <div id="remote-view" className="max-w-md mx-auto min-h-screen bg-[#07090e] text-slate-100 flex flex-col gap-4 p-4 pb-12 select-none">
      {/* Mobile Header */}
      <header id="remote-header" className="flex items-center justify-between pb-2 border-b border-white/10">
        <div id="remote-header-brand" className="flex items-center gap-2">
          <div id="remote-header-logo" className="p-1.5 rounded-lg bg-rose-500 text-black">
            <Disc3 className="w-5 h-5 animate-spin text-black" />
          </div>
          <div id="remote-header-title-group">
            <h1 className="text-base font-extrabold text-white tracking-tight">AI DJ REMOTE</h1>
            {connected ? (
              <div id="remote-status-connected" className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Connected to laptop (Deck {syncState.activeDeck})</span>
              </div>
            ) : (
              <div id="remote-status-disconnected" className="flex items-center gap-1.5 text-[10px] font-mono text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>Reconnecting… music keeps playing</span>
              </div>
            )}
          </div>
        </div>

        <div id="remote-header-bpm-badge" className="flex items-center gap-1 text-[11px] font-mono text-slate-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
          <Wifi className="w-3.5 h-3.5 text-cyan-400" />
          <span>{Math.round(syncState.bpm)} BPM</span>
        </div>
      </header>

      {/* Now Playing Card */}
      <div id="remote-now-playing-card" className="dj-panel rounded-2xl p-5 border border-white/10 flex flex-col items-center gap-3 relative overflow-hidden bg-gradient-to-b from-[#121724] to-[#0a0d16]">
        {/* Active Deck Glow Pill */}
        <div id="remote-on-air-pill" className="w-full flex justify-between items-center text-[10px] font-mono">
          <span
            className={`px-2 py-0.5 rounded font-black ${
              syncState.activeDeck === 'A' ? 'bg-cyan-500 text-black' : 'bg-amber-500 text-black'
            }`}
          >
            ON AIR: DECK {syncState.activeDeck}
          </span>
          {syncState.isTransitioning && (
            <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
              <ArrowRightLeft className="w-3 h-3" />
              MIXING IN PROGRESS...
            </span>
          )}
        </div>

        {/* Thumbnail / Animated Disc */}
        <div id="remote-disc" className="relative w-36 h-36 rounded-full p-2 bg-gradient-to-tr from-cyan-500/30 via-rose-500/30 to-amber-500/30 border border-white/10 flex items-center justify-center shadow-2xl my-1">
          {currentTrack?.thumbnail ? (
            <img
              src={currentTrack.thumbnail}
              alt="Track Art"
              className={`w-full h-full rounded-full object-cover border-4 border-[#07090e] ${
                isPlaying ? 'animate-spin [animation-duration:8s]' : ''
              }`}
            />
          ) : (
            <div
              id="remote-disc-placeholder"
              className={`w-full h-full rounded-full bg-slate-900 border-4 border-[#07090e] flex items-center justify-center ${
                isPlaying ? 'animate-spin [animation-duration:6s]' : ''
              }`}
            >
              <Disc3 className="w-16 h-16 text-slate-500" />
            </div>
          )}
          <div id="remote-disc-center" className="absolute w-6 h-6 rounded-full bg-[#07090e] border-2 border-white/30" />

          {/* Interactive Heart Button Around Song Image */}
          {currentTrack && (() => {
            const isFav = syncState.favorites?.some(
              (f) =>
                (currentTrack.id && f.id === currentTrack.id) ||
                (currentTrack.url && f.url === currentTrack.url) ||
                (f.title && f.title.trim().toLowerCase() === currentTrack.title?.trim().toLowerCase())
            );
            return (
              <button
                id="remote-favorite-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSendAction({ type: 'CMD_TOGGLE_FAVORITE', song: currentTrack });
                }}
                className={`absolute top-0 right-0 p-2 rounded-full backdrop-blur-md shadow-xl transition-transform active:scale-90 z-20 ${
                  isFav
                    ? 'bg-rose-500 text-white shadow-rose-500/50 border border-rose-400'
                    : 'bg-black/70 text-white/80 hover:text-rose-400 border border-white/20'
                }`}
                title={isFav ? 'In Favourites (tap to remove)' : 'Save to Favourites'}
                aria-label={isFav ? 'In Favourites (tap to remove)' : 'Save to Favourites'}
              >
                <Heart className={`w-4 h-4 ${isFav ? 'fill-white' : ''}`} />
              </button>
            );
          })()}
        </div>

        {/* Track Info */}
        <div id="remote-track-info" className="text-center w-full px-2">
          <h2 className="font-extrabold text-base text-white truncate">
            {currentTrack ? currentTrack.title : 'Waiting for track...'}
          </h2>
          <p className="text-xs text-slate-400 truncate">
            {currentTrack ? currentTrack.artist : 'Select a track or request below'}
          </p>
          {currentTrack?.highlightTime !== undefined && (
            <div id="remote-highlight-badge-wrapper" className="flex items-center justify-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span>🔥 World's Favorite Part:</span>
                <span>{formatTime(currentTrack.highlightTime)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Scrub Slider & Time */}
        <div id="remote-scrubber" className="w-full flex flex-col gap-1 pt-1">
          <input
            type="range"
            min="0"
            max={syncState.duration || 100}
            step="1"
            value={syncState.currentTime || 0}
            onChange={(e) =>
              onSendAction({ type: 'CMD_SEEK_TO', targetSeconds: parseFloat(e.target.value) })
            }
            className="w-full h-2 cursor-pointer fader-a"
          />
          <div id="remote-scrubber-times" className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>{formatTime(syncState.currentTime)}</span>
            <span>-{formatTime(Math.max(0, syncState.duration - syncState.currentTime))}</span>
          </div>
        </div>

        {/* Tactile Mobile Transport Controls */}
        <div id="remote-transport" className="flex items-center justify-between w-full pt-1 px-3">
          {/* Previous Track */}
          <button id="remote-prev-button"
            onClick={() => onSendAction({ type: 'CMD_PREV' })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Previous Song"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          {/* Rewind -10s */}
          <button id="remote-rewind-button"
            onClick={() => onSendAction({ type: 'CMD_SEEK', deltaSeconds: -10 })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Rewind 10 Seconds"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          {/* Play / Pause (Large Primary Button) */}
          <button id="remote-play-pause-button"
            onClick={() => onSendAction({ type: isPlaying ? 'CMD_PAUSE' : 'CMD_PLAY' })}
            className={`p-4 rounded-full font-black shadow-2xl active:scale-95 transition-all ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/40'
                : 'bg-white hover:bg-slate-200 text-black shadow-white/20'
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-0.5" />
            )}
          </button>

          {/* Dedicated Stop Button */}
          <button id="remote-stop-button"
            onClick={() => onSendAction({ type: 'CMD_STOP' })}
            className="p-3 rounded-full bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 active:scale-95 transition-all shadow-md"
            title="Stop All Audio Immediately"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          {/* Forward +10s */}
          <button id="remote-forward-button"
            onClick={() => onSendAction({ type: 'CMD_SEEK', deltaSeconds: 10 })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Fast Forward 10 Seconds"
          >
            <RotateCw className="w-5 h-5" />
          </button>

          {/* Next Track / Trigger Mix */}
          <button id="remote-next-button"
            onClick={() => onSendAction({ type: 'CMD_NEXT' })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Next Song / Mix"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Planned mix: waits for the best blend point instead of mixing immediately */}
        {syncState.pendingMix && (
          <div id="remote-pending-mix" className="w-full flex items-center justify-between gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl px-3 py-2 text-[11px]">
            <div id="remote-pending-mix-info" className="min-w-0">
              <div className="font-bold text-cyan-200 truncate">
                Mixing into "{syncState.pendingMix.title}" in {Math.ceil(syncState.pendingMix.startsInSeconds)}s
              </div>
              <div className="text-cyan-300/70 truncate">{syncState.pendingMix.reason}</div>
            </div>
            <div id="remote-pending-mix-actions" className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onSendAction({ type: 'CMD_NEXT' })}
                className="px-2.5 py-1.5 rounded-lg bg-cyan-500 text-black font-bold active:scale-95"
              >
                Now
              </button>
              <button
                onClick={() => onSendAction({ type: 'CMD_CANCEL_PENDING_MIX' })}
                className="px-2 py-1.5 rounded-lg bg-white/10 text-slate-200 active:scale-95"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Mobile Tempo Control: Integrated directly in Now Playing card */}
        <div id="remote-tempo-wrapper" className="w-full pt-1.5 border-t border-white/5">
          <TempoControl
            compact
            tempo={effectiveTempo}
            onSetTempo={(ratio) => onSendAction({ type: 'CMD_SET_TEMPO', ratio })}
            onSetBpm={(bpm) => onSendAction({ type: 'CMD_SET_BPM', bpm })}
            onToggleKeyLock={() => onSendAction({ type: 'CMD_TOGGLE_KEY_LOCK' })}
            onToggleSetLock={() => onSendAction({ type: 'CMD_TOGGLE_SET_TEMPO_LOCK' })}
            onTogglePlayOriginal={() => onSendAction({ type: 'CMD_TOGGLE_PLAY_ORIGINAL' })}
          />
        </div>

        {/* Quick Viral Hook & Auto-Cue Action Bar */}
        <div id="remote-hook-controls" className="w-full grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
          <button
            onClick={() => onSendAction({ type: 'CMD_JUMP_TO_HOOK' })}
            disabled={!currentTrack}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-lg shadow-amber-500/30 active:scale-95 transition-all disabled:opacity-40"
          >
            <span className="text-sm">🔥</span>
            <span>PLAY BEST PART</span>
          </button>

          <button
            onClick={() => onSendAction({ type: 'CMD_TOGGLE_AUTO_CUE_HOOK' })}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl font-bold text-[11px] border transition-all ${
              syncState.autoCueViralHook
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                : 'bg-white/5 text-slate-400 border-white/10'
            }`}
          >
            <span>Hook Cue:</span>
            <span className="font-extrabold">{syncState.autoCueViralHook ? 'ACTIVE' : 'OFF'}</span>
          </button>
        </div>
      </div>

      {/* Mood + equalizer (bass control) */}
      <MoodEqPanel
        compact
        mood={syncState.mood}
        eqGains={syncState.eqGains}
        onSetMood={(mood) => onSendAction({ type: 'CMD_SET_MOOD', mood })}
        onSetEq={(band, gainDb) => onSendAction({ type: 'CMD_SET_EQ', band, gainDb })}
        onResetEq={() => onSendAction({ type: 'CMD_RESET_EQ' })}
      />

      {/* Autonomous Percussion Advisor Card */}
      <div id="remote-drums-card"
        className={`dj-panel rounded-2xl p-4 border transition-all ${
          perc.isPlaying
            ? 'border-rose-500/40 glow-deck-p bg-gradient-to-r from-[#191124] to-[#120f1c]'
            : 'border-white/10'
        }`}
      >
        <div id="remote-drums-header" className="flex items-center justify-between pb-2.5 border-b border-white/10">
          <div id="remote-drums-title-group" className="flex items-center gap-2">
            <div
              id="remote-drums-icon"
              className={`p-1.5 rounded-lg ${
                perc.isPlaying ? 'bg-rose-500 text-white pulse-percussion' : 'bg-white/10 text-slate-400'
              }`}
            >
              <Flame className="w-4 h-4 fill-current" />
            </div>
            <div id="remote-drums-labels">
              <div id="remote-drums-heading" className="font-extrabold text-xs text-white flex items-center gap-1.5">
                <span>AI DRUM ADVISOR & LIVE DHOL</span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  AUTO-PILOT
                </span>
              </div>
              <div id="remote-drums-subheading" className="text-[10px] text-slate-400 font-mono">
                Decides drum style & tempo; holds if sync unproven
              </div>
            </div>
          </div>

          <div id="remote-drums-actions" className="flex items-center gap-1.5">
            <button
              id="remote-drums-resync"
              onClick={() => onSendAction({ type: 'CMD_RESYNC_PERCUSSION' })}
              className="p-1.5 px-2 rounded-lg border bg-purple-500/20 border-purple-500/40 text-purple-200 hover:bg-purple-500/30 flex items-center gap-1 text-[10px] font-bold"
              title="Snap live rhythm enhancer to song tempo and downbeat phase using AI"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>AI Sync</span>
            </button>

            <button
              onClick={() => onSendAction({ type: 'CMD_PERCUSSION_MUTE' })}
              className={`p-1.5 rounded-lg border ${
                perc.isMuted
                  ? 'bg-red-500/30 border-red-500/50 text-red-300'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
            >
              {perc.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={() => onSendAction({ type: 'CMD_PERCUSSION_TOGGLE' })}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs tracking-wide transition-all ${
                perc.isPlaying
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'bg-white/10 text-slate-300'
              }`}
            >
              {perc.isPlaying ? 'STOP' : 'START'}
            </button>
          </div>
        </div>

        {/* AI Drum Reasoning Telemetry */}
        <div id="remote-drums-reason" className="bg-black/50 p-2 rounded-xl border border-white/5 font-mono text-[10px] text-rose-300 my-2 flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span className="truncate flex-1">{syncState.percussionDecisionReason}</span>
          <button
            onClick={() => onSendAction({ type: 'CMD_RESYNC_PERCUSSION' })}
            className="px-1.5 py-0.5 text-[9px] font-sans font-bold bg-purple-500/20 hover:bg-purple-500/40 text-purple-200 border border-purple-400/30 rounded shrink-0"
            title="Snap live rhythm enhancer to song tempo and downbeat phase using AI"
          >
            Sync
          </button>
        </div>

        {/* 4 Quick Rhythm Pattern Switches */}
        <div id="remote-drum-patterns" className="grid grid-cols-2 gap-2 pt-1">
          {[
            { id: 'punjabi_dhol', name: 'Punjabi Dhol Live' },
            { id: 'bhangra_groove', name: 'Bhangra Dholak' },
            { id: 'electronic_drums', name: 'Club 4-on-Floor' },
            { id: 'afrobeat', name: 'Afrobeat Shakers' },
          ].map((item) => (
            <button id={`remote-drum-pattern-${item.id}`}
              key={item.id}
              onClick={() => onSendAction({ type: 'CMD_PERCUSSION_PATTERN', patternId: item.id })}
              className={`text-xs font-bold py-2 px-2.5 rounded-xl border text-left transition-all ${
                perc.activePatternId === item.id
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-md shadow-rose-500/20'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {/* Song Request & YouTube Download Card */}
      <div id="remote-song-request" className="dj-panel rounded-2xl p-4 border border-cyan-500/30 bg-cyan-950/10 flex flex-col gap-3">
        <div id="remote-request-header" className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-extrabold text-xs text-white">
            REQUEST SONG OR YOUTUBE / YT MUSIC LINK
          </span>
        </div>

        <div id="remote-search-container" ref={searchContainerRef} className="relative">
          <input
            type="text"
            value={query}
            onFocus={() => {
              if (query.trim().length >= 2) setIsDropdownOpen(true);
            }}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Song name (e.g. '295 Sidhu') or YouTube link..."
            className="w-full bg-black/50 border border-white/15 rounded-xl pl-9 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          {isSearching && (
            <Loader2 className="w-4 h-4 text-cyan-400 absolute right-3 top-3 animate-spin" />
          )}
          {query && !isSearching && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSearchResults([]);
                setIsDropdownOpen(false);
              }}
              className="absolute right-3 top-3 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Matching Songs Mobile Dropdown */}
          {isDropdownOpen && query.trim().length >= 2 && (
            <div
              id="remote-search-dropdown"
              className="absolute left-0 right-0 top-full mt-2 bg-[#0e1322]/98 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-[300px] overflow-y-auto ring-1 ring-black/80"
            >
              <div id="remote-search-dropdown-header" className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-slate-400 border-b border-white/10 mb-1">
                <span className="font-bold text-cyan-300 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  MATCHING SONGS ({searchResults.length})
                </span>
                <span className="text-[9px]">Tap to add</span>
              </div>

              {isSearching && searchResults.length === 0 ? (
                <div id="remote-search-loading" className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                  <span>Searching songs...</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div id="remote-search-empty" className="py-4 text-center text-xs text-slate-400">
                  No direct matches found.
                </div>
              ) : (
                searchResults.map((song, idx) => (
                  <div
                    id={`remote-search-result-${idx}`}
                    key={song.url || idx}
                    onClick={() => handleSelectSong(song, false)}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 active:scale-98 transition-all cursor-pointer shrink-0"
                  >
                    <div id={`remote-search-result-info-${idx}`} className="flex items-center gap-2 min-w-0 flex-1 truncate">
                      <div id={`remote-search-result-thumb-${idx}`} className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 relative">
                        {song.thumbnail ? (
                          <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div id={`remote-search-result-icon-${idx}`} className="w-full h-full flex items-center justify-center">
                            <Music className="w-3 h-3 text-slate-400" />
                          </div>
                        )}
                      </div>
                      <div id={`remote-search-result-meta-${idx}`} className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-white truncate" title={song.title}>
                          {song.title}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          {song.author} {song.timestamp ? `• ${song.timestamp}` : ''}
                        </span>
                      </div>
                    </div>

                    <div id={`remote-search-result-actions-${idx}`} className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleSelectSong(song, false)}
                        className="py-1 px-2 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold text-[10px] border border-cyan-500/30"
                      >
                        + Queue
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectSong(song, true)}
                        className="py-1 px-2 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30"
                      >
                        Mix
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Dual Actions: Instant Mix or Add to Queue */}
        <div id="remote-request-actions" className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleAcquire(true)}
            disabled={!query.trim()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-40"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>MIX NOW</span>
          </button>

          <button
            onClick={() => handleAcquire(false)}
            disabled={!query.trim()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ADD TO QUEUE</span>
          </button>
        </div>

        {/* Load my_songs.txt Playlist One-Tap Button */}
        <button id="remote-load-my-songs-button"
          onClick={() => onSendAction({ type: 'CMD_LOAD_MY_SONGS' })}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-bold text-[11px] bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-500/30 transition-all shadow-sm active:scale-98"
        >
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>LOAD CUSTOM PLAYLIST (my_songs.txt)</span>
        </button>

        {/* Acquisition Status Telemetry */}
        {acquisitionStatus && (
          <div id="remote-status" className="bg-black/60 p-2 rounded-lg border border-cyan-500/20 font-mono text-[10px] text-cyan-300 flex items-center gap-1.5 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span className="truncate">{acquisitionStatus}</span>
          </div>
        )}
      </div>

      {/* Previously played songs (newest first) */}
      <PreviouslyPlayedPanel
        compact
        entries={syncState.recentlyPlayed ?? []}
        onQueueAgain={(entry) => onSendAction({ type: 'CMD_ADD_QUEUE', query: entry.url || `${entry.artist} ${entry.title}` })}
      />

      {/* Most Played Bangers (Quick Starters) */}
      {syncState.mostPlayedSongs && syncState.mostPlayedSongs.length > 0 && (
        <div id="remote-most-played" className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5 bg-gradient-to-b from-[#141824] to-[#0a0d16]">
          <div id="remote-most-played-header" className="flex items-center justify-between">
            <div id="remote-most-played-title-group" className="flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-400 fill-current" />
              <span className="font-extrabold text-xs text-white uppercase tracking-wider">
                MOST PLAYED BANGERS
              </span>
            </div>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              Quick Starters
            </span>
          </div>

          <div id="remote-most-played-list" className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {syncState.mostPlayedSongs.slice(0, 5).map((song) => (
              <div id={`remote-most-played-item-${song.id}`}
                key={song.id}
                className="flex items-center justify-between p-2.5 bg-black/40 rounded-xl border border-white/5 hover:border-amber-400/30 text-xs transition-all"
              >
                <div id={`remote-most-played-info-${song.id}`} className="flex items-center gap-2.5 truncate">
                  <div id={`remote-most-played-thumb-${song.id}`} className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 relative">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                    ) : (
                      <div id={`remote-most-played-placeholder-${song.id}`} className="w-full h-full flex items-center justify-center bg-slate-800">
                        <Disc3 className="w-4 h-4 text-amber-400" />
                      </div>
                    )}
                  </div>

                  <div id={`remote-most-played-meta-${song.id}`} className="flex flex-col truncate">
                    <span className="font-bold text-white truncate max-w-[170px]" title={song.title}>
                      {song.title}
                    </span>
                    <div id={`remote-most-played-stats-${song.id}`} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span className="truncate max-w-[110px]">{song.artist}</span>
                      <span className="text-amber-400 font-mono font-bold">• {song.playCount} plays</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onSendAction({ type: 'CMD_PLAY_STARTER_SONG', songId: song.id })}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[10px] transition-colors shrink-0 shadow-sm"
                >
                  START
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Autonomous 5-Song Upcoming Queue */}
      <div id="remote-queue" className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5">
        <div id="remote-queue-header" className="flex items-center justify-between">
          <div id="remote-queue-title-group" className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-slate-400" />
            <span className="font-extrabold text-xs text-white uppercase tracking-wider">
              UP NEXT ({readyCount} READY / {syncState.queue.length})
            </span>
          </div>

          <div id="remote-queue-count-badge" className="flex items-center gap-1 text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
            <Radio className="w-3 h-3 text-purple-400 animate-pulse" />
            <span>5 PRE-CURATED</span>
          </div>
        </div>

        {syncState.queue.length === 0 ? (
          <div id="remote-queue-empty" className="text-center py-6 text-xs text-slate-500 font-mono">
            Queue empty — request a song above, or the AI fills it once music plays.
          </div>
        ) : (
          <div id="remote-queue-list" className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {syncState.queue.map((item, idx) => (
              <div id={`remote-queue-item-${item.id}`}
                key={item.id}
                className="flex items-center justify-between p-2.5 bg-black/30 rounded-xl border border-white/5 text-xs"
              >
                <div id={`remote-queue-item-info-${item.id}`} className="flex items-center gap-2.5 truncate">
                  <span className="font-mono text-slate-500 text-[10px]">#{idx + 1}</span>
                  <div id={`remote-queue-item-meta-${item.id}`} className="flex flex-col truncate">
                    <div id={`remote-queue-item-title-row-${item.id}`} className="flex items-center gap-1.5">
                      <span className="font-bold text-white truncate max-w-[170px]">
                        {item.title}
                      </span>
                      {item.isAiRecommended && (
                        <span className="text-[8px] font-mono bg-purple-500/20 text-purple-300 px-1 rounded border border-purple-500/30">
                          AI
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 truncate max-w-[170px]">
                      {item.artist}
                    </span>
                  </div>
                </div>

                <div id={`remote-queue-item-actions-${item.id}`} className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[9px] font-mono px-2 py-0.5 rounded ${
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
                      onClick={() => onSendAction({ type: 'CMD_MIX_QUEUED', itemId: item.id })}
                      disabled={syncState.isTransitioning}
                      className="px-2 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] transition-colors disabled:opacity-40"
                    >
                      MIX
                    </button>
                  )}
                  <button
                    onClick={() => onSendAction({ type: 'CMD_REMOVE_QUEUED', itemId: item.id })}
                    className="px-1.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white text-[10px] transition-colors"
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
