import React, { useState } from 'react';
import { HostSyncState, MobileAction } from '../types';
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
  FileText,
  Square,
} from 'lucide-react';

interface MobileRemoteViewProps {
  syncState: HostSyncState;
  onSendAction: (action: MobileAction) => void;
  onAcquireTrack: (query: string, autoMix: boolean) => Promise<void>;
  acquisitionStatus: string;
}

export const MobileRemoteView: React.FC<MobileRemoteViewProps> = ({
  syncState,
  onSendAction,
  onAcquireTrack,
  acquisitionStatus,
}) => {
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentTrack = syncState.currentTrack;
  const isPlaying = syncState.isPlaying;
  const perc = syncState.percussion;

  const handleAcquire = async (autoMix: boolean) => {
    if (!query.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAcquireTrack(query.trim(), autoMix);
      setQuery('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#07090e] text-slate-100 flex flex-col gap-4 p-4 pb-12 select-none">
      {/* Mobile Header */}
      <header className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-rose-500 text-black">
            <Disc3 className="w-5 h-5 animate-spin text-black" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-white tracking-tight">AI DJ REMOTE</h1>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Wi-Fi Connected (Deck {syncState.activeDeck})</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
          <Wifi className="w-3.5 h-3.5 text-cyan-400" />
          <span>{Math.round(syncState.bpm)} BPM</span>
        </div>
      </header>

      {/* Now Playing Card */}
      <div className="dj-panel rounded-2xl p-5 border border-white/10 flex flex-col items-center gap-3 relative overflow-hidden bg-gradient-to-b from-[#121724] to-[#0a0d16]">
        {/* Active Deck Glow Pill */}
        <div className="w-full flex justify-between items-center text-[10px] font-mono">
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
        <div className="relative w-36 h-36 rounded-full p-2 bg-gradient-to-tr from-cyan-500/30 via-rose-500/30 to-amber-500/30 border border-white/10 flex items-center justify-center shadow-2xl my-1">
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
              className={`w-full h-full rounded-full bg-slate-900 border-4 border-[#07090e] flex items-center justify-center ${
                isPlaying ? 'animate-spin [animation-duration:6s]' : ''
              }`}
            >
              <Disc3 className="w-16 h-16 text-slate-500" />
            </div>
          )}
          <div className="absolute w-6 h-6 rounded-full bg-[#07090e] border-2 border-white/30" />
        </div>

        {/* Track Info */}
        <div className="text-center w-full px-2">
          <h2 className="font-extrabold text-base text-white truncate">
            {currentTrack ? currentTrack.title : 'Waiting for track...'}
          </h2>
          <p className="text-xs text-slate-400 truncate">
            {currentTrack ? currentTrack.artist : 'Select a track or request below'}
          </p>
          {currentTrack?.highlightTime !== undefined && (
            <div className="flex items-center justify-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span>🔥 World's Favorite Part:</span>
                <span>{formatTime(currentTrack.highlightTime)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Scrub Slider & Time */}
        <div className="w-full flex flex-col gap-1 pt-1">
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
          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>{formatTime(syncState.currentTime)}</span>
            <span>-{formatTime(Math.max(0, syncState.duration - syncState.currentTime))}</span>
          </div>
        </div>

        {/* Tactile Mobile Transport Controls */}
        <div className="flex items-center justify-between w-full pt-1 px-3">
          {/* Previous Track */}
          <button
            onClick={() => onSendAction({ type: 'CMD_PREV' })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Previous Song"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          {/* Rewind -10s */}
          <button
            onClick={() => onSendAction({ type: 'CMD_SEEK', deltaSeconds: -10 })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Rewind 10 Seconds"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          {/* Play / Pause (Large Primary Button) */}
          <button
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
          <button
            onClick={() => onSendAction({ type: 'CMD_STOP' })}
            className="p-3 rounded-full bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 active:scale-95 transition-all shadow-md"
            title="Stop All Audio Immediately"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>

          {/* Forward +10s */}
          <button
            onClick={() => onSendAction({ type: 'CMD_SEEK', deltaSeconds: 10 })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Fast Forward 10 Seconds"
          >
            <RotateCw className="w-5 h-5" />
          </button>

          {/* Next Track / Trigger Mix */}
          <button
            onClick={() => onSendAction({ type: 'CMD_NEXT' })}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
            title="Next Song / Mix"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Viral Hook & Auto-Cue Action Bar */}
        <div className="w-full grid grid-cols-2 gap-2 pt-2.5 border-t border-white/5">
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

      {/* Autonomous Percussion Advisor Card */}
      <div
        className={`dj-panel rounded-2xl p-4 border transition-all ${
          perc.isPlaying
            ? 'border-rose-500/40 glow-deck-p bg-gradient-to-r from-[#191124] to-[#120f1c]'
            : 'border-white/10'
        }`}
      >
        <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${
                perc.isPlaying ? 'bg-rose-500 text-white pulse-percussion' : 'bg-white/10 text-slate-400'
              }`}
            >
              <Flame className="w-4 h-4 fill-current" />
            </div>
            <div>
              <div className="font-extrabold text-xs text-white flex items-center gap-1.5">
                <span>AI DRUM ADVISOR & LIVE DHOL</span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  AUTO-PILOT
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Decides drum style & tempo; holds if sync unproven
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
        <div className="bg-black/50 p-2 rounded-xl border border-white/5 font-mono text-[10px] text-rose-300 my-2 flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span className="truncate">{syncState.percussionDecisionReason}</span>
        </div>

        {/* 4 Quick Rhythm Pattern Switches */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {[
            { id: 'punjabi_dhol', name: 'Punjabi Dhol Live' },
            { id: 'bhangra_groove', name: 'Bhangra Dholak' },
            { id: 'electronic_drums', name: 'Club 4-on-Floor' },
            { id: 'afrobeat', name: 'Afrobeat Shakers' },
          ].map((item) => (
            <button
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
      <div className="dj-panel rounded-2xl p-4 border border-cyan-500/30 bg-cyan-950/10 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-extrabold text-xs text-white">
            REQUEST SONG OR YOUTUBE / YT MUSIC LINK
          </span>
        </div>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isSubmitting}
            placeholder="Song name (e.g. '295 Sidhu') or YouTube link..."
            className="w-full bg-black/50 border border-white/15 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        </div>

        {/* Dual Actions: Instant Mix or Add to Queue */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleAcquire(true)}
            disabled={isSubmitting || !query.trim()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-40"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>MIX NOW</span>
          </button>

          <button
            onClick={() => handleAcquire(false)}
            disabled={isSubmitting || !query.trim()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ADD TO QUEUE</span>
          </button>
        </div>

        {/* Load my_songs.txt Playlist One-Tap Button */}
        <button
          onClick={() => onSendAction({ type: 'CMD_LOAD_MY_SONGS' })}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-bold text-[11px] bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-500/30 transition-all shadow-sm active:scale-98"
        >
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>LOAD CUSTOM PLAYLIST (my_songs.txt)</span>
        </button>

        {/* Acquisition Status Telemetry */}
        {acquisitionStatus && (
          <div className="bg-black/60 p-2 rounded-lg border border-cyan-500/20 font-mono text-[10px] text-cyan-300 flex items-center gap-1.5 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span className="truncate">{acquisitionStatus}</span>
          </div>
        )}
      </div>

      {/* Most Played Bangers (Quick Starters) */}
      {syncState.mostPlayedSongs && syncState.mostPlayedSongs.length > 0 && (
        <div className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5 bg-gradient-to-b from-[#141824] to-[#0a0d16]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-400 fill-current" />
              <span className="font-extrabold text-xs text-white uppercase tracking-wider">
                MOST PLAYED BANGERS
              </span>
            </div>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              Quick Starters
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {syncState.mostPlayedSongs.slice(0, 5).map((song) => (
              <div
                key={song.id}
                className="flex items-center justify-between p-2.5 bg-black/40 rounded-xl border border-white/5 hover:border-amber-400/30 text-xs transition-all"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 relative">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-800">
                        <Disc3 className="w-4 h-4 text-amber-400" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col truncate">
                    <span className="font-bold text-white truncate max-w-[170px]" title={song.title}>
                      {song.title}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
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
      <div className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-slate-400" />
            <span className="font-extrabold text-xs text-white uppercase tracking-wider">
              AI AUTONOMOUS QUEUE ({syncState.queue.length} READY)
            </span>
          </div>

          <div className="flex items-center gap-1 text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
            <Radio className="w-3 h-3 text-purple-400 animate-pulse" />
            <span>5 PRE-CURATED</span>
          </div>
        </div>

        {syncState.queue.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 font-mono">
            Generating 5 internet recommendations...
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {syncState.queue.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 bg-black/30 rounded-xl border border-white/5 text-xs"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <span className="font-mono text-slate-500 text-[10px]">#{idx + 1}</span>
                  <div className="flex flex-col truncate">
                    <div className="flex items-center gap-1.5">
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

                <div className="flex items-center gap-1.5 shrink-0">
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
                      onClick={() => onSendAction({ type: 'CMD_NEXT' })}
                      className="px-2 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] transition-colors"
                    >
                      MIX
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
