import React from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { useEngineRefresh } from '../hooks/useEngineStore';
import { Mic } from 'lucide-react';

/**
 * The "Music" fader: lowers the music and keeps the vocals (VocalFocus), for both decks.
 * Redraws on its own (cheap), so the panel around it doesn't have to.
 */
export const MusicLevelControl: React.FC<{ engine: AudioEngine; variant?: 'party' | 'pro' }> = ({ engine, variant = 'party' }) => {
  useEngineRefresh(engine);
  const level = engine.musicLevel;
  const pct = Math.round(level * 100);
  const words = pct >= 100 ? 'Full song' : pct <= 0 ? 'Vocals only' : pct < 40 ? 'Mostly vocals' : 'Music lowered';

  if (variant === 'pro') {
    return (
      <div id="mixer-music-level">
        <div className="flex items-center justify-between mb-1">
          <span className="pro-label" title="Lowers the music and keeps the vocals">Music</span>
          <span className="pro-num text-[11px] text-slate-400">
            {pct}% <span className="text-slate-600">· {words}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Mic className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={level}
            onChange={(e) => engine.setMusicLevel(parseFloat(e.target.value))}
            onDoubleClick={() => engine.setMusicLevel(1)}
            className="w-full"
            aria-label="Music level (vocals stay)"
            title="Lower the music, keep the vocals. Double-click: full song"
          />
        </div>
      </div>
    );
  }

  return (
    <div id="party-console-music-level" className="flex items-center justify-center gap-2.5 text-[11px] text-slate-400">
      <Mic className={`w-3.5 h-3.5 ${pct < 100 ? 'text-pink-300' : 'text-slate-500'}`} />
      <span className="w-28 text-right" title="Lowers the music and keeps the vocals">
        Music <span className="text-slate-500">(vocals stay)</span>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={level}
        onChange={(e) => engine.setMusicLevel(parseFloat(e.target.value))}
        className="w-44 accent-pink-400"
        aria-label="Music level (vocals stay)"
        title="Lower the music, keep the vocals"
      />
      <span className="w-24 font-mono text-slate-300">
        {pct}% <span className="text-slate-500 font-sans">{pct < 100 ? `· ${words}` : ''}</span>
      </span>
      {pct < 100 && (
        <button type="button" onClick={() => engine.setMusicLevel(1)} className="text-[10px] text-slate-500 hover:text-white underline-offset-2 hover:underline">
          Reset
        </button>
      )}
    </div>
  );
};
