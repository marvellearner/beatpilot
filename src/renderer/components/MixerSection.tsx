import React, { useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import { Sliders, Zap, ArrowRightLeft, Volume2, Sparkles } from 'lucide-react';
import { VuMeter } from './VuMeter';

interface MixerSectionProps {
  engine: AudioEngine;
}

export const MixerSection: React.FC<MixerSectionProps> = ({ engine }) => {
  const [transitionDuration, setTransitionDuration] = useState<number>(8);
  const [transitionStyle, setTransitionStyle] = useState<'bass_swap' | 'smooth_crossfade'>('bass_swap');

  const crossfader = engine.getCrossfader();
  const isTransitioning = engine.isTransitioning;
  const progress = engine.transitionProgress;

  const handleCrossfaderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    engine.setCrossfader(parseFloat(e.target.value));
  };

  const handleStartTransition = (targetDeck: 'A' | 'B') => {
    const sourceDeck = targetDeck === 'A' ? 'B' : 'A';
    engine.startTransition({
      sourceDeck,
      targetDeck,
      durationSeconds: transitionDuration,
      style: transitionStyle,
    });
  };

  return (
    <div id="mixer" className="dj-panel rounded-2xl p-5 border border-white/10 flex flex-col gap-4">
      {/* Header */}
      <div id="mixer-header" className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-slate-300" />
          <span className="font-extrabold text-sm text-white tracking-wider">
            MASTER MIXER & AI TRANSITION ENGINE
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => engine.toggleBestParts()}
            title="For a dancing crowd: each song plays only its build-up and hook (about 1–1.5 min), then mixes into the next"
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-lg border transition-all ${
              engine.bestPartsMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
            }`}
          >
            <span>🔥</span>
            <span>Best Parts: {engine.bestPartsMode ? 'ON' : 'OFF'}</span>
          </button>

          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-slate-400" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              defaultValue="0.9"
              onChange={(e) => engine.setMasterVolume(parseFloat(e.target.value))}
              className="w-20 h-1.5"
              title="Master Volume"
            />
          </div>
        </div>
      </div>

      {/* Master Stereo Level VU Meter */}
      <div id="mixer-vu-meter" className="flex justify-center items-center py-1">
        <VuMeter
          analyserL={engine.masterAnalyserL}
          analyserR={engine.masterAnalyserR}
          analyser={engine.masterAnalyser}
          isPlaying={engine.deckA.getPlaybackState().isPlaying || engine.deckB.getPlaybackState().isPlaying}
          height={120}
          barWidth={8}
          barGap={4}
          segments={14}
          showLabels={true}
          showPeakText={true}
          title="MASTER LEVEL"
        />
      </div>

      {/* Crossfader Section */}
      <div id="mixer-crossfader-section" className="flex flex-col gap-2 bg-black/40 p-4 rounded-xl border border-white/5">
        <div className="flex justify-between items-center text-xs font-mono">
          <button
            onClick={() => engine.setCrossfader(-1)}
            className={`font-bold px-2 py-0.5 rounded transition-colors ${
              crossfader < -0.7 ? 'bg-cyan-500 text-black font-extrabold' : 'text-cyan-400 hover:text-cyan-300'
            }`}
          >
            ◄ DECK A (100%)
          </button>
          <button
            onClick={() => engine.setCrossfader(0)}
            className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-white/5"
          >
            CENTER (50/50)
          </button>
          <button
            onClick={() => engine.setCrossfader(1)}
            className={`font-bold px-2 py-0.5 rounded transition-colors ${
              crossfader > 0.7 ? 'bg-amber-500 text-black font-extrabold' : 'text-amber-400 hover:text-amber-300'
            }`}
          >
            DECK B (100%) ►
          </button>
        </div>

        {/* Crossfader Slider */}
        <div id="mixer-crossfader-slider" className="relative py-1">
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={crossfader}
            onChange={handleCrossfaderChange}
            disabled={isTransitioning}
            className="w-full h-3 bg-slate-900 border border-white/20 rounded-lg cursor-ew-resize"
          />
          <div className="flex justify-between text-[9px] font-mono text-slate-500 mt-1">
            <span>-1.0</span>
            <span>-0.5</span>
            <span>0.0</span>
            <span>+0.5</span>
            <span>+1.0</span>
          </div>
        </div>
      </div>

      {/* Automated AI DJ Transition Controls */}
      <div id="mixer-transition-controls" className="bg-gradient-to-r from-cyan-950/20 via-purple-950/30 to-amber-950/20 p-4 rounded-xl border border-white/10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
            <span className="font-bold text-xs text-white tracking-wide">
              AI SMART TRANSITION (PHRASE & BASS ALIGNED)
            </span>
          </div>

          {/* Duration Selector */}
          <div id="mixer-duration-selector" className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-[10px] text-slate-400">DURATION:</span>
            {[4, 8, 16].map((sec) => (
              <button id={`mixer-duration-${sec}`}
                key={sec}
                onClick={() => setTransitionDuration(sec)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  transitionDuration === sec ? 'bg-purple-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {/* Style Selector */}
        <div id="mixer-style-selector" className="grid grid-cols-2 gap-2 text-xs">
          <button
            onClick={() => setTransitionStyle('bass_swap')}
            className={`p-2 rounded-lg border text-left transition-all ${
              transitionStyle === 'bass_swap'
                ? 'bg-purple-600/30 border-purple-500 text-white font-semibold'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1">
              <Zap className="w-3 h-3 text-purple-400" />
              <span>Bass-Swap (Club Cut)</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              Eliminates bass mud with EQ swap
            </div>
          </button>

          <button
            onClick={() => setTransitionStyle('smooth_crossfade')}
            className={`p-2 rounded-lg border text-left transition-all ${
              transitionStyle === 'smooth_crossfade'
                ? 'bg-purple-600/30 border-purple-500 text-white font-semibold'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1">
              <ArrowRightLeft className="w-3 h-3 text-purple-400" />
              <span>Harmonic Crossfade</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              Equal-power volume blend
            </div>
          </button>
        </div>

        {/* Live Transition Progress Bar if active */}
        {isTransitioning && (
          <div id="mixer-transition-progress" className="flex flex-col gap-1 bg-black/40 p-2.5 rounded-lg border border-purple-500/30">
            <div className="flex justify-between items-center text-[10px] font-mono text-purple-300">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 animate-spin text-purple-400" />
                TRANSITIONING IN PROGRESS...
              </span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-400 via-purple-500 to-amber-400 h-full transition-all duration-75"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons: Mix to A or Mix to B */}
        <div id="mixer-mix-buttons" className="grid grid-cols-2 gap-3 pt-1">
          <button
            onClick={() => handleStartTransition('A')}
            disabled={isTransitioning}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-cyan-600/80 hover:bg-cyan-500 text-white border border-cyan-400/40 shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>AI MIX INTO DECK A</span>
          </button>

          <button
            onClick={() => handleStartTransition('B')}
            disabled={isTransitioning}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-amber-600/80 hover:bg-amber-500 text-white border border-amber-400/40 shadow-lg shadow-amber-600/20 transition-all disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>AI MIX INTO DECK B</span>
          </button>
        </div>
      </div>
    </div>
  );
};
