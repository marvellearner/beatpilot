import React, { useState } from 'react';
import { Gauge, Lock, Unlock, Minus, Plus } from 'lucide-react';
import { TempoInfo } from '../../types';

interface TempoControlProps {
  tempo: TempoInfo | null;
  onSetTempo: (ratio: number) => void;
  onSetBpm: (bpm: number) => void;
  onToggleKeyLock: () => void;
  onToggleSetLock: () => void;
  onTogglePlayOriginal: () => void;
  compact?: boolean;
}

const SPEED_PRESETS = [0.95, 0.98, 1, 1.02, 1.05, 1.07, 1.1, 1.12, 1.15, 1.2];

/**
 * Pro-style tempo section for the on-air song: original vs current BPM, an "Original" toggle,
 * speed presets, ±1 BPM nudges, exact BPM entry, Key Lock (pitch stays the same) and
 * "keep the whole set at this BPM".
 */
export const TempoControl: React.FC<TempoControlProps> = ({
  tempo,
  onSetTempo,
  onSetBpm,
  onToggleKeyLock,
  onToggleSetLock,
  onTogglePlayOriginal,
  compact,
}) => {
  const [bpmInput, setBpmInput] = useState('');
  const disabled = !tempo;
  const ratio = tempo?.ratio ?? 1;
  const pct = (ratio - 1) * 100;

  const nudge = (deltaBpm: number) => {
    if (tempo) onSetBpm(tempo.currentBpm + deltaBpm);
  };
  const submitBpm = (e: React.FormEvent) => {
    e.preventDefault();
    const bpm = parseFloat(bpmInput);
    if (bpm > 0) onSetBpm(bpm);
    setBpmInput('');
  };

  return (
    <div id="tempo-control" className="flex flex-col gap-2.5 bg-black/40 border border-white/10 rounded-xl p-2.5 w-full">
      {/* Readout: original and current BPM side by side, plus the Original toggle */}
      <div id="tempo-control-readout" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-extrabold text-white tracking-wide">TEMPO</span>
          </div>

          <div id="tempo-control-original-bpm" className="flex flex-col items-center px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 min-w-[54px] sm:min-w-[64px]">
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Original</span>
            <span className="text-xs font-mono font-bold text-slate-200">{tempo ? tempo.naturalBpm.toFixed(1) : '—'}</span>
          </div>

          <div
            id="tempo-control-current-bpm"
            className={`flex flex-col items-center px-2 py-0.5 rounded-lg border min-w-[54px] sm:min-w-[64px] ${
              Math.abs(pct) > 0.05 ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/10'
            }`}
          >
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Current</span>
            <span className="text-xs font-mono font-bold text-white">{tempo ? tempo.currentBpm.toFixed(1) : '—'}</span>
          </div>

          {tempo && (
            <span className={`text-[10px] font-mono font-bold ${pct > 0.05 ? 'text-emerald-300' : pct < -0.05 ? 'text-rose-300' : 'text-slate-500'}`}>
              {ratio.toFixed(2)}x
              {!compact && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}
            </span>
          )}
          {tempo?.busy && <span className="text-[10px] text-amber-300 animate-pulse font-bold">tuning…</span>}
        </div>

        <button
          id="tempo-control-original-toggle"
          onClick={onTogglePlayOriginal}
          disabled={disabled}
          aria-pressed={tempo?.playOriginal ?? false}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-30 shrink-0 ${
            tempo?.playOriginal
              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
          }`}
          title="ON: songs play at their original BPM, ignoring the party/set tempo and speed changes"
        >
          Original: {tempo?.playOriginal ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Speed presets + nudges */}
      <div id="tempo-control-speed" className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => nudge(-1)}
          disabled={disabled}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 disabled:opacity-30 active:scale-95 transition-all"
          title="Slow down by 1 BPM"
          aria-label="Slow down by 1 BPM"
        >
          <Minus className="w-3 h-3" />
        </button>
        {SPEED_PRESETS.map((preset) => (
          <button id={`tempo-control-preset-${preset}`}
            key={preset}
            onClick={() => onSetTempo(preset)}
            disabled={disabled}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-30 active:scale-95 ${
              Math.abs(ratio - preset) < 0.005
                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-sm'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
            }`}
          >
            {preset}x
          </button>
        ))}
        <button
          onClick={() => nudge(1)}
          disabled={disabled}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 disabled:opacity-30 active:scale-95 transition-all"
          title="Speed up by 1 BPM"
          aria-label="Speed up by 1 BPM"
        >
          <Plus className="w-3 h-3" />
        </button>

        <form onSubmit={submitBpm} className="flex items-center gap-1 ml-auto">
          <input
            type="number"
            inputMode="decimal"
            min={30}
            max={220}
            step={0.1}
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            placeholder="BPM"
            disabled={disabled}
            aria-label="Set exact BPM"
            className="w-16 bg-black/50 border border-white/15 rounded-lg px-2 py-1 text-[11px] text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-400 disabled:opacity-30"
          />
          <button
            type="submit"
            disabled={disabled || !bpmInput}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-30 active:scale-95 transition-all"
          >
            Set
          </button>
        </form>
      </div>

      {/* Key lock + whole-set lock */}
      <div id="tempo-control-locks" className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={onToggleKeyLock}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all active:scale-95 ${
            tempo?.keyLock ?? true
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
          }`}
          title={
            tempo?.keyLock ?? true
              ? 'Key Lock ON: speed changes, pitch stays the same'
              : 'Key Lock OFF (vinyl): pitch rises and falls with speed'
          }
        >
          {tempo?.keyLock ?? true ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          Key Lock: {tempo?.keyLock ?? true ? 'ON' : 'OFF (vinyl)'}
        </button>
        <button
          onClick={onToggleSetLock}
          disabled={disabled}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-30 active:scale-95 ${
            tempo?.setLocked
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
          }`}
          title="Tune every following song to this BPM too (key-locked)"
        >
          Whole set at this BPM: {tempo?.setLocked ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
};
