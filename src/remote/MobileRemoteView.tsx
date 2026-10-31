import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/**
 * A slider driven by the laptop's value that follows the finger while dragging: the synced value
 * arrives a moment late and would pull the thumb back. Sends at most every SEND_EVERY_MS while
 * dragging, and the final value on release.
 */
const SEND_EVERY_MS = 80;
function useDragSlider(synced: number, send: (v: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const lastSent = useRef(0);
  const latest = useRef(synced);
  const onChange = (v: number) => {
    latest.current = v;
    setDragging(v);
    if (Date.now() - lastSent.current >= SEND_EVERY_MS) {
      lastSent.current = Date.now();
      send(v);
    }
  };
  const release = () => {
    if (dragging === null) return;
    send(latest.current);
    // Hold the thumb until the laptop's answer has had time to arrive
    window.setTimeout(() => setDragging(null), 600);
  };
  return {
    value: dragging ?? synced,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value)),
    onPointerUp: release,
    onTouchEnd: release,
    onKeyUp: release,
    onBlur: release,
  };
}
import { HostSyncState, MobileAction, SearchResult, TempoInfo } from '../types';
import { MoodEqPanel } from '../renderer/components/MoodEqPanel';
import { RhythmPanel } from '../renderer/components/RhythmPanel';
import { TempoControl } from '../renderer/components/TempoControl';
import { PreviouslyPlayedPanel } from '../renderer/components/PreviouslyPlayedPanel';
import { MixToast } from '../renderer/components/MixToast';
import { getCamelotDetails, getHarmonicCompatibility } from '../audio/KeyDetector';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Search,
  Plus,
  Zap,
  Disc3,
  Wifi,
  Sparkles,
  ListMusic,
  ArrowRightLeft,
  Star,
  Heart,
  ThumbsDown,
  FileText,
  Square,
  Music,
  Loader2,
  X,
  ArrowUp,
  RefreshCw,
  Volume2,
  Volume1,
  VolumeX,
  Laptop,
  Send,
  Cpu,
  CheckCircle,
  Terminal,
} from 'lucide-react';

interface MobileRemoteViewProps {
  syncState: HostSyncState;
  connected: boolean;
  onSendAction: (action: MobileAction) => void;
}

const formatAiModelDisplay = (name: string | null | undefined): string => {
  if (!name) return 'Qwen 2.5 1.5B';
  if (/1\.5b/i.test(name)) return 'Qwen 2.5 1.5B';
  if (/3b/i.test(name)) return 'Qwen 2.5 3B';
  if (/0\.5b/i.test(name)) return 'Qwen 2.5 0.5B';
  return name.replace(/^gemini-/, '');
};

const samplePrompts = ['Play only Diljit Dosanjh', 'Play more AP Dhillon', 'Start the dhol', 'Mix now', 'Play anything'];


/**
 * The phone's volume card: the laptop's Windows volume (set by the server, see remoteHub.ts) and
 * the DJ app's own gain. Its own component so that moving a slider redraws only this card, not
 * the whole remote page (queue, history…), which made dragging crawl on a phone.
 */
const VolumeCard: React.FC<{
  laptopVolume: number | null;
  laptopMuted: boolean;
  masterVolume: number;
  send: (action: MobileAction) => void;
}> = ({ laptopVolume, laptopMuted, masterVolume, send }) => {
  const laptopSlider = useDragSlider(laptopMuted ? 0 : (laptopVolume ?? 0), (volume) => send({ type: 'CMD_SET_LAPTOP_VOLUME', volume }));
  const appGainSlider = useDragSlider(masterVolume, (volume) => send({ type: 'CMD_SET_MASTER_VOLUME', volume }));
  return (
    <div id="remote-master-volume-card" className="w-full rounded-xl bg-white/5 border border-white/10 p-2.5 space-y-2">
      {/* Laptop Master Volume Header */}
      <div className="flex items-center justify-between text-[11px] text-slate-300">
        <div className="flex items-center gap-1.5 font-bold text-cyan-300">
          <Laptop className="w-3.5 h-3.5" />
          <span>Laptop Master</span>
          {laptopMuted && (
            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 text-[9px] font-mono font-bold">
              MUTED
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => send({ type: 'CMD_SET_LAPTOP_VOLUME', volume: 0.3 })}
            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-mono text-slate-400 active:scale-95"
          >
            30%
          </button>
          <button
            type="button"
            onClick={() => send({ type: 'CMD_SET_LAPTOP_VOLUME', volume: 0.7 })}
            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-mono text-slate-400 active:scale-95"
          >
            70%
          </button>
          <button
            type="button"
            onClick={() => send({ type: 'CMD_SET_LAPTOP_VOLUME', volume: 1.0 })}
            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-mono text-slate-400 active:scale-95"
          >
            100%
          </button>
        </div>
      </div>

      {/* Main Laptop Hardware Volume Slider */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          id="remote-volume-mute-btn"
          onClick={() => send({ type: 'CMD_TOGGLE_LAPTOP_MUTE' })}
          className="text-slate-400 hover:text-white transition-colors shrink-0 active:scale-90"
          title={laptopMuted ? 'Unmute Laptop' : 'Mute Laptop'}
        >
          {laptopMuted || laptopSlider.value === 0 ? (
            <VolumeX className="w-4 h-4 text-rose-400" />
          ) : laptopSlider.value < 0.5 ? (
            <Volume1 className="w-4 h-4 text-slate-300" />
          ) : (
            <Volume2 className="w-4 h-4 text-cyan-400" />
          )}
        </button>
        <div className="flex-1 flex items-center gap-2">
          <input
            id="remote-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            {...laptopSlider}
            disabled={laptopVolume === null}
            className="w-full h-1.5 bg-white/15 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-40"
            title={laptopVolume === null ? 'Reading the laptop volume…' : `Laptop Hardware Volume: ${Math.round(laptopSlider.value * 100)}%`}
          />
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-300 w-8 text-right shrink-0">
          {laptopVolume === null ? '…' : `${Math.round(laptopSlider.value * 100)}%`}
        </span>
      </div>

      {/* Secondary: DJ App Gain Slider */}
      <div className="pt-1.5 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400">
        <span className="text-slate-400 text-[10px]">DJ App Gain</span>
        <div className="flex items-center gap-2 flex-1 max-w-[180px] ml-auto">
          <input
            id="remote-app-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            {...appGainSlider}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-slate-400"
            title={`DJ App Gain: ${Math.round(appGainSlider.value * 100)}%`}
          />
          <span className="font-mono text-[9px] w-6 text-right text-slate-400">
            {Math.round(appGainSlider.value * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export const MobileRemoteView: React.FC<MobileRemoteViewProps> = ({ syncState, connected, onSendAction }) => {
  const [query, setQuery] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const handleAiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = aiPrompt.trim();
    if (!cmd || syncState.isAiThinking) return;
    onSendAction({ type: 'CMD_AI_INSTRUCT', command: cmd });
    setAiPrompt('');
  };

  const acquisitionStatus = syncState.acquisitionStatus;

  // Mix taps: say at once that it was sent, then show what the laptop did with it
  const [mixToast, setMixToast] = useState<{ text: string; at: number } | null>(null);
  const mixSentAt = useRef(0);
  const sendMix = (action: MobileAction, title: string) => {
    mixSentAt.current = Date.now();
    setMixToast({ text: `Mix sent: "${title}"…`, at: Date.now() });
    onSendAction(action);
  };
  useEffect(() => {
    if (acquisitionStatus && Date.now() - mixSentAt.current < 6000) setMixToast({ text: acquisitionStatus, at: Date.now() });
  }, [acquisitionStatus]);
  const readyCount = syncState.queue.filter((q) => q.status === 'ready').length;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentTrack = syncState.currentTrack;

  const mixPreviouslyPlayed = useCallback(
    (entry: { url?: string; artist: string; title: string }) =>
      sendMixRef.current({ type: 'CMD_MIX_NOW', query: entry.url || `${entry.artist} ${entry.title}` }, entry.title),
    []
  );
  // The Up Next list (often 1,000+ elements) is rebuilt only when the queue, the key of the song on
  // air or the mixing state change, not on every live update (time, tempo…) a few times a second:
  // redrawing it each time kept a phone busy and made the sliders crawl.
  const sendMixRef = useRef<(action: MobileAction, title: string) => void>(() => {});
  sendMixRef.current = sendMix;
  const stableSendMix = useCallback((action: MobileAction, title: string) => sendMixRef.current(action, title), []);
  const queueList = useMemo(() => {
    const sendMix = stableSendMix;
    return (
syncState.queue.length === 0 ? (
              <div id="remote-queue-empty" className="text-center py-6 text-xs text-slate-500 font-mono">
                Queue empty — request a song above, or the AI fills it once music plays.
              </div>
            ) : (
              <div id="remote-queue-list" className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-0.5">
                {syncState.queue.map((item, idx) => {
                  const keyDetails = item.key ? getCamelotDetails(item.key) : null;
                  const curKey = currentTrack?.key;
                  const compat = curKey && item.key ? getHarmonicCompatibility(curKey, item.key) : null;
                  const colorClass = compat
                    ? compat.color === 'emerald'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : compat.color === 'amber'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : compat.color === 'cyan'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : compat.color === 'teal'
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                      : compat.color === 'purple'
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      : compat.color === 'rose'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-white/10 text-slate-300 border-white/10'
                    : 'bg-purple-500/15 text-purple-300 border-purple-500/25';

                  if (idx === 0) {
                    // Mobile #1 On-Deck Hero
                    return (
                      <div
                        id={`remote-queue-hero-${item.id}`}
                        key={item.id}
                        className="p-2.5 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 via-[#0e1626]/90 to-[#0c101c]/95 shadow-md flex flex-col gap-2 ring-1 ring-cyan-500/20"
                      >
                        <div className="flex items-center justify-between gap-1.5 text-[9px] font-mono flex-wrap">
                          <div className="flex items-center gap-1.5 font-extrabold text-cyan-300 uppercase shrink-0 min-w-0">
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
                            </span>
                            <span className="whitespace-nowrap shrink-0">#1 ON DECK • UP NEXT</span>
                          </div>
                          <span
                            className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-black shrink-0 whitespace-nowrap ml-auto ${
                              item.status === 'ready'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : item.status === 'failed'
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-yellow-500/20 text-yellow-300 animate-pulse'
                            }`}
                          >
                            {item.status === 'ready' ? 'READY' : item.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-cyan-500/30 bg-slate-900">
                              {item.thumbnail ? (
                                <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-800">
                                  <Music className="w-3.5 h-3.5 text-cyan-400" />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="font-extrabold text-white text-xs line-clamp-2 leading-snug break-words" title={item.title}>
                                {item.title}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-300 pt-0.5">
                                <span className="text-slate-400 truncate max-w-[110px]">{item.artist}</span>
                                {item.key && keyDetails && (
                                  <span
                                    className={`inline-flex items-center gap-0.5 font-mono text-[8px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}
                                  >
                                    <span>{item.key}</span>
                                    {compat && compat.relation !== 'usable' && (
                                      <span className="font-black ml-0.5">{compat.badgeText}</span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.status !== 'failed' && (
                              <button
                                onClick={() => sendMix({ type: 'CMD_MIX_QUEUED', itemId: item.id }, item.title)}
                                disabled={syncState.isTransitioning}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-black text-[10px] transition-colors shadow-md active:scale-95 disabled:opacity-40"
                              >
                                MIX NOW
                              </button>
                            )}
                            <button
                              onClick={() => onSendAction({ type: 'CMD_REMOVE_QUEUED', itemId: item.id })}
                              className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white text-[10px] transition-colors"
                              title="Remove from queue"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Mobile #2+ Items
                  return (
                    <div
                      id={`remote-queue-item-${item.id}`}
                      key={item.id}
                      className="flex items-center justify-between p-2 bg-black/40 hover:bg-[#121827]/90 rounded-xl border border-white/5 text-xs transition-all"
                    >
                      <div id={`remote-queue-item-info-${item.id}`} className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-mono text-slate-500 text-[9px] w-3 text-center shrink-0">#{idx + 1}</span>
                        <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-slate-800">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music className="w-3 h-3 text-slate-400" />
                            </div>
                          )}
                        </div>
                        <div id={`remote-queue-item-meta-${item.id}`} className="flex flex-col min-w-0 flex-1">
                          <div id={`remote-queue-item-title-row-${item.id}`} className="flex items-center gap-1.5">
                            <span className="font-bold text-white line-clamp-2 leading-snug break-words text-[11px]" title={item.title}>
                              {item.title}
                            </span>
                            {item.isAiRecommended && (
                              <span className="text-[7px] font-mono bg-purple-500/20 text-purple-300 px-1 rounded border border-purple-500/30 font-bold shrink-0">
                                AI
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[9px] text-slate-400 truncate max-w-[100px]">
                              {item.artist}
                            </span>
                            {item.key && keyDetails && (
                              <span
                                className={`inline-flex items-center gap-0.5 font-mono text-[8px] font-bold px-1 py-0.2 rounded border shrink-0 ${colorClass}`}
                              >
                                <span>{item.key}</span>
                                {compat && compat.relation !== 'usable' && (
                                  <span className="font-extrabold ml-0.5">{compat.badgeText}</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div id={`remote-queue-item-actions-${item.id}`} className="flex items-center gap-1 shrink-0">
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

                        {item.status !== 'failed' && (
                          <button
                            onClick={() => sendMix({ type: 'CMD_MIX_QUEUED', itemId: item.id }, item.title)}
                            disabled={syncState.isTransitioning}
                            className="px-2 py-0.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-500 text-cyan-300 hover:text-black font-bold text-[9px] border border-cyan-500/40 transition-colors disabled:opacity-40"
                          >
                            MIX
                          </button>
                        )}
                        <button
                          onClick={() => onSendAction({ type: 'CMD_MOVE_QUEUED', itemId: item.id, direction: 'top' })}
                          className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-cyan-300 text-[10px] transition-colors"
                          title="Play Next (Move to top)"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onSendAction({ type: 'CMD_REMOVE_QUEUED', itemId: item.id })}
                          className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white text-[10px] transition-colors"
                          title="Remove from queue"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncState.queue, currentTrack?.key, syncState.isTransitioning, onSendAction, stableSendMix]);
  const isPlaying = syncState.isPlaying;

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
          console.error('Error fetching mobile search matches:', err);
        }
      } finally {
        if (!abortCtrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

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
      <MixToast notice={mixToast} />
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
        </div>

        {/* Track Info & Actions */}
        <div id="remote-track-info" className="w-full px-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-left">
            <h2 className="font-extrabold text-base text-white truncate" title={currentTrack ? currentTrack.title : 'Waiting for track...'}>
              {currentTrack ? currentTrack.title : 'Waiting for track...'}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {currentTrack ? currentTrack.artist : 'Select a track or request below'}
            </p>
            {currentTrack?.key && (() => {
              const keyDetails = getCamelotDetails(currentTrack.key);
              return (
                <div className="flex items-center gap-1 mt-1">
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <span>🎵</span>
                    <span>{currentTrack.key}</span>
                    <span className="text-[9px] text-purple-200/75">({keyDetails.shortName})</span>
                  </span>
                </div>
              );
            })()}
          </div>

          {currentTrack && (() => {
            const isFav = syncState.favorites?.some(
              (f) =>
                (currentTrack.id && f.id === currentTrack.id) ||
                (currentTrack.url && f.url === currentTrack.url) ||
                (f.title && f.title.trim().toLowerCase() === currentTrack.title?.trim().toLowerCase())
            );
            const isBanned = syncState.bannedSongs?.some(
              (b) =>
                (currentTrack.id && b.id === currentTrack.id) ||
                (currentTrack.url && b.url === currentTrack.url) ||
                (b.title && b.title.trim().toLowerCase() === currentTrack.title?.trim().toLowerCase())
            );
            return (
              <div className="flex items-center gap-1 shrink-0 bg-white/5 p-1 rounded-xl border border-white/10 shadow-sm">
                <button
                  id="remote-favorite-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendAction({ type: 'CMD_TOGGLE_FAVORITE', song: currentTrack });
                  }}
                  className={`p-1.5 rounded-lg transition-all active:scale-95 ${
                    isFav
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-rose-400 hover:bg-white/10'
                  }`}
                  title={isFav ? 'In Favourites (tap to remove)' : 'Save to Favourites'}
                  aria-label={isFav ? 'In Favourites (tap to remove)' : 'Save to Favourites'}
                >
                  <Heart className={`w-4 h-4 transition-transform ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                </button>

                <button
                  id="remote-dislike-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendAction({ type: 'CMD_TOGGLE_DONT_PLAY_AGAIN', song: currentTrack });
                  }}
                  className={`p-1.5 rounded-lg transition-all active:scale-95 ${
                    isBanned
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-red-400 hover:bg-white/10'
                  }`}
                  title={isBanned ? "Don't Play Again (saved)" : "Don't play again ever"}
                  aria-label={isBanned ? "Don't Play Again (saved)" : "Don't play again ever"}
                >
                  <ThumbsDown className={`w-4 h-4 transition-transform ${isBanned ? 'fill-red-500 text-red-500' : ''}`} />
                </button>
              </div>
            );
          })()}
        </div>

        {currentTrack?.highlightTime !== undefined && (
          <div id="remote-highlight-badge-wrapper" className="flex items-center justify-center gap-1.5 -mt-1">
            <span className="text-[10px] font-bold text-amber-400 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <span>🔥 World's Favorite Part:</span>
              <span>{formatTime(currentTrack.highlightTime)}</span>
            </span>
          </div>
        )}

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

        {/* Laptop Master Volume & App Gain Control (its own component: dragging redraws only it) */}
        <VolumeCard
          laptopVolume={syncState.laptopVolume ?? null}
          laptopMuted={!!syncState.laptopMuted}
          masterVolume={syncState.masterVolume ?? 0.9}
          send={onSendAction}
        />

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

        {/* Best part of this song, and Best Parts mode (every song plays only its best part) */}
        <div id="remote-hook-controls" className="w-full grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
          <button
            onClick={() => onSendAction({ type: 'CMD_JUMP_TO_HOOK' })}
            disabled={!currentTrack}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-lg shadow-amber-500/30 active:scale-95 transition-all disabled:opacity-40"
          >
            <span className="text-sm">🔥</span>
            <span>BEST PART</span>
          </button>

          <button
            onClick={() => onSendAction({ type: 'CMD_TOGGLE_BEST_PARTS' })}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl font-bold text-[11px] border transition-all ${
              syncState.bestPartsMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                : 'bg-white/5 text-slate-400 border-white/10'
            }`}
          >
            <span>Best parts only:</span>
            <span className="font-extrabold">{syncState.bestPartsMode ? 'ON' : 'OFF'}</span>
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

      {/* Live Rhythm Enhancer */}
      <RhythmPanel compact rhythm={syncState.rhythm} onCommand={(cmd) => onSendAction({ type: 'CMD_RHYTHM', cmd })} />

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
            placeholder="Song name or YouTube link"
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
              className="absolute left-0 right-0 top-full mt-2 bg-[#0e1322]/98 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-[380px] overflow-y-auto ring-1 ring-black/80"
            >
              <div id="remote-search-dropdown-header" className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-slate-400 border-b border-white/10 mb-1">
                <span className="font-bold text-cyan-300 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  MATCHING SONGS ({searchResults.length})
                </span>
                <span className="text-[9px]">Tap to play, or + Queue</span>
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
                    onClick={() => handleSelectSong(song, true)}
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
            <span>PLAY</span>
          </button>

          <button
            onClick={() => handleAcquire(false)}
            disabled={!query.trim()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>QUEUE</span>
          </button>
        </div>

        {/* Load my_songs.txt Playlist One-Tap Button */}
        <button id="remote-load-my-songs-button"
          onClick={() => onSendAction({ type: 'CMD_LOAD_MY_SONGS' })}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-bold text-[11px] bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-500/30 transition-all shadow-sm active:scale-98"
        >
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>LOAD MY_SONGS</span>
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
        onMix={mixPreviouslyPlayed}
      />

      {/* Most Played */}
      {syncState.mostPlayedSongs && syncState.mostPlayedSongs.length > 0 && (
        <div id="remote-most-played" className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5 bg-gradient-to-b from-[#141824] to-[#0a0d16]">
          <div id="remote-most-played-header" className="flex items-center justify-between">
            <div id="remote-most-played-title-group" className="flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-400 fill-current" />
              <span className="font-extrabold text-xs text-white uppercase tracking-wider">
                MOST PLAYED
              </span>
            </div>
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
                  PLAY
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Autonomous 50-Song Upcoming Queue */}
      {(() => {
        const totalQueueSec = syncState.queue.reduce((acc, q) => acc + (q.duration || 210), 0);
        const totalQueueH = Math.floor(totalQueueSec / 3600);
        const totalQueueM = Math.round((totalQueueSec % 3600) / 60);
        const queueDurationStr = totalQueueH > 0 ? `${totalQueueH}h ${totalQueueM}m` : `${totalQueueM}m`;

        return (
          <div id="remote-queue" className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl">
            <div id="remote-queue-header" className="flex items-center justify-between pb-2 border-b border-white/10">
              <div id="remote-queue-title-group" className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/25 to-purple-500/25 border border-cyan-500/30 flex items-center justify-center">
                  <ListMusic className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-xs text-white uppercase tracking-wider">
                      UP NEXT QUEUE
                    </span>
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {syncState.queue.length}
                    </span>
                  </div>
                  <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1 pt-0.5">
                    <span className="text-emerald-400 font-bold">{readyCount} ready</span>
                    <span>•</span>
                    <span className="text-amber-300 font-medium">~{queueDurationStr}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {syncState.queue.length > 1 && (
                  <button
                    id="remote-sort-harmonic-btn"
                    onClick={() => onSendAction({ type: 'CMD_SORT_QUEUE_HARMONICALLY' })}
                    className="flex items-center gap-1 whitespace-nowrap text-[10px] font-mono font-bold text-purple-200 bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/40 px-2 py-1 rounded-lg active:scale-95 transition-all shadow-sm"
                    title="Sort by key: reorder Up Next so each song's key fits the next (no clashes)"
                  >
                    <Sparkles className="w-2.5 h-2.5 text-purple-300 animate-pulse" />
                    <span>Sort</span>
                  </button>
                )}
                <button
                  id="remote-refresh-queue-btn"
                  onClick={() => onSendAction({ type: 'CMD_REFRESH_QUEUE' })}
                  className="flex items-center gap-1 text-[10px] font-mono font-bold text-cyan-200 bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/40 px-2 py-1 rounded-lg active:scale-95 transition-all"
                  title="Refresh Up Next: keeps songs you added and the next 3"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {queueList}

            {syncState.queue.length > 0 && (
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 pt-1.5 border-t border-white/10 px-1">
                <span className="text-slate-300 font-bold">{syncState.queue.length} songs (~{queueDurationStr})</span>
                <span className="text-cyan-400">AI auto-curating</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Mobile AI DJ Bottom Chat Bar & Live Telemetry Panel */}
      <div id="remote-ai-command-bar" className="dj-panel rounded-2xl p-3.5 border border-purple-500/30 bg-purple-950/15 flex flex-col gap-2.5 mt-2">
        {/* Header / Model Indicator */}
        <div id="remote-ai-header" className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
            <Sparkles className={`w-3.5 h-3.5 ${syncState.isAiThinking ? 'animate-spin text-purple-400' : 'text-purple-400 animate-pulse'}`} />
            <span>AI DJ COMMAND</span>
          </div>

          <span
            className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border ${
              syncState.aiProvider === 'gemini'
                ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
                : syncState.aiStatus === 'online'
                ? 'text-purple-300 bg-purple-500/15 border-purple-500/30'
                : 'text-slate-400 bg-white/5 border-white/10'
            }`}
          >
            {syncState.aiProvider === 'gemini'
              ? `⚡ Gemini ${formatAiModelDisplay(syncState.aiModelName)}`
              : syncState.aiStatus === 'online'
              ? `🦙 ${formatAiModelDisplay(syncState.aiModelName)}`
              : 'AI DJ (Rules)'}
          </span>
        </div>

        {/* Quick Prompts scrollable horizontal row */}
        <div id="remote-ai-quick-prompts" className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {samplePrompts.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSendAction({ type: 'CMD_AI_INSTRUCT', command: p })}
              disabled={syncState.isAiThinking}
              className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2.5 py-1 rounded-xl border border-white/10 whitespace-nowrap shrink-0 active:scale-95 transition-all disabled:opacity-40"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input Form */}
        <form onSubmit={handleAiSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            disabled={syncState.isAiThinking}
            placeholder={syncState.isAiThinking ? 'AI DJ is thinking...' : "Ask AI (e.g. 'Mix with Dhol')..."}
            className="flex-1 bg-black/60 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={syncState.isAiThinking || !aiPrompt.trim()}
            className="flex items-center justify-center p-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 active:scale-95 disabled:opacity-40 transition-all shrink-0"
            title="Send Instruction to AI DJ"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Live Reasoning / Telemetry Pill */}
        <div id="remote-ai-telemetry" className="flex items-center justify-between gap-2 bg-black/50 px-2.5 py-1.5 rounded-xl border border-white/5 font-mono text-[10px]">
          <div className="flex items-center gap-1.5 text-slate-300 truncate flex-1 min-w-0">
            {syncState.isAiThinking ? (
              <span className="text-purple-400 flex items-center gap-1 animate-pulse">
                <Cpu className="w-3 h-3 animate-spin shrink-0" />
                Interpreting instruction...
              </span>
            ) : syncState.aiResult ? (
              <div className="flex items-center gap-1.5 truncate">
                <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-white font-semibold truncate">{syncState.aiResult.explanation}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-400 truncate">
                <Terminal className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">
                  {syncState.acquisitionStatus || 'AI DJ standing by'}
                </span>
              </div>
            )}
          </div>

          {syncState.aiResult && !syncState.isAiThinking && (
            <span
              className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 font-bold ${
                syncState.aiResult.source === 'gemini_flash'
                  ? 'text-cyan-300 bg-cyan-500/20 border border-cyan-500/30'
                  : syncState.aiResult.source === 'ollama_qwen'
                  ? 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
                  : 'text-amber-300 bg-amber-500/20 border border-amber-500/30'
              }`}
            >
              {syncState.aiResult.latencyMs}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
