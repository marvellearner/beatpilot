import React from 'react';
import { PercussionDeck, PERCUSSION_PATTERNS } from '../../audio/PercussionDeck';
import { Flame, Play, Pause, Volume2, VolumeX, Radio, Sparkles, Bot } from 'lucide-react';

interface PercussionBarProps {
  percussionDeck: PercussionDeck;
  decisionReason?: string;
  autoPilotActive?: boolean;
  onToggleAutoPilot?: () => void;
  onTogglePlay: () => void;
  onResync?: () => void;
}

export const PercussionBar: React.FC<PercussionBarProps> = ({
  percussionDeck,
  decisionReason,
  autoPilotActive = true,
  onToggleAutoPilot,
  onTogglePlay,
  onResync,
}) => {
  const state = percussionDeck.getState();

  return (
    <div id="percussion-bar"
      className={`dj-panel rounded-2xl p-5 border transition-all ${
        state.isPlaying
          ? 'border-rose-500/50 glow-deck-p bg-gradient-to-r from-[#171226]/90 via-[#1f132b]/90 to-[#171226]/90'
          : 'border-white/10'
      }`}
    >
      {/* Top Banner & Telemetry */}
      <div id="percussion-bar-header" className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl ${
              state.isPlaying ? 'bg-rose-500 text-white pulse-percussion' : 'bg-white/10 text-slate-400'
            }`}
          >
            <Flame className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-base tracking-wide flex items-center gap-1.5">
                DECK P — CONTINUOUS PERCUSSION & LIVE DHOL LAYER
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                TRANSITION-RESISTANT
              </span>
              {autoPilotActive && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold flex items-center gap-1">
                  <Bot className="w-3 h-3 text-cyan-400" />
                  AI AUTO-PILOT
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Plays continuously underneath Song A and Song B. Never restarts or drops during song transitions.
            </p>
          </div>
        </div>

        {/* Master Transport, Auto-Pilot Toggle & Quick Mute */}
        <div id="percussion-bar-transport" className="flex items-center gap-3">
          {onResync && (
            <button
              onClick={onResync}
              className="text-xs font-mono font-bold px-3 py-2 rounded-xl border bg-purple-500/20 border-purple-500/40 text-purple-200 hover:bg-purple-500/30 flex items-center gap-1.5 transition-all shadow-sm"
              title="Snap live rhythm enhancer to song tempo and downbeat phase using AI"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300 animate-pulse" />
              <span>AI SYNC</span>
            </button>
          )}

          {onToggleAutoPilot && (
            <button
              onClick={onToggleAutoPilot}
              className={`text-xs font-mono font-bold px-3 py-2 rounded-xl border transition-all ${
                autoPilotActive
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
              title="Toggle AI Percussion Decision Auto-Pilot"
            >
              Auto-Pilot: {autoPilotActive ? 'ON' : 'MANUAL'}
            </button>
          )}

          <button
            onClick={() => percussionDeck.toggleMute()}
            className={`p-2.5 rounded-xl border transition-all ${
              state.isMuted
                ? 'bg-red-500/30 border-red-500/50 text-red-200'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/15'
            }`}
            title={state.isMuted ? 'Unmute Percussion' : 'Mute Percussion'}
          >
            {state.isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
          </button>

          <button
            onClick={onTogglePlay}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-extrabold text-sm tracking-wider transition-all shadow-lg ${
              state.isPlaying
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/40'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
            }`}
          >
            {state.isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>PAUSE DHOL</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>START CONTINUOUS DHOL</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* AI Drum Advisor Reasoning Banner */}
      {decisionReason && (
        <div id="percussion-bar-advisor-reason" className="bg-black/40 px-3.5 py-1.5 rounded-xl border border-white/5 font-mono text-[11px] text-rose-300 mt-2.5 flex items-center gap-2">
          <Bot className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="font-bold text-white">AI Drum Decision:</span>
          <span className="truncate flex-1">{decisionReason}</span>
          {onResync && (
            <button
              onClick={onResync}
              className="px-2 py-0.5 text-[10px] font-sans font-bold bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30 rounded shrink-0 transition-colors"
              title="Re-run AI rhythmic analysis and snap phase lock"
            >
              Sync Now
            </button>
          )}
        </div>
      )}

      {/* Grid of 4 Rhythm Patterns & Sync Controls */}
      <div id="percussion-bar-body" className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-3 items-center">
        {/* Pattern Selectors */}
        <div id="percussion-bar-patterns" className="lg:col-span-7 flex flex-col gap-2">
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-rose-400" />
            <span>Select Rhythmic Loop Pattern</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PERCUSSION_PATTERNS.map((pattern) => {
              const isActive = state.activePatternId === pattern.id;
              return (
                <button id={`percussion-bar-pattern-${pattern.id}`}
                  key={pattern.id}
                  onClick={() => percussionDeck.switchPattern(pattern.id)}
                  className={`flex flex-col text-left p-2.5 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-rose-500/20 border-rose-500 text-white shadow-lg shadow-rose-500/20'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span className="font-bold text-xs truncate flex items-center justify-between">
                    {pattern.name}
                    {isActive && <Sparkles className="w-3 h-3 text-rose-400 animate-pulse" />}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {pattern.defaultBpm} BPM Loop
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sync Mode & Tempo */}
        <div id="percussion-bar-sync" className="lg:col-span-5 grid grid-cols-3 gap-3 bg-black/40 p-3 rounded-xl border border-white/5 items-center">
          {/* Deck Sync Selector */}
          <div id="percussion-bar-sync-deck" className="flex flex-col gap-1 text-center">
            <span className="text-[10px] font-mono text-slate-400">BEAT SYNC</span>
            <div className="flex justify-center bg-white/5 p-0.5 rounded-lg border border-white/10">
              <button
                onClick={() => percussionDeck.setSyncDeck('A')}
                className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                  state.syncToDeck === 'A' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                DECK A
              </button>
              <button
                onClick={() => percussionDeck.setSyncDeck('B')}
                className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                  state.syncToDeck === 'B' ? 'bg-amber-500 text-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                DECK B
              </button>
            </div>
          </div>

          {/* Dhol Loop BPM Display */}
          <div id="percussion-bar-bpm" className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] font-mono text-slate-400">LOOP BPM</span>
            <span className="text-base font-extrabold text-rose-400 font-mono">
              {Math.round(state.currentBpm)}
            </span>
            <span className="text-[9px] text-slate-500 font-mono">LOCKED</span>
          </div>

          {/* Volume & Intensity */}
          <div id="percussion-bar-volume" className="flex flex-col gap-1 text-center">
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>VOL</span>
              <span className="text-slate-200">{Math.round(state.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={state.volume}
              onChange={(e) => percussionDeck.setVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 fader-p"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
