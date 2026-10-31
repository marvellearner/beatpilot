import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AudioEngine } from '../../audio/AudioEngine';
import { RhythmPanel } from './RhythmPanel';
import { LocalLibraryPanel } from './LocalLibraryPanel';
import { MoodEqPanel } from './MoodEqPanel';
import { TempoControl } from './TempoControl';
import { PreviouslyPlayedPanel } from './PreviouslyPlayedPanel';
import { PLAY_LOG_MAX } from '../../audio/engine/SongLibrary';
import { getCamelotDetails, shiftKey } from '../../audio/KeyDetector';
import { isStrictStartSong } from '../../audio/songMatch';
import { VuMeter } from './VuMeter';
import { UpNextQueueItem } from './UpNextQueueItem';
import { SearchResult } from '../../types';
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
  Star,
  Heart,
  ThumbsDown,
  FileText,
  Edit3,
  Check,
  X,
  Square,
  Flame,
  Lock,
  Scissors,
  Loader2,
  Target,
  RefreshCw,
} from 'lucide-react';

interface PartyConsoleViewProps {
  engine: AudioEngine;
  headerSlot?: HTMLElement | null; // where the app's top bar takes this console's my_songs.txt buttons
}

export const PartyConsoleView: React.FC<PartyConsoleViewProps> = ({ engine, headerSlot }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bangersTab, setBangersTab] = useState<'favorites' | 'most_played' | 'banned'>('favorites');

  // Debounced search query listener for opening matching songs dropdown
  useEffect(() => {
    const q = searchQuery.trim();
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`, {
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
          console.error('Error fetching search matches:', err);
        }
      } finally {
        if (!abortCtrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeDeck = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
  const playbackState = activeDeck.getPlaybackState();
  const currentTrack = playbackState.track;
  const isPlaying = playbackState.isPlaying;
  const pendingMix = engine.getPendingMixInfo();

  // Now Playing card
  const duration = playbackState.duration || 0;
  const remaining = Math.max(0, duration - playbackState.currentTime);
  const progress = duration > 0 ? Math.min(1, playbackState.currentTime / duration) : 0;
  const peaks = currentTrack?.waveformPeaks?.length ? currentTrack.waveformPeaks : null;
  const originalBpm = currentTrack ? currentTrack.original?.bpm ?? currentTrack.bpm : undefined;
  const markerRatio = (time?: number) => (duration > 0 && time !== undefined && time > 0 && time < duration ? time / duration : null);
  const hookRatio = markerRatio(currentTrack?.highlightTime);
  const cueRatio = markerRatio(currentTrack?.cueInTime);
  const mixLoadingItem = engine.mixLoadingId ? engine.queue.find((q) => q.id === engine.mixLoadingId) : null;
  const deckStatus = engine.isTransitioning
    ? { label: 'MIXING', className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30', dotClassName: 'bg-cyan-400 animate-pulse' }
    : pendingMix
      ? {
          label: `MIX IN ${Math.ceil(pendingMix.startsInSeconds)}s`,
          className: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30',
          dotClassName: 'bg-cyan-400',
        }
      : mixLoadingItem
        ? {
            label: 'LOADING NEXT MIX…',
            className: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
            dotClassName: 'bg-amber-400 animate-pulse',
          }
      : isPlaying && playbackState.isBuffering
        ? { label: 'BUFFERING…', className: 'text-amber-200 bg-amber-500/10 border-amber-500/30', dotClassName: 'bg-amber-400 animate-pulse' }
      : isPlaying && playbackState.isStreaming
        ? { label: 'ON AIR · STREAMING', className: 'text-rose-200 bg-rose-500/10 border-rose-500/30', dotClassName: 'bg-rose-500 animate-pulse' }
      : isPlaying
        ? { label: 'ON AIR', className: 'text-rose-200 bg-rose-500/10 border-rose-500/30', dotClassName: 'bg-rose-500 animate-pulse' }
        : currentTrack
          ? { label: 'PAUSED', className: 'text-amber-200 bg-amber-500/10 border-amber-500/30', dotClassName: 'bg-amber-400' }
          : { label: 'IDLE', className: 'text-slate-400 bg-white/5 border-white/10', dotClassName: 'bg-slate-500' };


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

  const handleSelectSong = async (song: SearchResult, autoMix: boolean = false) => {
    setIsDropdownOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    showToast(`${autoMix ? 'Mixing in & AI reading mood' : 'Queued at top of Up Next'}: "${song.title}"`);
    await engine.acquireTrack(song.url || `${song.title} ${song.author}`, autoMix, 'front', 'request', autoMix);
  };

  const handleSearchSubmit = async (e: React.FormEvent, autoMix: boolean = false) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Use top match if dropdown has results, or user's exact query
    const topMatch = searchResults[0];
    const targetQuery = topMatch ? topMatch.url : searchQuery.trim();
    const displayTitle = topMatch ? topMatch.title : searchQuery.trim();

    setIsDropdownOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    showToast(`${autoMix ? 'Mixing in & AI reading mood' : 'Queued at top of Up Next'}: "${displayTitle}"`);
    await engine.acquireTrack(targetQuery, autoMix, 'front', 'request', autoMix);
  };

  // The queue / history / favourites column is the biggest part of the page and changes far less
  // often than the player above it, which re-renders several times a second. It is rebuilt only
  // when its own data changes (getSyncSignature covers the queue, history, favourites and bans).
  const rightColumnKey = engine.getSyncSignature();
  const rightColumn = useMemo(
    () => {
      const readyCount = engine.queue.filter((q) => q.status === 'ready').length;
      const totalQueueDurationSec = engine.queue.reduce((acc, q) => acc + (q.duration || 210), 0);
      const totalQueueHours = Math.floor(totalQueueDurationSec / 3600);
      const totalQueueMins = Math.round((totalQueueDurationSec % 3600) / 60);
      const queueDurationStr = totalQueueHours > 0 ? `${totalQueueHours}h ${totalQueueMins}m` : `${totalQueueMins}m`;
      const curKey = currentTrack?.key
        ? (engine.keyLock ? currentTrack.key : shiftKey(currentTrack.key, playbackState.playbackRate))
        : undefined;

      return (
        <>
          {/* Right Column (27.5% width): Up Next Party Queue + Previously Played + Most Played Bangers */}
          <div id="party-console-right-column" className="flex flex-col gap-3 min-w-0">
            {/* Up Next Party Queue & Instant Song Search */}
            <div id="party-console-queue" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/25 to-purple-500/25 border border-cyan-500/30 flex items-center justify-center shadow-sm">
                    <Music className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-black text-xs text-white tracking-wide">
                        UP NEXT QUEUE
                      </h3>
                      <span className="font-mono text-[9px] font-extrabold px-1.5 py-0.2 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        {engine.queue.length}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5 pt-0.5">
                      <span className="text-emerald-400 font-bold">{readyCount} ready</span>
                      <span>•</span>
                      <span className="text-amber-300 font-medium">~{queueDurationStr} flow</span>
                      {engine.diskCacheCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-cyan-400" title={`Audio saved to disk at cache/audio: ${engine.diskCacheCount} songs (~${engine.diskCacheMb} MB)`}>
                            💾 {engine.diskCacheCount} disk
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {engine.queue.length > 1 && (
                    <button
                      id="party-console-sort-harmonic-btn"
                      type="button"
                      onClick={() => {
                        const count = engine.sortQueueHarmonically();
                        if (count > 0) {
                          showToast(`🪄 Sorted ${count} songs into harmonic Camelot flow!`);
                        }
                      }}
                      className="px-2.5 py-1 rounded-xl text-[10px] font-extrabold font-mono bg-gradient-to-r from-purple-500/25 via-indigo-500/25 to-pink-500/25 hover:from-purple-500/40 hover:to-indigo-500/40 text-purple-200 border border-purple-500/40 hover:border-purple-300 transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                      title="Sort by key: reorder Up Next with the Camelot wheel so each song's key fits the next (no clashes)"
                    >
                      <Sparkles className="w-3 h-3 text-purple-300 animate-pulse" />
                      <span>Sort by key</span>
                    </button>
                  )}
                  <button
                    id="party-console-refresh-queue-btn"
                    type="button"
                    onClick={() => void engine.refreshQueue()}
                    disabled={engine.refreshingQueue}
                    className="px-2.5 py-1 rounded-xl text-[10px] font-extrabold font-mono bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
                    title="Refresh Up Next: new picks from the song playing, your taste and the mood. Keeps songs you added and the next 3."
                  >
                    <RefreshCw className={`w-3 h-3 ${engine.refreshingQueue ? 'animate-spin' : ''}`} />
                    <span>{engine.refreshingQueue ? 'Refreshing' : 'Refresh'}</span>
                  </button>
                </div>
              </div>

              {/* "Play only / more <artist>" from the AI chat */}
              {engine.artistFocus && (
                <div
                  id="party-console-artist-focus"
                  className="flex items-center justify-between gap-2 text-[11px] bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg px-2.5 py-1.5"
                >
                  <span className="text-fuchsia-100 truncate">
                    {engine.artistFocus.only ? 'Only' : 'More'}: <span className="font-bold">{engine.artistFocus.artists.join(' & ')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => engine.clearArtistFocus()}
                    className="p-0.5 rounded text-fuchsia-200 hover:text-white hover:bg-white/10 shrink-0"
                    title="Back to normal: play all your music"
                    aria-label="Clear artist filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Easy Song Request Input with Matching Songs Dropdown */}
              <div ref={searchContainerRef} className="relative z-30">
                <form id="party-console-song-request-form" onSubmit={(e) => handleSearchSubmit(e, false)} className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search song name or YouTube link..."
                      value={searchQuery}
                      onFocus={() => {
                        if (searchQuery.trim().length >= 2) setIsDropdownOpen(true);
                      }}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-12 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
                    />
                    {isSearching && (
                      <Loader2 className="w-3.5 h-3.5 absolute right-6 top-1/2 -translate-y-1/2 text-cyan-400 animate-spin" />
                    )}
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSearchResults([]);
                          setIsDropdownOpen(false);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-0.5 rounded transition-colors"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!searchQuery.trim()}
                    className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0 shadow-md shadow-cyan-500/20"
                    title="Queue next (at top of Up Next)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Queue</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleSearchSubmit(e, true)}
                    disabled={!searchQuery.trim()}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0 shadow-md shadow-orange-500/20"
                    title="Play: mixes this song in now, and the AI reads its mood and moves 5 matching songs to the top of Up Next"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Play</span>
                  </button>
                </form>

                {/* Matching Songs Dropdown */}
                {isDropdownOpen && searchQuery.trim().length >= 2 && (
                  <div
                    id="party-console-search-dropdown"
                    className="absolute left-0 right-0 top-full mt-1.5 bg-[#0e1322]/98 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-[440px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-cyan-500/30 scrollbar-track-transparent animate-in fade-in slide-in-from-top-1 duration-150 ring-1 ring-black/80"
                  >
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-slate-400 border-b border-white/10 mb-1">
                      <span className="flex items-center gap-1.5 font-bold text-cyan-300">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        MATCHING SONGS {searchResults.length > 0 ? `(${searchResults.length})` : ''}
                      </span>
                      <span className="text-[9px] text-slate-400">Click to play & sync mood, or use + Queue</span>
                    </div>

                    {isSearching && searchResults.length === 0 ? (
                      <div className="flex items-center justify-center gap-2 py-7 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                        <span>Searching song catalog...</span>
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 flex flex-col gap-1">
                        <span>No direct matches found for &quot;{searchQuery}&quot;</span>
                        <span className="text-[10px] text-slate-500">Press Enter or click Queue to auto-search & fetch.</span>
                      </div>
                    ) : (
                      searchResults.map((song, idx) => (
                        <div
                          id={`party-console-search-item-${idx}`}
                          key={song.url || idx}
                          onClick={() => handleSelectSong(song, true)}
                          className="group/item flex items-center justify-between gap-2.5 p-2 rounded-xl bg-black/30 hover:bg-white/10 border border-white/5 hover:border-cyan-500/40 cursor-pointer transition-all shrink-0"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10">
                              {song.thumbnail ? (
                                <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-900">
                                  <Music className="w-4 h-4 text-slate-400" />
                                </div>
                              )}
                              {song.timestamp && (
                                <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono font-bold bg-black/85 px-1 rounded text-white/90">
                                  {song.timestamp}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-col min-w-0 flex-1">
                              <span
                                className="text-xs font-bold text-white group-hover/item:text-cyan-300 transition-colors line-clamp-2 leading-snug break-words"
                                title={song.title}
                              >
                                {song.title}
                              </span>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                <span className="truncate">{song.author}</span>
                                {song.highlightTime !== undefined && (
                                  <span className="text-amber-400 font-bold flex items-center gap-0.5 shrink-0" title="Viral hook moment">
                                    🔥 Hook {formatTime(song.highlightTime)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleSelectSong(song, false)}
                              className="py-1 px-2.5 bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-black border border-cyan-500/40 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                              title="Add to top of Up Next Queue"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Queue</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectSong(song, true)}
                              className="py-1 px-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500 hover:to-orange-500 text-amber-300 hover:text-black border border-amber-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                              title="Play: mixes this song in now, and the AI reads its mood and moves 5 matching songs to the top of Up Next"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Play</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Scrollable Queue List */}
              <div id="party-console-queue-list" className="flex flex-col gap-2 max-h-[490px] overflow-y-auto pr-2 py-0.5 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
                {engine.queue.length === 0 ? (
                  <div id="party-console-queue-empty" className="text-center py-10 px-4 rounded-xl bg-black/30 border border-dashed border-white/10 flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Music className="w-5 h-5 text-cyan-400/60" />
                    </div>
                    <span className="text-xs font-bold text-slate-300">Queue is empty</span>
                    <span className="text-[11px] text-slate-500 max-w-[220px]">
                      Search a track above or play any starter song — the AI will curate 50 bangers automatically!
                    </span>
                  </div>
                ) : (
                  engine.queue.map((item, idx) => (
                    <UpNextQueueItem key={item.id} engine={engine} item={item} idx={idx} curKey={curKey} pendingMixId={pendingMix?.id} />
                  ))
                )}
              </div>

              {/* Queue Footer Info Strip */}
              {engine.queue.length > 0 && (
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-2 border-t border-white/10 px-1 shrink-0 bg-black/20 rounded-b-xl">
                  <div className="flex items-center gap-1.5 text-slate-300 text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span className="font-bold">{engine.queue.length} songs loaded</span>
                    <span className="text-slate-500">(~{queueDurationStr} party flow)</span>
                  </div>
                  <span className="text-[9px] text-slate-500 flex items-center gap-1">
                    <span>↕ Auto-curating</span>
                    <span className="text-cyan-400 font-bold">50 target</span>
                  </span>
                </div>
              )}
            </div>

            {/* Previously played songs (newest first); the last 3 hours' are kept out of Up Next */}
            <PreviouslyPlayedPanel
              entries={engine.playLog.slice(0, PLAY_LOG_MAX)}
              onMix={(entry) => engine.acquireTrack(entry.url || `${entry.artist} ${entry.title}`, true)}
            />

            {/* Favourites & Most Played */}
            <div id="party-console-most-played" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#131926]/95 to-[#0b0e17]/95 shadow-xl flex flex-col gap-2">
              <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                {/* Tab Selector */}
                <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setBangersTab('favorites')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      bangersTab === 'favorites'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Heart className={`w-3 h-3 ${engine.favorites.length > 0 ? 'fill-rose-500 text-rose-500' : ''}`} />
                    <span>Favourites</span>
                    <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
                      {engine.favorites.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBangersTab('most_played')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      bangersTab === 'most_played'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>Most Played</span>
                    <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
                      {engine.mostPlayedSongs.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBangersTab('banned')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      bangersTab === 'banned'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Songs saved in Don't Play Again Ever"
                  >
                    <ThumbsDown className="w-3 h-3 text-red-400" />
                    <span>Don&apos;t Play</span>
                    <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
                      {engine.bannedSongs.length}
                    </span>
                  </button>
                </div>

                <span className="text-[10px] text-slate-400 hidden sm:inline">1-Click Play</span>
              </div>

              {/* Favourites Tab View */}
              {bangersTab === 'favorites' ? (
                <div id="party-console-favorites-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
                  {engine.favorites.length === 0 ? (
                    <div id="party-console-favorites-empty" className="text-center py-6 px-3 flex flex-col items-center gap-2 text-slate-500">
                      <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400/80">
                        <Heart className="w-5 h-5" />
                      </div>
                      <p className="text-[11px] font-medium leading-relaxed">
                        No favourites saved yet.<br />
                        Click the <span className="text-rose-400 font-bold">❤️ heart</span> on any song image to save it here!
                      </p>
                    </div>
                  ) : (
                    engine.favorites.map((song) => (
                      <div
                        id={`party-console-favorite-item-${song.id}`}
                        key={song.id}
                        className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-rose-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 group/favthumb">
                            {song.thumbnail ? (
                              <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-rose-950 to-slate-900">
                                <Music className="w-3.5 h-3.5 text-rose-400" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                engine.toggleFavorite(song);
                              }}
                              className="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity opacity-0 group-hover/favthumb:opacity-100"
                              title="Remove from Favourites"
                            >
                              <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                            </button>
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-rose-300 transition-colors" title={song.title}>
                              {song.title}
                            </span>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span className="truncate">{song.artist}</span>
                              {song.bpm && (
                                <span className="font-mono text-cyan-300/90 font-bold shrink-0">
                                  {Math.round(song.bpm)} BPM
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => engine.acquireTrack(song.url || `${song.title} ${song.artist}`, false, 'front')}
                            className="p-1 hover:bg-white/10 text-slate-400 hover:text-cyan-300 rounded-lg text-[10px] font-bold transition-all"
                            title="Add to top of Up Next Queue"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => engine.playStarterSong(song.id)}
                            className="py-1 px-2.5 bg-gradient-to-r from-rose-500/20 to-orange-500/20 hover:from-rose-500 hover:to-orange-500 text-rose-300 hover:text-black border border-rose-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                            title="Start playing now"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>Play</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* Top Bangers Tab View */
                <div id="party-console-most-played-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
                  {engine.mostPlayedSongs.length === 0 ? (
                    <div id="party-console-most-played-empty" className="text-center py-6 text-[11px] text-slate-500 font-medium">
                      {engine.rawMostPlayedSongsList.length > 0
                        ? 'All top bangers are currently queued or already played.'
                        : 'No play history yet. Play songs to see your top party bangers here!'}
                    </div>
                  ) : (
                    engine.mostPlayedSongs.map((song) => (
                      <div id={`party-console-most-played-item-${song.id}`}
                        key={song.id}
                        className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-amber-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 group/bangerthumb">
                            {song.thumbnail ? (
                              <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-purple-900 to-indigo-900">
                                <Music className="w-3.5 h-3.5 text-amber-400" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                engine.toggleFavorite(song);
                              }}
                              className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                                engine.isFavorite(song) ? 'opacity-100 bg-black/40' : 'opacity-0 group-hover/bangerthumb:opacity-100'
                              }`}
                              title={engine.isFavorite(song) ? 'Saved in Favourites' : 'Save to Favourites'}
                            >
                              <Heart
                                className={`w-3.5 h-3.5 transition-transform ${
                                  engine.isFavorite(song) ? 'fill-rose-500 text-rose-500' : 'text-white hover:text-rose-400'
                                }`}
                              />
                            </button>
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-amber-300 transition-colors" title={song.title}>
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
                          <span>Play</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Don't Play Again Ever Tab View */}
              {bangersTab === 'banned' && (
                <div id="party-console-banned-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
                  {engine.bannedSongs.length === 0 ? (
                    <div id="party-console-banned-empty" className="text-center py-6 px-3 flex flex-col items-center gap-2 text-slate-500">
                      <div className="p-2.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400/80">
                        <ThumbsDown className="w-5 h-5" />
                      </div>
                      <p className="text-[11px] font-medium leading-relaxed">
                        No blocked songs.<br />
                        Click the <span className="text-red-400 font-bold">👎 thumbs down</span> on any song to permanently block it from playing!
                      </p>
                    </div>
                  ) : (
                    engine.bannedSongs.map((song) => (
                      <div
                        id={`party-console-banned-item-${song.id}`}
                        key={song.id}
                        className="group bg-black/40 hover:bg-black/60 border border-red-500/20 hover:border-red-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10">
                            {song.thumbnail ? (
                              <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-red-950 to-slate-900">
                                <Music className="w-3.5 h-3.5 text-red-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-red-300 transition-colors" title={song.title}>
                              {song.title}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">{song.artist}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => engine.toggleDontPlayAgain(song)}
                          className="py-1 px-2.5 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white border border-red-500/40 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 shadow-sm"
                          title="Remove from Don't Play Again Ever (Unblock)"
                        >
                          <X className="w-2.5 h-2.5" />
                          <span>Unblock</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      );
    },
    [rightColumnKey, searchQuery, searchResults, isSearching, isDropdownOpen, bangersTab, pendingMix?.id,
      engine.isTransitioning, engine.topSongAvoidCount, engine.diskCacheCount, engine.diskCacheMb, currentTrack?.key, engine.keyLock, playbackState.playbackRate]
  );

  return (
    <div id="party-console" className="flex flex-col gap-2.5 max-w-[1440px] mx-auto w-full relative">
      {/* Floating Toast Notification */}
      {toastMessage && (
        <div id="party-console-toast" className="fixed top-5 right-5 z-50 bg-black/90 border border-cyan-500/40 text-cyan-200 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* my_songs.txt actions live in the app's top bar (no row of their own, so the console starts higher) */}
      {headerSlot &&
        createPortal(
          <div id="party-console-my-songs" className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
            <span className="flex items-center gap-1 pl-1.5 pr-1 text-[11px] text-slate-400" title="Your song list (my_songs.txt)">
              <FileText className="w-3 h-3 text-cyan-400" />
              <span className="hidden min-[1800px]:inline">my_songs.txt</span>
            </span>
            <button
              onClick={handleLoadMySongs}
              disabled={isLoadingSongs}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 transition-all disabled:opacity-60"
              title="Load songs from my_songs.txt"
            >
              {isLoadingSongs ? 'Loading…' : 'Load'}
            </button>
            <button
              onClick={handleOpenEditor}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-all"
              title="View or add songs to my_songs.txt"
            >
              <Edit3 className="w-3 h-3 text-amber-400" />
              Edit
            </button>
          </div>,
          headerSlot
        )}

      {/* 3-Column Dashboard Grid: player (38-40%) | sound controls (25%) | queue & history (35-37%) */}
      <div id="party-console-grid" className="grid grid-cols-1 lg:grid-cols-[minmax(0,40fr)_minmax(0,25fr)_minmax(0,35fr)] xl:grid-cols-[minmax(0,38fr)_minmax(0,25fr)_minmax(0,37fr)] gap-3 items-start">
        {/* Left Column (45% width, decreased by 5% from 50%): Live Party Player */}
        <div id="party-console-left-column" className="flex flex-col gap-3 min-w-0">
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
              <span
                id="party-console-deck-status"
                className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${deckStatus.className}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${deckStatus.dotClassName}`} />
                {deckStatus.label}
              </span>
            </div>

            {/* Lined Up Mix: prominently displays the song lined up to mix with live countdown and one-click Mix Now / Cancel */}
            {(pendingMix || mixLoadingItem) && (
              <div
                id="party-console-lined-up-mix"
                className="mx-4 mt-3 p-3 rounded-xl bg-gradient-to-r from-cyan-950/80 via-blue-950/60 to-purple-950/70 border border-cyan-500/40 shadow-xl shadow-cyan-500/10 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-150"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Thumbnail / Animated Disc */}
                  <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-slate-900 border border-cyan-500/30 flex items-center justify-center shadow-md">
                    {(pendingMix?.thumbnail || mixLoadingItem?.thumbnail) ? (
                      <img
                        src={pendingMix?.thumbnail || mixLoadingItem?.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Disc3 className="w-6 h-6 text-cyan-400 animate-spin [animation-duration:8s]" />
                    )}
                    <span className="absolute bottom-0 right-0 px-1 py-0.2 bg-cyan-500 text-[8px] font-black text-black rounded-tl shadow-sm">
                      NEXT
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase flex items-center gap-1.5 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                        LINED UP TO MIX
                      </span>
                      {pendingMix && (
                        <span className="text-[11px] font-mono font-extrabold text-cyan-200 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-400/40 shadow-sm animate-pulse">
                          ⏱ in {Math.ceil(pendingMix.startsInSeconds)}s
                        </span>
                      )}
                      {pendingMix?.harmonicShift && (
                        <span
                          className="text-[9px] font-mono font-bold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded-full"
                          title="Energy & harmonic flow compatibility"
                        >
                          ⚡ {pendingMix.harmonicShift}
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline gap-2 truncate mt-1">
                      <span
                        className="text-xs sm:text-sm font-extrabold text-white truncate leading-snug"
                        title={pendingMix?.title || mixLoadingItem?.title}
                      >
                        {pendingMix?.title || mixLoadingItem?.title}
                      </span>
                      {(pendingMix?.artist || mixLoadingItem?.artist) && (
                        <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                          by {pendingMix?.artist || mixLoadingItem?.artist}
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] font-mono text-slate-300 flex items-center gap-1.5 truncate mt-0.5">
                      {pendingMix ? (
                        <>
                          <span className="text-cyan-300 font-semibold truncate" title={pendingMix.reason}>
                            {pendingMix.reason}
                          </span>
                          {pendingMix.entryTime > 0 && (
                            <>
                              <span className="text-slate-500">•</span>
                              <span className="text-slate-400">enters at {formatTime(pendingMix.entryTime)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-300 font-semibold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                          Loading track audio… will mix in automatically once ready
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {pendingMix && (
                    <button
                      type="button"
                      onClick={() => engine.nextTrack()}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/25 transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                      title="Mix now immediately (skip phrase wait)"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Mix now</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => engine.cancelPendingMix()}
                    className="px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white font-semibold text-xs border border-white/10 transition-colors active:scale-95 cursor-pointer"
                    title="Cancel lined up mix"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

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
                  {/* Loop Region on Waveform (Virtual DJ style) */}
                  {playbackState.loop && (() => {
                    const lStartRatio = markerRatio(playbackState.loop.start);
                    const lEndRatio = markerRatio(playbackState.loop.end);
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
                  {playbackState.loopInTime !== null && !playbackState.loop && (() => {
                    const inRatio = markerRatio(playbackState.loopInTime);
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

              {/* Virtual DJ Style Manual Loop (IN / OUT / EXIT) & Beat Loop Bar */}
              <div
                id="party-console-loop-controls"
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/10 shadow-inner"
              >
                {/* Manual loop controls: Loop in, Loop out, Reloop */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex items-center gap-1 text-[10px] font-black tracking-wider text-slate-400 px-1 font-mono">
                    <RotateCw className="w-3 h-3 text-cyan-400" />
                    <span>LOOP:</span>
                  </div>

                  {/* IN (START) BUTTON */}
                  <button
                    id="party-console-loop-in-btn"
                    type="button"
                    onClick={() => engine.setLoopIn()}
                    disabled={!currentTrack || !isPlaying}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide border transition-all active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5 ${
                      playbackState.loopInTime !== null && !playbackState.loop
                        ? 'bg-amber-500 text-black border-amber-400 animate-pulse shadow-md shadow-amber-500/30'
                        : playbackState.loop
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-white/5 hover:bg-white/15 text-slate-200 border-white/10 hover:border-white/20'
                    }`}
                    title="Press to set Loop IN (Start point) at current playback position"
                  >
                    <span>Loop in</span>
                    {playbackState.loopInTime !== null && !playbackState.loop && <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping" />}
                  </button>

                  {/* OUT (END) BUTTON */}
                  <button
                    id="party-console-loop-out-btn"
                    type="button"
                    onClick={() => engine.setLoopOut()}
                    disabled={!currentTrack || !isPlaying}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wide border transition-all active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5 ${
                      playbackState.loop
                        ? 'bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/30'
                        : playbackState.loopInTime !== null
                        ? 'bg-amber-500/20 text-amber-300 border-amber-400 animate-bounce'
                        : 'bg-white/5 hover:bg-white/15 text-slate-200 border-white/10 hover:border-white/20'
                    }`}
                    title={
                      playbackState.loop
                        ? 'Song is stuck in loop! Click to exit loop and continue playing'
                        : 'Press to set Loop OUT (End point) and start looping'
                    }
                  >
                    <span>Loop out</span>
                    {playbackState.loop && <span className="font-mono text-[10px]">⟲</span>}
                  </button>

                  {/* EXIT / RELOOP BUTTON */}
                  <button
                    id="party-console-reloop-btn"
                    type="button"
                    onClick={() => engine.reloop()}
                    disabled={!currentTrack || (!playbackState.loop && !playbackState.hasLastLoop)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-30 cursor-pointer ${
                      playbackState.loop
                        ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40 shadow-sm'
                        : 'bg-white/5 hover:bg-white/15 text-slate-300 border-white/10'
                    }`}
                    title={playbackState.loop ? 'Exit current loop (play forward)' : 'Reloop (re-enter last saved loop)'}
                  >
                    {playbackState.loop ? 'EXIT LOOP' : 'RELOOP'}
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
                    title="Jump to the world's most replayed part of this song"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Best part
                  </button>
                  <label
                    className="inline-flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none"
                    title="For a dancing crowd: each song plays only its build-up and hook (about 1–1.5 min), then mixes into the next"
                  >
                    <span>Best parts only</span>
                    <button
                      role="switch"
                      aria-label="Best parts only"
                      aria-checked={engine.bestPartsMode}
                      onClick={() => engine.toggleBestParts()}
                      className={`relative w-8 h-[18px] rounded-full transition-colors ${
                        engine.bestPartsMode ? 'bg-orange-500' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                          engine.bestPartsMode ? 'translate-x-3.5' : ''
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
                      title="Mix now immediately (skip phrase wait)"
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

        {/* Middle Column (27.5% width): Live Rhythm Enhancer + Mood & Equalizer */}
        <div id="party-console-middle-column" className="flex flex-col gap-3 min-w-0">
          {/* Live Rhythm Enhancer (Deck P) */}
          <RhythmPanel rhythm={engine.rhythm.getState()} onCommand={(cmd) => engine.rhythmCommand(cmd)} />

          {/* Mood tabs + master equalizer (bass control) */}
          <MoodEqPanel
            compact
            mood={engine.mood}
            eqGains={engine.eqGains}
            onSetMood={(m) => engine.setMood(m)}
            onSetEq={(band, db) => engine.setEqBand(band, db)}
            onResetEq={() => engine.resetEq()}
          />

          {/* Offline library: songs on this laptop + most-played songs saved as MP3 */}
          <LocalLibraryPanel offlineOnly={engine.offlineOnly} onToggleOfflineOnly={() => engine.toggleOfflineOnly()} />
        </div>

        {rightColumn}
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
