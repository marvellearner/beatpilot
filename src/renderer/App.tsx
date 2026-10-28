import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { DeckView } from './components/DeckView';
import { PercussionBar } from './components/PercussionBar';
import { MixerSection } from './components/MixerSection';
import { PartyConsoleView } from './components/PartyConsoleView';
import { OllamaDJAgent, AIResponseResult } from '../ai/OllamaDJAgent';
import { MobileRemoteView } from '../remote/MobileRemoteView';
import { MobileAction } from '../types';
import {
  Disc,
  Send,
  HelpCircle,
  Terminal,
  Sparkles,
  Laptop,
  ShieldCheck,
  Cpu,
  CheckCircle,
  Smartphone,
  ExternalLink,
  QrCode,
  ListMusic,
  Radio,
  Zap,
} from 'lucide-react';

export const App: React.FC = () => {
  const engineRef = useRef<AudioEngine | null>(null);
  const agentRef = useRef<OllamaDJAgent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [, setTick] = useState<number>(0);
  const [nlCommand, setNlCommand] = useState<string>('');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIResponseResult | null>(null);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showRemoteModal, setShowRemoteModal] = useState<boolean>(false);

  // Check if current URL requested dedicated remote view (?remote=true) or toggle in UI
  const isUrlRemote = new URLSearchParams(window.location.search).get('remote') === 'true';
  const [viewMode, setViewMode] = useState<'console' | 'remote'>(isUrlRemote ? 'remote' : 'console');
  const [consoleMode, setConsoleMode] = useState<'party' | 'pro'>('party');

  // Initialize AudioEngine & OllamaDJAgent
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }
  if (!agentRef.current) {
    agentRef.current = new OllamaDJAgent();
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
        case 'CMD_PERCUSSION_TOGGLE':
          engine.percussionDeck.togglePlay();
          break;
        case 'CMD_PERCUSSION_PATTERN':
          engine.percussionDeck.switchPattern(action.patternId);
          break;
        case 'CMD_PERCUSSION_VOLUME':
          engine.percussionDeck.setVolume(action.volume);
          break;
        case 'CMD_PERCUSSION_MUTE':
          engine.percussionDeck.toggleMute();
          break;
        case 'CMD_ADD_QUEUE':
          engine.acquireTrack(action.query, false);
          break;
        case 'CMD_MIX_NOW':
          engine.acquireTrack(action.query, true);
          break;
        case 'CMD_TOGGLE_AUTOCURATION':
          engine.toggleAutoCuration();
          break;
        case 'CMD_AUTO_PERCUSSION':
          engine.toggleAutoPercussion();
          break;
        case 'CMD_JUMP_TO_HOOK':
          engine.jumpToHook(action.deckId);
          break;
        case 'CMD_TOGGLE_AUTO_CUE_HOOK':
          engine.toggleAutoCueHook();
          break;
        case 'CMD_LOAD_MY_SONGS':
          engine.loadSongsFromTextFile();
          break;
        case 'CMD_PLAY_STARTER_SONG':
          engine.playStarterSong(action.songId);
          break;
      }
    },
    [engine]
  );

  // Setup WebSocket connection to Vite backend hub
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connectWs = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify(engine.getSyncState()));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type?.startsWith('CMD_')) {
            handleMobileAction(data as MobileAction);
          }
        } catch {
          // Ignore invalid message
        }
      };

      ws.onclose = () => {
        setTimeout(connectWs, 2000); // Reconnect loop
      };
    };

    connectWs();

    return () => {
      wsRef.current?.close();
    };
  }, [engine, handleMobileAction]);

  // Broadcast sync state to WebSocket on engine updates
  const broadcastSyncState = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(engine.getSyncState()));
    }
  }, [engine]);

  useEffect(() => {
    engine.onEngineUpdate = () => {
      setTick((t) => t + 1);
      broadcastSyncState();
    };

    const interval = setInterval(() => {
      setTick((t) => t + 1);
      broadcastSyncState();
    }, 250);

    return () => clearInterval(interval);
  }, [engine, broadcastSyncState]);

  // Natural Language DJ Command execution
  const executeCommand = async (commandText: string) => {
    if (!commandText.trim() || isAiThinking) return;

    setIsAiThinking(true);
    try {
      const result = await agent.interpretCommand(commandText, engine);
      setAiResult(result);
      agent.executePlanOnEngine(result.plan, engine);
    } catch (err) {
      console.error('Failed to execute AI command:', err);
    } finally {
      setIsAiThinking(false);
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
      <div className="relative">
        <div className="fixed top-2 right-2 z-50">
          <button
            onClick={() => setViewMode('console')}
            className="text-[10px] font-mono bg-black/80 hover:bg-black text-slate-300 px-2.5 py-1 rounded-md border border-white/20 shadow-lg"
          >
            Switch to Laptop Console
          </button>
        </div>
        <MobileRemoteView
          syncState={engine.getSyncState()}
          onSendAction={(action) => {
            handleMobileAction(action);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(action));
            }
          }}
          onAcquireTrack={(q, autoMix) => engine.acquireTrack(q, autoMix).then(() => {})}
          acquisitionStatus={engine.acquisitionStatus}
        />
      </div>
    );
  }

  const samplePrompts = [
    'Mix into Deck B with energetic Punjabi Dhol',
    'Switch to Bhangra Dholak & Chimta beat',
    'Kill low bass on Deck A to clean up the mix',
    'Start smooth 16-second crossfade into Deck A',
  ];

  const remoteUrl = `http://${window.location.hostname}:5173/?remote=true`;

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 p-3 lg:p-4 flex flex-col gap-3">
      {/* Top Navbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 dj-panel rounded-2xl px-4 py-2.5 border border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 via-rose-500 to-amber-500 text-black shadow-md shadow-rose-500/20">
            <Disc className="w-5 h-5 animate-spin text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">AI DJ</h1>
              <span className="text-[9px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded">
                AUTONOMOUS QUEUE ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Zero Clashing • Internet Auto-Queue • iPhone Wi-Fi Remote
            </p>
          </div>
        </div>

        {/* Telemetry and Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* View Switcher: Party Console vs Pro DJ Decks */}
          <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setConsoleMode('party')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                consoleMode === 'party'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ✨ Party Console
            </button>
            <button
              onClick={() => setConsoleMode('pro')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                consoleMode === 'pro'
                  ? 'bg-cyan-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🎛️ Pro Decks
            </button>
          </div>

          {/* Mobile Remote Pairing Button */}
          <button
            onClick={() => setShowRemoteModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-rose-600 to-purple-600 hover:from-rose-500 hover:to-purple-500 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs shadow-lg shadow-rose-600/30 transition-all"
          >
            <Smartphone className="w-4 h-4" />
            <span>Connect iPhone Remote</span>
          </button>

          {/* Test Remote Simulator in Browser */}
          <button
            onClick={() => setViewMode('remote')}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-slate-200 font-semibold px-3 py-1.5 rounded-xl text-xs border border-white/10 transition-colors"
            title="Preview iPhone Remote View"
          >
            <span>Simulate Mobile View</span>
          </button>

          {/* Ollama Status Pill */}
          <div className="flex items-center gap-1.5 bg-purple-500/10 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-xl text-xs font-mono">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>Qwen 2.5 3B Ready</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-white/5 text-xs font-mono text-slate-400">
            <Laptop className="w-3.5 h-3.5 text-slate-300" />
            <span>i7-9750H • 24 GB RAM</span>
          </div>

          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Help & Instructions"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* iPhone Remote Modal */}
      {showRemoteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="dj-panel rounded-3xl p-6 border border-white/20 max-w-md w-full flex flex-col gap-4 text-center shadow-2xl relative">
            <button
              onClick={() => setShowRemoteModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>

            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500 to-purple-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-500/30">
              <QrCode className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-lg font-extrabold text-white">Connect Your iPhone</h2>
              <p className="text-xs text-slate-400 mt-1">
                Open Safari on your iPhone connected to the same Wi-Fi and navigate to:
              </p>
            </div>

            <div className="bg-black/60 p-3 rounded-xl border border-white/10 font-mono text-sm text-cyan-400 break-all select-all flex items-center justify-center gap-2">
              <span>{remoteUrl}</span>
            </div>

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
        <div className="dj-panel rounded-2xl p-5 border border-cyan-500/30 bg-cyan-950/20 text-xs text-slate-300 flex flex-col gap-2">
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
            3. <strong>Automatic Outro Mixing:</strong> When the song reaches its final 14 seconds, the system automatically triggers a phrase-aligned bass-swap mix into the next track!
          </p>
        </div>
      )}

      {/* Main Content Area: Party Console View (User-Friendly Default) OR Pro Dual Decks */}
      {consoleMode === 'party' ? (
        <PartyConsoleView
          engine={engine}
          onSwitchToProMode={() => setConsoleMode('pro')}
        />
      ) : (
        <>
          {/* Primary Percussion Layer (Deck P) with Autonomous Decision Advisor */}
          <section>
            <PercussionBar
              percussionDeck={engine.percussionDeck}
              decisionReason={engine.percussionDecisionReason}
              autoPilotActive={engine.autoPercussionEnabled}
              onToggleAutoPilot={() => engine.toggleAutoPercussion()}
            />
          </section>

          {/* Main Dual-Deck and Center Mixer Grid */}
          <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Deck A (Left) */}
            <div className="lg:col-span-4">
              <DeckView deck={engine.deckA} deckId="A" />
            </div>

            {/* Master Center Mixer & AI Transition (Middle) */}
            <div className="lg:col-span-4">
              <MixerSection engine={engine} />
            </div>

            {/* Deck B (Right) */}
            <div className="lg:col-span-4">
              <DeckView deck={engine.deckB} deckId="B" />
            </div>
          </main>
        </>
      )}

      {/* Autonomous 5-Song Upcoming Queue Panel (Desktop Console Pro View) */}
      {consoleMode === 'pro' && (
        <section className="dj-panel rounded-2xl p-4 border border-white/10 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-purple-400" />
              <h3 className="font-extrabold text-sm text-white tracking-wide">
                AI AUTONOMOUS UPCOMING QUEUE ({engine.queue.length} TRACKS CURATED)
              </h3>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => engine.toggleAutoCuration()}
                className={`text-[11px] font-mono font-bold px-3 py-1 rounded-xl border transition-colors ${
                  engine.autoCurationEnabled
                    ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                Auto-Curate From Internet: {engine.autoCurationEnabled ? 'ON' : 'OFF'}
              </button>

              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" />
                <span>Auto-Mix At Outro Active</span>
              </span>
            </div>
          </div>

          {/* Queue Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-1">
            {engine.queue.map((item, idx) => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-black/40 border border-white/5 flex flex-col justify-between gap-2 text-xs hover:border-white/20 transition-all relative group"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                    <span>#{idx + 1} UPCOMING</span>
                    {item.isAiRecommended && (
                      <span className="bg-purple-500/20 text-purple-300 px-1 rounded font-bold">
                        AI RECOM
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-white truncate" title={item.title}>
                    {item.title}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{item.artist}</div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      item.status === 'ready'
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                        : item.status === 'failed'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-yellow-500/20 text-yellow-300 animate-pulse'
                    }`}
                  >
                    {item.status.toUpperCase()}
                  </span>

                  <button
                    onClick={() => engine.mixQueuedTrack(item.id)}
                    disabled={!item.audioBuffer || engine.isTransitioning}
                    title={item.audioBuffer ? 'Mix into this song now' : 'Still loading'}
                    className="flex items-center gap-1 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Mix</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Natural Language AI DJ Command Bar & Response Panel */}
      <footer className="dj-panel rounded-xl p-2.5 border border-white/10 flex flex-col gap-2">
        {/* Quick Sample Prompts & Model Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-slate-400 font-semibold uppercase">
              Quick Prompts:
            </span>
            {samplePrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => executeCommand(prompt)}
                disabled={isAiThinking}
                className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-0.5 rounded-lg border border-white/10 transition-colors disabled:opacity-50 truncate max-w-[220px]"
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-purple-400 font-bold text-[11px]">
            <Sparkles className={`w-3.5 h-3.5 ${isAiThinking ? 'animate-spin' : 'animate-pulse'}`} />
            <span>Qwen 2.5 3B Assistant</span>
          </div>
        </div>

        {/* Input Form & Telemetry in a single row for maximum desktop compactness */}
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <form onSubmit={handleAiCommandSubmit} className="flex-1 w-full flex items-center gap-2">
            <input
              type="text"
              value={nlCommand}
              onChange={(e) => setNlCommand(e.target.value)}
              disabled={isAiThinking}
              placeholder={
                isAiThinking
                  ? 'Ollama is generating mixing plan...'
                  : "Ask AI DJ (e.g. 'Mix into Deck B with Punjabi Dhol and kill Deck A bass')..."
              }
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={isAiThinking || !nlCommand.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors shadow-md shadow-purple-600/30 disabled:opacity-50 shrink-0"
            >
              <Send className="w-3 h-3" />
              <span>{isAiThinking ? 'Thinking...' : 'Instruct AI'}</span>
            </button>
          </form>

          {/* AI Reasoning / Telemetry Pill */}
          <div className="w-full sm:w-auto flex items-center justify-between gap-2 bg-black/60 px-3 py-1 rounded-xl border border-white/5 font-mono text-[11px] shrink-0">
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
              <span className="text-[9px] font-mono text-purple-300 bg-purple-500/20 px-1 rounded shrink-0">
                {aiResult.latencyMs}ms
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
