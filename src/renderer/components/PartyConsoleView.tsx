import React, { useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import { PERCUSSION_PATTERNS } from '../../audio/PercussionDeck';
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
} from 'lucide-react';

interface PartyConsoleViewProps {
  engine: AudioEngine;
  onSwitchToProMode: () => void;
}

export const PartyConsoleView: React.FC<PartyConsoleViewProps> = ({ engine, onSwitchToProMode }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
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
    if (!searchQuery.trim() || isSearching) return;

    setIsSearching(true);
    try {
      await engine.acquireTrack(searchQuery, autoMix);
      setSearchQuery('');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 max-w-[1440px] mx-auto w-full relative">
      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-black/90 border border-cyan-500/40 text-cyan-200 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Bar: Mode switcher, Status & Custom File Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white/5 border border-white/10 px-3.5 py-2 rounded-2xl">
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
        <div className="flex items-center gap-2">
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

      {/* Panoramic 2-Column Dashboard Grid: 70%+ of content visible on first display */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left Column (7 cols): Horizontal Master Player + Live Rhythm Enhancer */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {/* Main Showcase: Horizontal Live Party Player */}
          <div className="dj-panel rounded-2xl p-5 sm:p-7 min-h-[320px] sm:min-h-[360px] border border-white/10 bg-gradient-to-b from-[#131929]/95 to-[#0a0d18]/95 shadow-xl relative overflow-hidden flex flex-col justify-center gap-3">
            {/* Ambient glow aura */}
            <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-80 h-80 bg-gradient-to-tr from-cyan-500/10 via-purple-500/10 to-amber-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col sm:flex-row items-center gap-6 z-10">
              {/* Animated Compact Vinyl & Album Art */}
              <div className="relative shrink-0 flex items-center justify-center">
                <div
                  className={`w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-tr from-slate-950 via-slate-900 to-black p-2 border-2 border-slate-700/80 shadow-2xl flex items-center justify-center relative ${
                    isPlaying ? 'animate-spin [animation-duration:8s]' : ''
                  }`}
                >
                  {/* Vinyl record grooves */}
                  <div className="absolute inset-2 rounded-full border border-white/5" />
                  <div className="absolute inset-4 rounded-full border border-white/5" />
                  <div className="absolute inset-7 rounded-full border border-white/5" />

                  {/* Center Label Art */}
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-amber-400/50 relative shadow-inner">
                    {currentTrack?.thumbnail ? (
                      <img src={currentTrack.thumbnail} alt="Album Art" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-tr from-purple-900 to-indigo-900 flex items-center justify-center">
                        <Disc3 className="w-6 h-6 text-amber-400" />
                      </div>
                    )}
                  </div>
                  {/* Spindle hole */}
                  <div className="absolute w-3 h-3 rounded-full bg-[#0a0d18] border border-white/40" />
                </div>

                {/* Deck indicator badge overlay */}
                <div className="absolute -top-1 -left-1 bg-cyan-500/90 text-black font-black text-[9px] px-1.5 py-0.5 rounded-md shadow">
                  DECK {engine.activeDeck}
                </div>
              </div>

              {/* Track Info & Scrubber & Transport Controls */}
              <div className="flex-1 min-w-0 w-full flex flex-col gap-3">
                {/* Title, Artist, & Hook Trigger */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight truncate" title={currentTrack ? currentTrack.title : 'No Track Loaded'}>
                      {currentTrack ? currentTrack.title : 'No Track Loaded'}
                    </h2>
                    <p className="text-xs text-slate-400 font-medium truncate">
                      {currentTrack ? currentTrack.artist : 'Load a track or select a banger from the right'}
                    </p>
                  </div>

                  {/* BPM & Hook Cue indicator */}
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    <span className="text-[11px] font-mono text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg">
                      {playbackState.effectiveBpm.toFixed(0)} BPM
                    </span>
                    {currentTrack?.highlightTime !== undefined && (
                      <span className="text-[10px] font-bold text-orange-400 flex items-center gap-0.5">
                        <span>🔥</span>
                        <span>Hook: {formatTime(currentTrack.highlightTime)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Time Scrubber */}
                <div className="w-full flex flex-col gap-1">
                  <input
                    type="range"
                    min="0"
                    max={playbackState.duration || 100}
                    step="1"
                    value={playbackState.currentTime || 0}
                    onChange={(e) => activeDeck.seek(parseFloat(e.target.value))}
                    className="w-full h-1.5 cursor-pointer fader-a"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>{formatTime(playbackState.currentTime)}</span>
                    <span className="text-slate-500 text-[10px]">
                      {playbackState.duration > 0 ? `${formatTime(playbackState.duration)} Total` : '0:00'}
                    </span>
                    <span>-{formatTime(Math.max(0, playbackState.duration - playbackState.currentTime))}</span>
                  </div>
                </div>

                {/* Transport Buttons: Prev, -10s, Play/Pause, STOP, +10s, Next */}
                <div className="flex items-center justify-between gap-1.5 pt-1">
                  <div className="flex items-center gap-1.5">
                    {/* Previous Track */}
                    <button
                      onClick={() => engine.prevTrack()}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
                      title="Restart or Previous Song"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    {/* Rewind 10s */}
                    <button
                      onClick={() => engine.seekCurrent(-10)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
                      title="Rewind 10s"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    {/* Play / Pause Primary Button */}
                    <button
                      onClick={() => engine.togglePlayCurrent()}
                      className={`px-4 py-2 rounded-xl font-black shadow-lg active:scale-95 transition-all flex items-center gap-1.5 ${
                        isPlaying
                          ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/30'
                          : 'bg-white hover:bg-slate-200 text-black shadow-white/20'
                      }`}
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4 fill-current" />
                          <span className="text-xs">PAUSE</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                          <span className="text-xs">PLAY</span>
                        </>
                      )}
                    </button>

                    {/* Dedicated STOP Button */}
                    <button
                      onClick={() => engine.stopAll()}
                      className="px-3 py-2 rounded-xl font-bold bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/40 shadow-md active:scale-95 transition-all flex items-center gap-1"
                      title="Stop all playback, silence background drums, and reset"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span className="text-xs">STOP</span>
                    </button>

                    {/* Forward 10s */}
                    <button
                      onClick={() => engine.seekCurrent(10)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
                      title="Forward 10s"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>

                    {/* Next Song / Mix */}
                    <button
                      onClick={() => engine.nextTrack()}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 active:scale-95 transition-all"
                      title="Mix Smoothly into Next Song"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Play World's Favorite Part Button (Drop to Hook) */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => engine.jumpToHook()}
                      disabled={!currentTrack}
                      className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-black font-black px-3 py-1.5 rounded-xl text-xs shadow-md shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-40"
                      title="Jump immediately to the world's most liked part / viral hook"
                    >
                      <span>🔥</span>
                      <span className="hidden sm:inline">PLAY BEST PART</span>
                      <span className="sm:hidden">HOOK</span>
                    </button>

                    <button
                      onClick={() => engine.toggleAutoCueHook()}
                      className={`px-2 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${
                        engine.autoCueViralHook
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                      }`}
                      title="Auto-Cue Viral Hook on next songs"
                    >
                      Auto-Cue: {engine.autoCueViralHook ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Compact Live Rhythm Enhancer (Deck P - Cherry on Top) */}
          <div className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#14101e]/95 to-[#0c0914]/95 shadow-xl flex flex-col gap-2.5">
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
                  {percussion.currentBpm} BPM
                </span>
              </div>
            </div>

            {/* Compact 4-Style Drum Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {PERCUSSION_PATTERNS.map((p) => (
                <button
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
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
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
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (percussion.isPlaying) {
                      engine.percussionDeck.stop();
                    } else {
                      engine.percussionDeck.play();
                    }
                  }}
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
        </div>

        {/* Right Column (5 cols): Most Played Bangers + Up Next Party Queue */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* Most Played Bangers (Quick Starters) */}
          <div className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#131926]/95 to-[#0b0e17]/95 shadow-xl flex flex-col gap-2">
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

            {/* List of top 3 most played starters */}
            <div className="flex flex-col gap-1.5">
              {engine.mostPlayedSongs.slice(0, 3).map((song) => (
                <div
                  key={song.id}
                  className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-amber-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm"
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
              ))}
            </div>
          </div>

          {/* Up Next Party Queue & Instant Song Search */}
          <div className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl flex flex-col gap-2">
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
            <form onSubmit={(e) => handleSearchSubmit(e, false)} className="flex gap-1.5">
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
                disabled={isSearching || !searchQuery.trim()}
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-3 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Queue</span>
              </button>
            </form>

            {/* Scrollable Queue List */}
            <div className="flex flex-col gap-1.5 max-h-[145px] overflow-y-auto pr-1">
              {engine.queue.length === 0 ? (
                <div className="text-center py-4 text-[11px] text-slate-500 font-medium">
                  Queue empty. AI will auto-curate bangers when track plays!
                </div>
              ) : (
                engine.queue.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-1.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between gap-2 text-xs hover:border-white/20 transition-all"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-[9px] text-slate-500 w-3">#{idx + 1}</span>
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="Thumb" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                          <Music className="w-3 h-3 text-slate-400" />
                        </div>
                      )}
                      <div className="flex flex-col truncate">
                        <span className="font-bold text-white text-[11px] truncate max-w-[170px]" title={item.title}>
                          {item.title}
                        </span>
                        <span className="text-[9px] text-slate-400 truncate">{item.artist}</span>
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* In-App Editor Modal for my_songs.txt */}
      {isEditingFile && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
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
