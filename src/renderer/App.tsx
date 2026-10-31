import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { DeckView } from './components/DeckView';
import { RhythmPanel } from './components/RhythmPanel';
import { MixerSection } from './components/MixerSection';
import { PartyConsoleView } from './components/PartyConsoleView';
import { RamUsageMeter } from './components/RamUsageMeter';
import { MixToast } from './components/MixToast';
import { DJAgent, AIResponseResult } from '../ai/DJAgent';
import { MobileRemoteView } from '../remote/MobileRemoteView';
import { MobileAction } from '../types';
import QRCode from 'qrcode';
import { getCamelotDetails, getHarmonicCompatibility, shiftKey } from '../audio/KeyDetector';
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
  ListMusic,
  Radio,
  Zap,
  Music,
  ArrowUp,
  X,
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
  const agentRef = useRef<DJAgent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isHostRef = useRef(false);
  const [hostRole, setHostRole] = useState<'host' | 'standby' | null>(null);
  const [remoteUrls, setRemoteUrls] = useState<string[]>([]);
  const [remoteQr, setRemoteQr] = useState<string | null>(null);

  const [, setTick] = useState<number>(0);
  const [nlCommand, setNlCommand] = useState<string>('');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIResponseResult | null>(null);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showRemoteModal, setShowRemoteModal] = useState<boolean>(false);

  // 'remote' previews the phone remote on this laptop (the real phone uses RemoteClient)
  const [viewMode, setViewMode] = useState<'console' | 'remote'>('console');
  const [consoleMode, setConsoleMode] = useState<'party' | 'pro'>('party');
  // The top bar's slot for the Party console's my_songs.txt buttons (set once it's on screen)
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // Initialize AudioEngine & DJAgent
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }
  if (!agentRef.current) {
    agentRef.current = engineRef.current.djAgent;
  }

  const engine = engineRef.current;
  const agent = agentRef.current;

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
          engine.cancelPendingMix();
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
    // Engine changes come in bursts (many per frame during a mix): re-render at most once per
    // animation frame, and update the phone at most every SYNC_THROTTLE_MS
    let frame = 0;
    let syncTimer: number | undefined;
    const render = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setTick((t) => t + 1);
        });
      }
    };
    const sync = () => {
      if (syncTimer === undefined) {
        syncTimer = window.setTimeout(() => {
          syncTimer = undefined;
          broadcastSyncState();
        }, SYNC_THROTTLE_MS);
      }
    };
    engine.onEngineUpdate = () => {
      render();
      sync();
    };
    // Keeps the clock, progress bar and phone moving between engine changes
    const interval = setInterval(() => {
      render();
      sync();
    }, 250);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(frame);
      window.clearTimeout(syncTimer);
      engine.onEngineUpdate = undefined;
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
          {engine.hasAiInstructions && (
            <div
              id="app-ai-instructions"
              className="flex items-center gap-2 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl pl-3 pr-1 py-1 text-xs"
            >
              <span className="text-fuchsia-100 truncate max-w-[140px] min-[1800px]:max-w-[220px]" title="Remembered from the AI chat, also after a reload">
                🤖 {engine.describeAiInstructions().join(' · ')}
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
          {consoleMode === 'party' && <div id="app-header-party-slot" ref={setHeaderSlot} className="contents" />}

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
              engine.aiStatus === 'online'
                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                : 'bg-white/5 text-slate-400 border-white/10'
            }`}
            title={
              engine.aiStatus === 'online'
                ? `AI DJ chooses mix points and song order.${engine.lastAiDecision ? ` Last: ${engine.lastAiDecision}` : ''}`
                : 'Ollama is not running: mixing uses the built-in rules. Start Ollama to enable AI DJ decisions.'
            }
          >
            <Cpu className={`w-3.5 h-3.5 ${engine.aiStatus === 'online' ? 'text-purple-400' : 'text-slate-500'}`} />
            <span className="hidden min-[1800px]:inline">
              {engine.aiStatus === 'online'
                ? '🤖 AI DJ online'
                : engine.aiStatus === 'checking'
                  ? 'Checking AI DJ…'
                  : 'AI DJ offline (rule-based)'}
            </span>
          </div>

          {/* One light per AI backend: green = answering, red = not available, grey = not set up */}
          <div id="app-ai-backends" className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-mono text-slate-300">
            {(() => {
              const b = engine.aiBackends;
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
      <MixToast notice={engine.mixNotice} />

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
            1. <strong>Autonomous Drums Decision:</strong> The AI analyzes the active song's rhythm and genre. If it detects a Punjabi banger, it activates the Punjabi Dhol at the exact BPM. If it detects an EDM track, it switches to Club Drums. If sync confidence is low or it's an acoustic track, it <strong>holds/mutes percussion to prevent clashing</strong>.
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
        <>
          {/* Live Rhythm Enhancer (Deck P) */}
          <section id="app-pro-percussion">
            <RhythmPanel rhythm={engine.rhythm.getState()} onCommand={(cmd) => engine.rhythmCommand(cmd)} />
          </section>

          {/* Main Dual-Deck and Center Mixer Grid */}
          <main id="app-pro-decks" className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Deck A (Left) */}
            <div id="app-pro-deck-a-column" className="lg:col-span-4">
              <DeckView deck={engine.deckA} deckId="A" engine={engine} />
            </div>

            {/* Master Center Mixer & AI Transition (Middle) */}
            <div id="app-pro-mixer-column" className="lg:col-span-4">
              <MixerSection engine={engine} />
            </div>

            {/* Deck B (Right) */}
            <div id="app-pro-deck-b-column" className="lg:col-span-4">
              <DeckView deck={engine.deckB} deckId="B" engine={engine} />
            </div>
          </main>
        </>
      )}

      {/* Autonomous 50-Song Upcoming Queue Panel (Desktop Console Pro View) */}
      {consoleMode === 'pro' && (() => {
        const activeDeckInstance = engine.activeDeck === 'A' ? engine.deckA : engine.deckB;
        const proCurTrack = activeDeckInstance.getPlaybackState().track;
        const proCurKey = proCurTrack?.key
          ? (engine.keyLock ? proCurTrack.key : shiftKey(proCurTrack.key, activeDeckInstance.getPlaybackState().playbackRate))
          : undefined;
        const totalQueueDurationSec = engine.queue.reduce((acc, q) => acc + (q.duration || 210), 0);
        const totalQueueHours = Math.floor(totalQueueDurationSec / 3600);
        const totalQueueMins = Math.round((totalQueueDurationSec % 3600) / 60);
        const queueDurationStr = totalQueueHours > 0 ? `${totalQueueHours}h ${totalQueueMins}m` : `${totalQueueMins}m`;

        return (
          <section id="app-pro-queue" className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-3 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/25 to-purple-500/25 border border-cyan-500/30 flex items-center justify-center shadow-sm">
                  <ListMusic className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-sm text-white tracking-wide">
                      AI UPCOMING QUEUE
                    </h3>
                    <span className="font-mono text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {engine.queue.length} TRACKS
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 pt-0.5">
                    <span className="text-emerald-400 font-bold">{engine.queue.filter(q => q.status === 'ready').length} ready</span>
                    <span>•</span>
                    <span className="text-amber-300 font-medium">~{queueDurationStr} continuous party flow</span>
                    {engine.diskCacheCount > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-cyan-400">💾 {engine.diskCacheCount} on disk</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {engine.queue.length > 1 && (
                  <button
                    id="app-pro-sort-harmonic-btn"
                    onClick={() => engine.sortQueueHarmonically()}
                    className="flex items-center gap-1.5 text-xs font-mono font-extrabold text-purple-200 bg-gradient-to-r from-purple-500/25 via-indigo-500/25 to-pink-500/25 hover:from-purple-500/40 hover:to-indigo-500/40 border border-purple-500/40 px-3 py-1 rounded-xl shadow-md active:scale-95 transition-all cursor-pointer"
                    title="Sort queue using Camelot wheel harmonic rules"
                  >
                    <Sparkles className="w-3 h-3 text-purple-300 animate-pulse" />
                    <span>Sort by key</span>
                  </button>
                )}

                <button
                  onClick={() => engine.toggleAutoCuration()}
                  className={`text-[11px] font-mono font-bold px-3 py-1 rounded-xl border transition-colors ${
                    engine.autoCurationEnabled
                      ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                      : 'bg-white/5 border-white/10 text-slate-400'
                  }`}
                >
                  Auto-fill Up Next: {engine.autoCurationEnabled ? 'ON' : 'OFF'}
                </button>

                <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                  <Radio className="w-3 h-3 animate-pulse" />
                  <span className="font-bold">Auto-Mix Active</span>
                </span>
              </div>
            </div>

            {/* Queue Cards Grid */}
            <div id="app-pro-queue-grid" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 pt-1 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
              {engine.queue.map((item, idx) => {
                const keyDetails = item.key ? getCamelotDetails(item.key) : null;
                const compat = proCurKey && item.key ? getHarmonicCompatibility(proCurKey, item.key) : null;
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

                const isHero = idx === 0;

                return (
                  <div
                    id={`app-pro-queue-item-${item.id}`}
                    key={item.id}
                    className={`p-3 rounded-xl flex flex-col justify-between gap-2.5 text-xs transition-all relative group ${
                      isHero
                        ? 'bg-gradient-to-b from-cyan-950/40 via-[#101728]/90 to-[#0c101c]/95 border border-cyan-500/40 shadow-lg shadow-cyan-950/30 ring-1 ring-cyan-500/25'
                        : 'bg-black/40 hover:bg-[#121827]/90 border border-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col gap-1.5">
                      {/* Top Rank + Badges */}
                      <div className="flex justify-between items-center text-[10px] font-mono gap-1.5 flex-wrap">
                        <span className={`font-bold shrink-0 whitespace-nowrap ${isHero ? 'text-cyan-300 flex items-center gap-1 font-black' : 'text-slate-500'}`}>
                          {isHero && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping shrink-0" />}
                          #{idx + 1} {isHero ? 'UP NEXT' : 'UPCOMING'}
                        </span>
                        <div className="flex items-center gap-1">
                          {item.isAiRecommended && (
                            <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 rounded font-bold text-[8px]">
                              AI
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => engine.removeFromQueue(item.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white p-0.5 rounded transition-all"
                            title="Remove from queue"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Thumbnail & Title (Spacious 2-line wrapped title for 50+ chars upfront) */}
                      <div className="flex items-start gap-2">
                        <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-slate-900 mt-0.5">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-slate-800">
                              <Music className="w-3.5 h-3.5 text-slate-400" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="font-bold text-white text-xs group-hover:text-cyan-300 transition-colors line-clamp-2 leading-snug break-words" title={item.title}>
                            {item.title}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate pt-0.5">{item.artist}</div>
                        </div>
                      </div>

                      {/* Camelot Key + BPM badges */}
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        {item.bpm !== undefined && (
                          <span className="font-mono text-[9px] text-slate-300 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                            {Math.round(item.bpm)} BPM
                          </span>
                        )}
                        {item.key && keyDetails && (
                          <span
                            className={`inline-flex items-center gap-0.5 font-mono text-[8px] font-bold px-1.5 py-0.5 rounded border ${colorClass}`}
                            title={compat ? `${item.key} (${keyDetails.musicalKey}) • ${compat.description}` : `Key: ${item.key}`}
                          >
                            <span>{item.key}</span>
                            {compat && compat.relation !== 'usable' && (
                              <span className="font-black ml-0.5">{compat.badgeText}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Status & Action Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <div className="flex items-center gap-1">
                        {item.isDiskCached && (
                          <span className="text-[8px] font-mono text-cyan-300 bg-cyan-500/15 border border-cyan-500/25 px-1 py-0.5 rounded font-bold">
                            DISK
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
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

                      <div className="flex items-center gap-1">
                        {!isHero && (
                          <button
                            type="button"
                            onClick={() => engine.moveQueueItem(item.id, 'top')}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded bg-white/5 hover:bg-white/15 text-slate-400 hover:text-cyan-300 text-[10px] transition-colors"
                            title="Play Next (Move to #1 on deck)"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => engine.mixQueuedTrack(item.id)}
                          disabled={item.status !== 'ready' || engine.isTransitioning}
                          title={item.status === 'ready' ? 'Mix into this song now' : 'Still loading'}
                          className={`flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                            isHero
                              ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-md shadow-cyan-500/20'
                              : 'bg-white/10 hover:bg-white/20 text-cyan-300'
                          }`}
                        >
                          <Zap className="w-3 h-3 fill-current" />
                          <span>Mix</span>
                        </button>
                      </div>
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
