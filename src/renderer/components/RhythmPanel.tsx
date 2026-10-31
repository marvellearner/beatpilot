import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { RHYTHM_STYLES, getRhythmStyle } from '../../audio/rhythm/styles';
import type { RhythmCommand, RhythmState } from '../../audio/rhythm/RhythmEnhancer';

interface RhythmPanelProps {
  rhythm: RhythmState;
  onCommand: (cmd: RhythmCommand) => void;
  compact?: boolean; // phone layout
}

const SECTION_LABEL: Record<RhythmState['section'], string> = {
  off: 'Resting',
  light: 'Light groove',
  full: 'Full groove',
  fill: 'Fill',
};

const levelWord = (level: number) => (level < 0.5 ? 'soft' : level < 0.8 ? 'medium' : 'strong');

/**
 * Live Rhythm Enhancer controls. In AI mode (the default) the AI DJ decides per song, so the
 * panel is just on/off, volume and what the AI chose; "Pick drum style" shows the styles.
 * Shared by the laptop console (Party and Pro views) and the phone remote.
 */
export const RhythmPanel: React.FC<RhythmPanelProps> = ({ rhythm, onCommand, compact }) => {
  const active = rhythm.enabled && rhythm.section !== 'off';
  const ai = rhythm.mode === 'ai';
  const plan = rhythm.plan;
  return (
    <div
      id="rhythm-panel"
      className={`dj-panel rounded-2xl p-3.5 border shadow-xl flex flex-col gap-2.5 bg-gradient-to-b from-[#14101e]/95 to-[#0c0914]/95 ${
        rhythm.enabled ? 'border-rose-500/40' : 'border-white/10'
      }`}
    >
      {/* Header: name, what's playing now, on/off */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">🥁</span>
          <div className="min-w-0">
            <h3 className="font-extrabold text-xs text-white tracking-wide">LIVE RHYTHM ENHANCER</h3>
            <span className="text-[10px] text-slate-400">Real dhol &amp; percussion, locked to the song</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {rhythm.enabled && (
            <span
              id="rhythm-section"
              className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold border ${
                rhythm.section === 'fill'
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                  : active
                    ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
                    : 'bg-white/5 text-slate-400 border-white/10'
              }`}
            >
              {SECTION_LABEL[rhythm.section]}
              {rhythm.bpm ? ` · ${rhythm.bpm} BPM` : ''}
            </span>
          )}
          <button
            id="rhythm-toggle"
            onClick={() => onCommand({ kind: 'toggle' })}
            disabled={!rhythm.samplesReady}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 ${
              rhythm.enabled ? 'bg-rose-500 text-white shadow-rose-500/30' : 'bg-white/10 hover:bg-white/20 text-slate-200'
            }`}
            aria-pressed={rhythm.enabled}
          >
            Drums: {rhythm.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Who decides */}
      <div id="rhythm-mode" className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
        {(['ai', 'manual'] as const).map((m) => (
          <button
            key={m}
            id={`rhythm-mode-${m}`}
            onClick={() => rhythm.mode !== m && onCommand({ kind: 'mode' })}
            className={`py-1 rounded-lg text-[11px] font-bold transition-all ${
              rhythm.mode === m ? 'bg-purple-600/40 text-white border border-purple-400/50' : 'text-slate-400 hover:text-white'
            }`}
            aria-pressed={rhythm.mode === m}
          >
            {m === 'ai' ? '🤖 AI decides' : 'Pick drum style'}
          </button>
        ))}
      </div>

      {/* AI mode: what the AI chose for this song */}
      {ai && (
        <div id="rhythm-ai-choice" className="bg-purple-950/30 px-2.5 py-2 rounded-xl border border-purple-500/20 flex flex-col gap-0.5">
          {plan ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white truncate">
                  {plan.play ? `${getRhythmStyle(plan.styleId).name} · ${levelWord(plan.level)}` : 'No drums on this song'}
                </span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                    plan.source === 'ai' ? 'bg-purple-500/20 text-purple-200 border-purple-400/40' : 'bg-white/5 text-slate-400 border-white/10'
                  }`}
                  title={
                    plan.source === 'ai'
                      ? "The AI DJ identified this song; the style follows from it, the mood and the song's sound"
                      : plan.source === 'known'
                        ? "Recognised from the artist or title; the style follows from it, the mood and the song's sound"
                        : 'Best guess until the AI DJ has identified this song (or while the AI is offline)'
                  }
                >
                  {plan.source === 'ai' ? '🤖 AI' : plan.source === 'known' ? 'Known artist' : 'Guess (AI pending)'}
                </span>
              </div>
              <span className="text-[10px] text-purple-200/80 truncate" title={plan.reason}>
                {plan.reason}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-slate-400">{rhythm.enabled ? 'Waiting for a song…' : 'Turn it on and the AI picks drums for every song.'}</span>
          )}
        </div>
      )}

      {/* What it's doing right now */}
      <div
        id="rhythm-status"
        className="bg-black/50 px-2.5 py-1.5 rounded-xl border border-white/5 font-mono text-[10px] text-purple-200 truncate"
        title={rhythm.status}
      >
        {rhythm.samplesReady ? (rhythm.enabled ? rhythm.status : 'Off.') : 'Loading drum samples…'}
      </div>

      {/* Manual mode: styles and arrangement */}
      {!ai && (
        <>
          <div id="rhythm-styles" className="grid grid-cols-2 gap-1.5">
            {RHYTHM_STYLES.map((s) => (
              <button
                id={`rhythm-style-${s.id}`}
                key={s.id}
                onClick={() => onCommand({ kind: 'style', styleId: s.id })}
                className={`p-2 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                  rhythm.styleId === s.id
                    ? 'bg-rose-500/20 border-rose-500 text-rose-100 shadow-sm'
                    : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                }`}
                title={s.description}
                aria-pressed={rhythm.styleId === s.id}
              >
                <span className="text-xs font-bold truncate">{s.name}</span>
                <span className={`text-[9px] text-slate-400 ${compact ? 'line-clamp-2' : 'truncate'}`}>{s.suits}</span>
              </button>
            ))}
          </div>
          <button
            id="rhythm-follow-song"
            onClick={() => onCommand({ kind: 'followSong' })}
            className={`self-start px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
              rhythm.followSong ? 'bg-purple-600/30 border-purple-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'
            }`}
            title={
              rhythm.followSong
                ? 'Follows the song: out in intros and breakdowns, light in verses, full on choruses, fills into big parts'
                : 'Steady: the full groove all song, with a fill every 8 bars'
            }
          >
            {rhythm.followSong ? 'Follows the song' : 'Steady all song'}
          </button>
        </>
      )}

      {/* Volume */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/5">
        <span className="text-[10px] text-slate-400 font-medium">Volume</span>
        <input
          id="rhythm-level"
          type="range"
          min={0}
          max={100}
          value={Math.round(rhythm.level * 100)}
          onChange={(e) => onCommand({ kind: 'level', level: Number(e.target.value) / 100 })}
          className="flex-1 min-w-[90px] accent-rose-500"
          aria-label="Rhythm volume"
        />
        <span className="text-[10px] font-mono text-slate-300 w-8 text-right">{Math.round(rhythm.level * 100)}%</span>
        <button
          id="rhythm-mute"
          onClick={() => onCommand({ kind: 'mute' })}
          className={`p-1.5 rounded-lg border ${rhythm.muted ? 'bg-red-500/30 border-red-500/50 text-red-300' : 'bg-white/5 border-white/10 text-slate-400'}`}
          aria-label={rhythm.muted ? 'Unmute rhythm' : 'Mute rhythm'}
          aria-pressed={rhythm.muted}
        >
          {rhythm.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
