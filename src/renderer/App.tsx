import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { DeckView } from './components/DeckView';
import { EngineRhythmPanel } from './components/RhythmPanel';
import { MixerSection } from './components/MixerSection';
import { PartyConsoleView } from './components/PartyConsoleView';
import { RamUsageMeter } from './components/RamUsageMeter';
import { MixToast } from './components/MixToast';
import { StartPartyModal } from './components/StartPartyModal';
import { DJAgent, AIResponseResult } from '../ai/DJAgent';
import { MobileRemoteView } from '../remote/MobileRemoteView';
import { MobileAction } from '../types';
import QRCode from 'qrcode';
import { getCamelotDetails, getHarmonicCompatibility, shiftKey } from '../audio/KeyDetector';
import { useEngineSystem, useEngineQueue } from './hooks/useEngineStore';
import {
  Disc,
  Send,
  HelpCircle,
  Terminal,
  Sparkles,
  ShieldCheck,
  Cpu,
  CheckCircle,
  Smartphone,
  ExternalLink,
  QrCode,
  Zap,
  Music,
  ArrowUp,
  X,
  PartyPopper,
} from 'lucide-react';

// Phone updates: at most this often (the engine can change many times per frame during a mix)
const SYNC_THROTTLE_MS = 150;
// The full state is resent at least this often, in case a change slipped past the signature
const FULL_SYNC_EVERY_MS = 5000;

const formatAiModelDisplay = (name: string | null | undefined): string => {
  if (!name) return 'Qwen 2.5 1.5B';
  if (/1\.5b/i.test(name)) return 'Qwen 2.5 1.5B';
  if (/3b/i.test(name)) return 'Qwen 2.5 3B';
  if (/0\.5b/i.test(name)) return 'Qwen 2.5 0.5B';
  return name.replace(/^gemini-/, '');
};

export const App: React.FC = () => {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }
  const engine = engineRef.current;

  const agentRef = useRef<DJAgent | null>(null);
  if (!agentRef.current) {
    agentRef.current = engine.djAgent;
  }
  const agent = agentRef.current;

  const system = useEngineSystem(engine);
  const queueState = useEngineQueue(engine);

  const wsRef = useRef<WebSocket | null>(null);
  const isHostRef = useRef(false);
  const [hostRole, setHostRole] = useState<'host' | 'standby' | null>(null);
  const [remoteUrls, setRemoteUrls] = useState<string[]>([]);
  const [remoteQr, setRemoteQr] = useState<string | null>(null);

  const [nlCommand, setNlCommand] = useState<string>('');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIResponseResult | null>(null);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showRemoteModal, setShowRemoteModal] = useState<boolean>(false);
  const [showStartPartyModal, setShowStartPartyModal] = useState<boolean>(false);

  // 'remote' previews the phone remote on this laptop (the real phone uses RemoteClient)
  const [viewMode, setViewMode] = useState<'console' | 'remote'>('console');
  const [consoleMode, setConsoleMode] = useState<'party' | 'pro'>('party');
  // The top bar's slot for the Party console's my_songs.txt buttons (set once it's on screen)
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const onHeaderSlotRef = useCallback((node: HTMLElement | null) => {
    setHeaderSlot((prev) => (prev !== node ? node : prev));
  }, []);

  // Execute Mobile Action on Host
  const handleMobileAction = useCallback(
    (action: MobileAction) => {
      switch (action.type) {
        case 'CMD_PLAY':
          engine.playCurrent();
          break;
        case 'CMD_PAUSE':
          engine.pauseCurrent();
          break;
        case 'CMD_STOP':
          engine.stopAll();
          break;
        case 'CMD_SEEK':
          engine.seekCurrent(action.deltaSeconds);
          break;
        case 'CMD_SEEK_TO':
          engine.seekTo(action.targetSeconds);
          break;
        case 'CMD_PREV':
          engine.prevTrack();
          break;
        case 'CMD_NEXT':
          engine.nextTrack();
          break;
        case 'CMD_RHYTHM':
          engine.rhythmCommand(action.cmd);
          break;
        case 'CMD_ADD_QUEUE':
          engine.acquireTrack(action.query, false);
          break;
        case 'CMD_MIX_NOW':
          engine.acquireTrack(action.query, true);
          break;
        case 'CMD_REFRESH_QUEUE':
          void engine.refreshQueue();
          break;
        case 'CMD_TOGGLE_AUTOCURATION':
          engine.toggleAutoCuration();
          break;
        case 'CMD_JUMP_TO_HOOK':
          engine.jumpToHook(action.deckId);
          break;
        case 'CMD_TOGGLE_BEST_PARTS':
          engine.toggleBestParts();
          break;
        case 'CMD_MIX_QUEUED':
          engine.mixQueuedTrack(action.itemId);
          break;
        case 'CMD_REMOVE_QUEUED':
          engine.removeFromQueue(action.itemId);
          break;
        case 'CMD_CANCEL_PENDING_MIX':
          engine.skipPlannedSong();
          break;
        case 'CMD_SET_MOOD':
          engine.setMood(action.mood);
          break;
        case 'CMD_SET_EQ':
          engine.setEqBand(action.band, action.gainDb);
          break;
        case 'CMD_RESET_EQ':
          engine.resetEq();
          break;
        case 'CMD_SET_TEMPO':
          engine.setTempo(action.ratio);
          break;
        case 'CMD_SET_BPM':
          engine.setBpm(action.bpm);
          break;
        case 'CMD_SET_MASTER_VOLUME':
          engine.setMasterVolume(action.volume);
          break;
        case 'CMD_SET_MUSIC_LEVEL':
          engine.setMusicLevel(action.level);
          break;
        case 'CMD_SET_LAPTOP_VOLUME':
        case 'CMD_TOGGLE_LAPTOP_MUTE':
        case 'CMD_MUTE_LAPTOP':
          // The laptop's Windows volume is set by the server's remote hub (remoteHub.ts), which also
          // tells the phones; doing it here as well would set it twice and send phones a second value
          break;
        case 'CMD_AI_INSTRUCT':
          void executeCommand(action.command);
          break;
        case 'CMD_TOGGLE_KEY_LOCK':
          engine.toggleKeyLock();
          break;
        case 'CMD_TOGGLE_SET_TEMPO_LOCK':
          engine.toggleSetTempoLock();
          break;
        case 'CMD_TOGGLE_PLAY_ORIGINAL':
          engine.togglePlayOriginal();
          break;
        case 'CMD_LOAD_MY_SONGS':
          engine.loadSongsFromTextFile();
          break;
        case 'CMD_PLAY_STARTER_SONG':
          engine.playStarterSong(action.songId);
          break;
        case 'CMD_TOGGLE_FAVORITE': {
          const curTrack = action.song || (engine.activeDeck === 'A' ? engine.deckA : engine.deckB).getPlaybackState().track;
          if (curTrack) engine.toggleFavorite(curTrack);
          break;
        }
        case 'CMD_TOGGLE_DONT_PLAY_AGAIN': {
          const curTrack = action.song || (engine.activeDeck === 'A' ? engine.deckA : engine.deckB).getPlaybackState().track;
          if (curTrack) engine.toggleDontPlayAgain(curTrack);
          break;
        }
        case 'CMD_SORT_QUEUE_HARMONICALLY':
          engine.sortQueueHarmonically();
          break;
        case 'CMD_MOVE_QUEUED':
          engine.moveQueueItem(action.itemId, action.direction);
          break;
        case 'CMD_SET_SONG_FILTER':
          engine.setSongFilter(action.filter);
          break;
        case 'CMD_CLEAR_FOCUS':
          engine.clearArtistFocus();
          break;
        case 'CMD_START_PARTY':
          void engine.startParty({
            clearHistory: action.clearHistory,
            clearQueue: action.clearQueue,
            clearTransitions: action.clearTransitions,
            vibe: action.vibe,
            customQuery: action.customQuery,
          });
          break;
      }
    },
    [engine]
  );

  // What the phone last received in full (see broadcastSyncState)
  const lastSyncSigRef = useRef('');
  const lastFullSyncAtRef = useRef(0);
  const sendFullSync = useCallback(
    (ws: WebSocket) => {
      lastSyncSigRef.current = engine.getSyncSignature();
      lastFullSyncAtRef.current = performance.now();
      ws.send(JSON.stringify(engine.getSyncState()));
    },
    [engine]
  );

  // Setup WebSocket connection to Vite backend hub
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    // Without this flag the cleanup's close() triggers a reconnect, leaving two live sockets
    // (React StrictMode mounts effects twice) and every phone command runs twice.
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connectWs = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // The server makes the first tab the host; any other tab waits as a standby
        ws.send(JSON.stringify({ type: 'HELLO', role: 'host' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ROLE') {
            isHostRef.current = data.role === 'host';
            setHostRole(data.role);
            if (isHostRef.current) sendFullSync(ws);
          } else if (data.type?.startsWith('CMD_')) {
            handleMobileAction(data as MobileAction);
          }
        } catch {
          // Ignore invalid message
        }
      };

      ws.onclose = () => {
        isHostRef.current = false;
        if (!disposed) reconnectTimer = window.setTimeout(connectWs, 2000); // Reconnect loop
      };
    };

    connectWs();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [engine, handleMobileAction, sendFullSync]);

  // Phone pairing: fetch the laptop's Wi-Fi link and draw it as a QR code
  useEffect(() => {
    if (!showRemoteModal) return;
    let cancelled = false;
    (async () => {
      try {
        const { urls } = (await (await fetch('/api/remote-info')).json()) as { urls: string[] };
        if (cancelled || !urls.length) return;
        setRemoteUrls(urls);
        const qr = await QRCode.toDataURL(urls[0], { margin: 1, width: 220 });
        if (!cancelled) setRemoteQr(qr);
      } catch (err) {
        console.error('Failed to get the remote link:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showRemoteModal]);

  // Phone sync: the full state (~50 KB) only when its big parts change, otherwise the small live part
  const broadcastSyncState = useCallback(() => {
    const ws = wsRef.current;
    if (!isHostRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    const stale = performance.now() - lastFullSyncAtRef.current > FULL_SYNC_EVERY_MS;
    if (stale || engine.getSyncSignature() !== lastSyncSigRef.current) sendFullSync(ws);
    else ws.send(JSON.stringify(engine.getLiveSyncState()));
  }, [engine, sendFullSync]);

  useEffect(() => {
    // Phone sync: throttled broadcast without forcing React root re-renders.
    // UI components subscribe independently to store slices via useSyncExternalStore.
    let syncTimer: number | undefined;
    const sync = () => {
      if (syncTimer === undefined) {
        syncTimer = window.setTimeout(() => {
          syncTimer = undefined;
          broadcastSyncState();
        }, SYNC_THROTTLE_MS);
      }
    };

    const unsubscribe = engine.subscribe(sync);

    // Keep phone state synchronized during active playback
    const interval = setInterval(() => {
      if (engine.isAnyDeckPlaying()) {
        sync();
      }
    }, 250);

    return () => {
      unsubscribe();
      clearInterval(interval);
      if (syncTimer !== undefined) {
        window.clearTimeout(syncTimer);
      }
    };
  }, [engine, broadcastSyncState]);

  // Natural Language DJ Command execution
  const executeCommand = async (commandText: string) => {
    if (!commandText.trim() || isAiThinking) return;

    setIsAiThinking(true);
    engine.isAiThinking = true;
    engine.notify();
    try {
      const result = await agent.interpretCommand(commandText, engine);
      setAiResult(result);
      engine.lastAiResult = {
        explanation: result.plan.explanation,
        source: result.source,
        latencyMs: result.latencyMs,
      };
      agent.executePlanOnEngine(result.plan, engine);
    } catch (err) {
      console.error('Failed to execute AI command:', err);
    } finally {
      setIsAiThinking(false);
      engine.isAiThinking = false;
      engine.notify();
      setNlCommand('');
    }
  };

  const handleAiCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(nlCommand);
  };

  // If in pure mobile view, render touch-first controller
  if (viewMode === 'remote') {
    return (
      <div id="app-remote-preview" className="relative">
        <div className="fixed top-2 right-2 z-50">
          <button
            onClick={() => setViewMode('console')}
            className="text-[10px] font-mono bg-black/80 hover:bg-black text-slate-300 px-2.5 py-1 rounded-md border border-white/20 shadow-lg"
          >
            Switch to Laptop Console
          </button>
        </div>
        {/* Preview runs on the host itself, so actions go straight to the local engine */}
        <MobileRemoteView
          syncState={engine.getSyncState()}
          connected
          onSendAction={handleMobileAction}
        />
      </div>
    );
  }

  // Examples under the AI chat box: things a party host actually asks for
  const samplePrompts = ['Play only Diljit Dosanjh', 'Play more AP Dhillon', 'Start the dhol', 'Play anything'];

  // The server's Wi-Fi address; this window's own origin is only a fallback (it may be "localhost")
  const remoteUrl = remoteUrls[0] ?? `${window.location.origin}/?remote=true`;

  return (
    <div id="app-root" className="min-h-screen bg-[#07090e] text-slate-100 p-3 lg:p-4 flex flex-col gap-3">
      {/* Top Navbar */}
      <header id="app-top-navbar" className="flex flex-wrap items-center justify-between gap-2 min-[1800px]:gap-3 dj-panel rounded-2xl px-3 min-[1800px]:px-4 py-2 min-[1800px]:py-2.5 border border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 via-rose-500 to-amber-500 text-black shadow-md shadow-rose-500/20">
            <Disc className="w-5 h-5 animate-spin text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">AI DJ</h1>
              <span className="hidden min-[1800px]:inline text-[9px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded">
                AUTONOMOUS QUEUE ACTIVE
              </span>
            </div>
            <p className="hidden min-[1800px]:block text-[11px] text-slate-400">
              Zero Clashing • Internet Auto-Queue • iPhone Wi-Fi Remote
            </p>
          </div>
        </div>

        {/* Telemetry and Controls */}
        <div id="app-header-controls" className="flex flex-wrap items-center gap-2 min-[1800px]:gap-3">
          {/* What the AI chat was told to keep doing (remembered across reloads), and a way to drop it */}
          {system.hasAiInstructions && (
            <div
              id="app-ai-instructions"
              className="flex items-center gap-2 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl pl-3 pr-1 py-1 text-xs"
            >
              <span className="text-fuchsia-100 truncate max-w-[140px] min-[1800px]:max-w-[220px]" title="Remembered from the AI chat, also after a reload">
                🤖 {system.aiInstructionsText}
              </span>
              <button
                id="app-clear-ai-instructions"
                type="button"
                onClick={() => engine.clearAiInstructions()}
                className="px-2 py-0.5 rounded-lg font-bold text-fuchsia-100 bg-fuchsia-500/20 hover:bg-fuchsia-500/40 border border-fuchsia-400/40 transition-colors"
                title="Forget what you told the AI chat and play all your music again"
              >
                Clear<span className="hidden min-[1800px]:inline"> AI instructions</span>
              </button>
            </div>
          )}
          {/* The Party console's my_songs.txt buttons are drawn here (see PartyConsoleView) */}
          {consoleMode === 'party' && <div id="app-header-party-slot" ref={onHeaderSlotRef} className="contents" />}

          {/* Start Party Mode Button */}
          <button
            id="app-start-party-btn"
            onClick={() => setShowStartPartyModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-amber-400 via-rose-500 to-pink-500 hover:from-amber-300 hover:via-rose-400 hover:to-pink-400 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs shadow-lg shadow-rose-500/25 transition-all hover:scale-[1.03] active:scale-95 cursor-pointer border border-amber-300/40"
            title="Done testing? Wipe test plays and let AI kick off the real party!"
          >
            <PartyPopper className="w-3.5 h-3.5 text-slate-950 fill-current" />
            <span>🎉 Start Party</span>
          </button>

          {/* View Switcher: Party Console vs Pro DJ Decks */}
          <div id="app-view-switcher" className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setConsoleMode('party')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                consoleMode === 'party'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ✨ Party<span className="hidden min-[1800px]:inline"> Console</span>
            </button>
            <button
              onClick={() => setConsoleMode('pro')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                consoleMode === 'pro'
                  ? 'bg-cyan-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🎛️ Pro<span className="hidden min-[1800px]:inline"> Decks</span>
            </button>
          </div>

          {/* Mobile Remote Pairing Button */}
          <button id="app-connect-remote-button"
            onClick={() => setShowRemoteModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-rose-600 to-purple-600 hover:from-rose-500 hover:to-purple-500 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs shadow-lg shadow-rose-600/30 transition-all"
          >
            <Smartphone className="w-4 h-4" />
            <span><span className="hidden min-[1800px]:inline">Connect </span>iPhone Remote</span>
          </button>

          {/* Test Remote Simulator in Browser */}
          <button id="app-simulate-remote-button"
            onClick={() => setViewMode('remote')}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-slate-200 font-semibold px-3 py-1.5 rounded-xl text-xs border border-white/10 transition-colors"
            title="Preview iPhone Remote View"
          >
            <span>Phone preview</span>
          </button>

          {/* AI DJ (Ollama) status: real health check, refreshed every minute */}
          <div id="app-ai-status"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border ${
              system.aiStatus === 'online'
                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                : 'bg-white/5 text-slate-400 border-white/10'
            }`}
            title={
              system.aiStatus === 'online'
                ? `AI DJ chooses mix points and song order.${system.lastAiDecision ? ` Last: ${system.lastAiDecision}` : ''}`
                : 'Ollama is not running: mixing uses the built-in rules. Start Ollama to enable AI DJ decisions.'
            }
          >
            <Cpu className={`w-3.5 h-3.5 ${system.aiStatus === 'online' ? 'text-purple-400' : 'text-slate-500'}`} />
            <span className="hidden min-[1800px]:inline">
              {system.aiStatus === 'online'
                ? '🤖 AI DJ online'
                : system.aiStatus === 'checking'
                  ? 'Checking AI DJ…'
                  : 'AI DJ offline (rule-based)'}
            </span>
          </div>

          {/* One light per AI backend: green = answering, red = not available, grey = not set up */}
          <div id="app-ai-backends" className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-mono text-slate-300">
            {(() => {
              const b = system.aiBackends;
              const lights = [
                {
                  id: 'ollama',
                  label: 'Ollama',
                  state: !b ? 'checking' : b.ollama.online ? 'on' : 'off',
                  title: !b
                    ? 'Checking Ollama…'
                    : b.ollama.online
                      ? `Ollama is running with ${b.ollama.model} (used first)`
                      : 'Ollama is not running, or the qwen2.5:1.5b model is missing. Start Ollama to use the local AI.',
                },
                {
                  id: 'gemini',
                  label: 'Gemini',
                  state: !b ? 'checking' : !b.gemini.configured ? 'unset' : b.gemini.online ? 'on' : 'off',
                  title: !b
                    ? 'Checking Gemini…'
                    : !b.gemini.configured
                      ? 'Gemini is not set up: add GEMINI_API_KEY to .env to use it as the cloud backup'
                      : b.gemini.online
                        ? `Gemini (${b.gemini.model}) is reachable (backup when Ollama is unavailable)`
                        : `Gemini is not available: ${b.gemini.error ?? 'no answer'}`,
                },
              ];
              const color: Record<string, string> = {
                on: 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/80',
                off: 'bg-red-500 shadow-[0_0_6px] shadow-red-500/70',
                unset: 'bg-slate-500',
                checking: 'bg-slate-500 animate-pulse',
              };
              return lights.map((l) => (
                <span key={l.id} id={`app-ai-backend-${l.id}`} className="flex items-center gap-1.5" title={l.title}>
                  <span className={`w-2.5 h-2.5 rounded-full ${color[l.state]}`} aria-hidden="true" />
                  <span>{l.label}</span>
                  <span className="sr-only">{l.state === 'on' ? 'available' : l.state === 'off' ? 'not available' : l.state === 'unset' ? 'not set up' : 'checking'}</span>
                </span>
              ));
            })()}
          </div>

          <RamUsageMeter />

          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Help & Instructions"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </header>

      {hostRole === 'standby' && (
        <div id="app-standby-banner" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          AI DJ is already open in another tab, which the phone remote controls. Close this tab, or close the
          other one and this tab takes over.
        </div>
      )}

      {/* iPhone Remote Modal */}
      <MixToast notice={system.mixNotice} />

      {/* Start Party Mode Modal */}
      <StartPartyModal
        isOpen={showStartPartyModal}
        onClose={() => setShowStartPartyModal(false)}
        engine={engine}
      />

      {showRemoteModal && (
        <div id="app-remote-modal" className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="dj-panel rounded-3xl p-6 border border-white/20 max-w-md w-full flex flex-col gap-4 text-center shadow-2xl relative">
            <button
              onClick={() => setShowRemoteModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>

            {remoteQr ? (
              <img
                src={remoteQr}
                alt={`QR code for ${remoteUrl}`}
                className="w-44 h-44 mx-auto rounded-xl bg-white p-1"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500 to-purple-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-500/30">
                <QrCode className="w-6 h-6" />
              </div>
            )}

            <div>
              <h2 className="text-lg font-extrabold text-white">Connect Your iPhone</h2>
              <p className="text-xs text-slate-400 mt-1">
                On the same Wi-Fi, scan the code with the iPhone camera or open this link in Safari:
              </p>
            </div>

            <div className="bg-black/60 p-3 rounded-xl border border-white/10 font-mono text-sm text-cyan-400 break-all select-all flex items-center justify-center gap-2">
              <span>{remoteUrl}</span>
            </div>
            {remoteUrls.length > 1 && (
              <p className="text-[11px] text-slate-500 -mt-2 break-all">
                Not working? Try: {remoteUrls.slice(1).join(' or ')}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <a
                href={remoteUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl font-bold text-xs transition-colors shadow-lg shadow-rose-600/30"
              >
                <span>Open in New Browser Tab</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <button
                onClick={() => {
                  setShowRemoteModal(false);
                  setViewMode('remote');
                }}
                className="bg-white/10 hover:bg-white/20 text-slate-200 py-2.5 rounded-xl font-semibold text-xs border border-white/10 transition-colors"
              >
                Switch to Simulator in This Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instructions / Help Banner */}
      {showHelp && (
        <div id="app-help-banner" className="dj-panel rounded-2xl p-5 border border-cyan-500/30 bg-cyan-950/20 text-xs text-slate-300 flex flex-col gap-2">
          <div className="flex items-center justify-between text-cyan-300 font-bold">
            <span className="flex items-center gap-1.5 text-sm">
              <ShieldCheck className="w-4 h-4" />
              Autonomous Drums & 5-Song Auto-Queue Guide
            </span>
            <button onClick={() => setShowHelp(false)} className="hover:text-white">✕</button>
          </div>
          <p>
            1. <strong>Autonomous Drums Decision:</strong> The AI analyzes the active song's rhythm and genre. If it detects a Punjabi banger, it activates the Punjabi Dhol at the exact BPM. Like a wedding dhol wala, it plays soft under the singing, answers between lines, rolls into choruses and carries the crowd through mixes; English pop and unclear beats get no dhol.
          </p>
          <p>
            2. <strong>Autonomous 5-Song Queue:</strong> If you haven't given the next track, the AI automatically searches the internet for 5 culturally and energetically compatible tracks and keeps them ready in the queue.
          </p>
          <p>
            3. <strong>Automatic Outro Mixing:</strong> About 22 seconds before the song ends, it mixes into the next ready track. It ramps the tempo to match, starts the new song on the beat, and does a bass swap. Tempos too far apart get a clean cut on the beat.
          </p>
        </div>
      )}

      {/* Main Content Area: Party Console View (User-Friendly Default) OR Pro Dual Decks */}
      {consoleMode === 'party' ? (
        <PartyConsoleView
          engine={engine}
          headerSlot={headerSlot}
        />
      ) : (
        <div className="pro-view flex flex-col gap-4">
          {/* Decks either side of the mixer, like a DJ controller */}
          <main id="app-pro-decks" className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px_minmax(0,1fr)] gap-4 items-start">
            <div id="app-pro-deck-a-column" className="min-w-0">
              <DeckView deck={engine.deckA} deckId="A" engine={engine} />
            </div>
            <div id="app-pro-mixer-column" className="min-w-0">
              <MixerSection engine={engine} />
            </div>
            <div id="app-pro-deck-b-column" className="min-w-0">
              <DeckView deck={engine.deckB} deckId="B" engine={engine} />
            </div>
          </main>

          {/* Live Rhythm Enhancer (Deck P) */}
          <section id="app-pro-percussion">
            <EngineRhythmPanel variant="pro" engine={engine} />
          </section>
        </div>
      )}

      {/* Autonomous 50-Song Upcoming Queue Panel (Desktop Console Pro View) */}
      {consoleMode === 'pro' && (() => {
        const activeDeckInstance = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
        const proCurTrack = activeDeckInstance.getPlaybackState().track;
        const proCurKey = proCurTrack?.key
          ? (engine.keyLock ? proCurTrack.key : shiftKey(proCurTrack.key, activeDeckInstance.getPlaybackState().playbackRate))
          : undefined;

        return (
          <section id="app-pro-queue" className="pro-view pro-panel p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h3 className="text-[13px] font-bold text-white tracking-wide">Up Next</h3>
                <span className="text-[11px] text-slate-400 pro-num">
                  {queueState.queueLength} songs · <span className="text-emerald-400">{queueState.readyCount} ready</span> · ~{queueState.queueDurationStr}
                  {queueState.diskCacheCount > 0 && <> · {queueState.diskCacheCount} on disk</>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {queueState.queueLength > 1 && (
                  <button
                    id="app-pro-sort-harmonic-btn"
                    type="button"
                    onClick={() => engine.sortQueueHarmonically()}
                    className="pro-btn !h-7"
                    title="Reorder Up Next with the Camelot wheel so each song's key fits the next"
                  >
                    <Sparkles className="w-3 h-3" />
                    Sort by key
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => engine.toggleAutoCuration()}
                  aria-pressed={engine.autoCurationEnabled}
                  className="pro-btn !h-7"
                  title="Keep Up Next filled with picks automatically"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${engine.autoCurationEnabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  Auto-fill {engine.autoCurationEnabled ? 'on' : 'off'}
                </button>
              </div>
            </div>

            {/* Column headings */}
            <div className="grid grid-cols-[28px_minmax(0,1fr)_56px_112px_84px_112px] gap-3 px-2 pro-label">
              <span className="text-right">#</span>
              <span>Title</span>
              <span className="text-right">BPM</span>
              <span>Key</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>

            <div id="app-pro-queue-grid" className="flex flex-col max-h-[520px] overflow-y-auto pr-1 -mt-1">
              {queueState.queue.map((item, idx) => {
                const compat = proCurKey && item.key ? getHarmonicCompatibility(proCurKey, item.key) : null;
                const keyDetails = item.key ? getCamelotDetails(item.key) : null;
                const keyColors: Record<string, string> = {
                  emerald: 'text-emerald-400',
                  amber: 'text-amber-400',
                  cyan: 'text-cyan-400',
                  teal: 'text-teal-400',
                  purple: 'text-purple-400',
                  rose: 'text-rose-400',
                };
                const keyColor = compat ? keyColors[compat.color] ?? 'text-slate-300' : 'text-slate-300';
                const isNext = idx === 0;
                // Still being looked up: the title is the link the listener pasted or picked
                const resolving = /^(https?:\/\/|local:)/i.test(item.title);
                const statusStyle = item.status === 'ready' ? 'text-emerald-400' : item.status === 'failed' ? 'text-rose-400' : 'text-amber-300';

                return (
                  <div
                    id={`app-pro-queue-item-${item.id}`}
                    key={item.id}
                    className={`group grid grid-cols-[28px_minmax(0,1fr)_56px_112px_84px_112px] gap-3 items-center px-2 py-2 rounded-lg border-b border-white/[0.04] ${
                      isNext ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className={`text-right text-[11px] pro-num ${isNext ? 'text-white font-bold' : 'text-slate-600'}`}>{idx + 1}</span>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-md overflow-hidden shrink-0 bg-white/5">
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-3.5 h-3.5 text-slate-600" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate" title={item.title}>
                          {resolving ? <span className="text-slate-400 font-normal">Resolving link…</span> : item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                          {isNext && <span className="text-[9px] font-bold tracking-wider text-white bg-white/10 px-1 rounded">NEXT</span>}
                          {item.isAiRecommended && <span className="text-[9px] font-bold tracking-wider text-purple-300">AI</span>}
                          <span className="truncate">{resolving ? item.title : item.artist}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-right text-xs pro-num text-slate-300">{item.bpm !== undefined ? Math.round(item.bpm) : '—'}</span>
                    <span
                      className={`text-xs pro-num font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${keyColor}`}
                      title={item.key ? (compat ? `${item.key} (${keyDetails?.musicalKey}) • ${compat.description}` : `Key: ${item.key}`) : 'Key not known yet'}
                    >
                      {item.key ?? '—'}
                      {compat && compat.relation !== 'usable' && <span className="ml-1 text-[9px] opacity-80">{compat.badgeText}</span>}
                    </span>
                    <span className={`text-[10px] font-semibold tracking-wider uppercase ${statusStyle}`}>
                      {item.status}
                      {item.isDiskCached && <span className="ml-1 text-slate-600 normal-case tracking-normal">disk</span>}
                    </span>
                    <div className="flex items-center justify-end gap-1">
                      {!isNext && (
                        <button
                          type="button"
                          onClick={() => engine.moveQueueItem(item.id, 'top')}
                          className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-opacity"
                          title="Play next (move to #1)"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => engine.mixQueuedTrack(item.id)}
                        disabled={item.status !== 'ready' || engine.isTransitioning}
                        title={item.status === 'ready' ? 'Mix into this song now' : 'Still loading'}
                        className="pro-btn !h-7 !px-2.5"
                      >
                        <Zap className="w-3 h-3" />
                        Mix
                      </button>
                      <button
                        type="button"
                        onClick={() => engine.removeFromQueue(item.id)}
                        className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-white/10 transition-opacity"
                        title="Remove from Up Next"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Natural Language AI DJ Command Bar & Response Panel */}
      <footer id="app-ai-command-bar" className="dj-panel rounded-xl p-2.5 border border-white/10 flex flex-col gap-2">
        {/* Quick Sample Prompts & Model Indicator */}
        <div id="app-quick-prompts" className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-slate-400 font-semibold uppercase">
              Quick Prompts:
            </span>
            {samplePrompts.map((prompt, idx) => (
              <button id={`app-quick-prompt-${idx}`}
                key={idx}
                onClick={() => executeCommand(prompt)}
                disabled={isAiThinking}
                className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-0.5 rounded-lg border border-white/10 transition-colors disabled:opacity-50 truncate max-w-[220px]"
              >
                {prompt}
              </button>
            ))}
          </div>

          <div
            className={`hidden sm:flex items-center gap-1.5 font-bold text-[11px] ${
              engine.aiProvider === 'gemini'
                ? 'text-cyan-400'
                : engine.aiStatus === 'online'
                ? 'text-purple-400'
                : 'text-slate-500'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAiThinking ? 'animate-spin' : 'animate-pulse'}`} />
            <span>
              {engine.aiProvider === 'ollama'
                ? `${formatAiModelDisplay(engine.aiModelName)} (Local Primary)`
                : engine.aiProvider === 'gemini'
                ? `Gemini ${formatAiModelDisplay(engine.aiModelName)} (Cloud Backup)`
                : engine.aiStatus === 'online'
                ? `${formatAiModelDisplay(engine.aiModelName)} (Local)`
                : 'AI DJ (Offline Heuristics)'}
            </span>
          </div>
        </div>

        {/* Input Form & Telemetry in a single row for maximum desktop compactness */}
        <div id="app-ai-command-row" className="flex flex-col sm:flex-row items-center gap-2">
          <form onSubmit={handleAiCommandSubmit} className="flex-1 w-full flex items-center gap-2">
            <input
              type="text"
              value={nlCommand}
              onChange={(e) => setNlCommand(e.target.value)}
              disabled={isAiThinking}
              placeholder={
                isAiThinking
                  ? 'AI DJ is generating mixing plan...'
                  : "Ask the AI DJ (e.g. 'play only Diljit Dosanjh', 'start the dhol', 'mix now')..."
              }
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={isAiThinking || !nlCommand.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors shadow-md shadow-purple-600/30 disabled:opacity-50 shrink-0"
            >
              <Send className="w-3 h-3" />
              <span>{isAiThinking ? 'Thinking...' : 'Send'}</span>
            </button>
          </form>

          {/* AI Reasoning / Telemetry Pill */}
          <div id="app-ai-response-pill" className="w-full sm:w-auto flex items-center justify-between gap-2 bg-black/60 px-3 py-1 rounded-xl border border-white/5 font-mono text-[11px] shrink-0">
            <div className="flex items-center gap-1.5 text-slate-300 truncate max-w-[340px]">
              {isAiThinking ? (
                <span className="text-purple-400 flex items-center gap-1 animate-pulse">
                  <Cpu className="w-3 h-3 animate-spin" />
                  Interpreting instruction...
                </span>
              ) : aiResult ? (
                <div className="flex items-center gap-1.5 truncate">
                  <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-white font-semibold truncate">{aiResult.plan.explanation}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-slate-400 truncate">
                  <Terminal className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">
                    {engine.acquisitionStatus
                      ? `Status: ${engine.acquisitionStatus}`
                      : 'AI DJ standing by'}
                  </span>
                </div>
              )}
            </div>

            {aiResult && !isAiThinking && (
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 font-semibold ${
                  aiResult.source === 'gemini_flash'
                    ? 'text-cyan-300 bg-cyan-500/20 border border-cyan-500/30'
                    : aiResult.source === 'ollama_qwen'
                    ? 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
                    : 'text-amber-300 bg-amber-500/20 border border-amber-500/30'
                }`}
              >
                {aiResult.source === 'gemini_flash'
                  ? '⚡ Gemini '
                  : aiResult.source === 'ollama_qwen'
                  ? '🦙 Qwen '
                  : '⚙️ Heuristic '}
                {aiResult.latencyMs}ms
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
