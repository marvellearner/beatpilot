import React from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EqBandId, EqGains, MOODS, MoodId, getMood } from '../../audio/Moods';

interface MoodEqPanelProps {
  mood: MoodId;
  eqGains: EqGains;
  onSetMood: (mood: MoodId) => void;
  onSetEq: (band: EqBandId, gainDb: number) => void;
  onResetEq: () => void;
  compact?: boolean; // phone layout
}

const formatDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/** Mood tabs + 5-band master equalizer. Shared by the laptop console and the phone remote. */
export const MoodEqPanel: React.FC<MoodEqPanelProps> = ({ mood, eqGains, onSetMood, onSetEq, onResetEq, compact }) => {
  const activeMood = getMood(mood);

  return (
    <div id="mood-eq-panel" className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#101826]/95 to-[#0a0e17]/95 shadow-xl flex flex-col gap-3">
      {/* Mood tabs */}
      <div id="mood-eq-moods" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-xs text-white tracking-wide">MOOD</h3>
          <span className="text-[10px] text-slate-400 text-right leading-snug ml-2 min-w-0">{activeMood.description}</span>
        </div>
        <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-5'}`}>
          {MOODS.map((m) => (
            <button id={`mood-eq-mood-${m.id}`}
              key={m.id}
              onClick={() => onSetMood(m.id)}
              className={`py-1.5 px-1 rounded-xl border text-[11px] font-bold transition-all flex flex-col items-center gap-0.5 ${
                mood === m.id
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-sm shadow-amber-500/20'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
              aria-pressed={mood === m.id}
            >
              <span className="text-sm leading-none">{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Master equalizer */}
      <div id="mood-eq-equalizer" className="flex flex-col gap-2 pt-2 border-t border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-xs text-white tracking-wide flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            EQUALIZER
          </h3>
          <button
            onClick={onResetEq}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            title={`Reset to the ${activeMood.label} preset`}
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>

        {EQ_BANDS.map((band) => {
          const value = eqGains[band.id];
          const isBass = band.id === 'bass';
          return (
            <div id={`mood-eq-band-${band.id}`} key={band.id} className="flex items-center gap-2">
              <div className={`shrink-0 ${compact ? 'w-16' : 'w-24'}`} title={band.hint}>
                <div className={`text-[11px] font-bold ${isBass ? 'text-amber-300' : 'text-slate-200'}`}>
                  {isBass ? '🔊 ' : ''}
                  {band.label}
                </div>
                {!compact && <div className="text-[9px] text-slate-500 truncate">{band.hint}</div>}
              </div>
              <input
                type="range"
                min={EQ_MIN_DB}
                max={EQ_MAX_DB}
                step={0.5}
                value={value}
                onChange={(e) => onSetEq(band.id, parseFloat(e.target.value))}
                onDoubleClick={() => onSetEq(band.id, 0)}
                aria-label={`${band.label} gain`}
                className={`flex-1 h-1.5 cursor-pointer ${isBass ? 'fader-a' : 'fader-b'}`}
              />
              <span
                className={`w-14 text-right text-[10px] font-mono shrink-0 ${
                  value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-slate-400'
                }`}
              >
                {formatDb(value)}
              </span>
            </div>
          );
        })}
        {!compact && (
          <p className="text-[9px] text-slate-500">
            Double-click a slider to flatten it. Boosts automatically lower the volume a little so the speakers don't distort.
          </p>
        )}
      </div>
    </div>
  );
};
