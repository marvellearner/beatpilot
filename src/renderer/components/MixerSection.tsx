import React, { useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import { useEngineRefresh } from '../hooks/useEngineStore';
import { ArrowLeft, ArrowRight, Volume2 } from 'lucide-react';
import { VuMeter } from './VuMeter';
import { MusicLevelControl } from './MusicLevelControl';

interface MixerSectionProps {
  engine: AudioEngine;
}

const STYLES = [
  { id: 'filter_bass_swap' as const, label: 'Filter swap', hint: 'Resonant HPF sweep & low-bass kill on the drop' },
  { id: 'loop_roll_riser' as const, label: 'Loop roll', hint: '8-beat stutter riser into hard drop' },
  { id: 'vinyl_brake_drop' as const, label: 'Vinyl brake', hint: 'Turntable motor stop deceleration into drop' },
  { id: 'echo_freeze_throw' as const, label: 'Echo freeze', hint: 'Dotted-8th dub delay trailing into space' },
  { id: 'showcase_3band_handoff' as const, label: '3-band stem', hint: 'Pro 3-band stem frequency isolation handover' },
];

export const MixerSection: React.FC<MixerSectionProps> = ({ engine }) => {
  // Crossfader, mix progress and buttons read the engine: redraw as it changes
  useEngineRefresh(engine);
  const [transitionDuration, setTransitionDuration] = useState<number>(8);
  const [transitionStyle, setTransitionStyle] = useState<typeof STYLES[number]['id']>('filter_bass_swap');

  const crossfader = engine.getCrossfader();
  const isTransitioning = engine.isTransitioning;
  const progress = engine.transitionProgress;
  const aPlaying = engine.deckA.getPlaybackState().isPlaying;
  const bPlaying = engine.deckB.getPlaybackState().isPlaying;
  // How much of each deck is heard (equal power, the same curve as the audio)
  const x = (Math.max(-1, Math.min(1, crossfader)) + 1) / 2;
  const shareA = Math.round(Math.cos((x * Math.PI) / 2) ** 2 * 100);
  const shareB = 100 - shareA;

  const handleStartTransition = (targetDeck: 'A' | 'B') => {
    engine.startTransition({
      sourceDeck: targetDeck === 'A' ? 'B' : 'A',
      targetDeck,
      durationSeconds: transitionDuration,
      style: transitionStyle,
      manualStyle: true,
    });
  };

  return (
    <div id="mixer" className="pro-panel p-4 flex flex-col gap-3">
      {/* Header */}
      <div id="mixer-header" className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-white tracking-wide">Mixer</span>
        <button
          type="button"
          onClick={() => engine.toggleBestParts()}
          aria-pressed={engine.bestPartsMode}
          title="For a dancing crowd: each song plays only its build-up and hook (about 1–1.5 min), then mixes into the next"
          className="flex items-center gap-2 h-7 pl-1 pr-2.5 rounded-full border border-white/10 bg-[#0a0c11] text-[11px] font-semibold text-slate-300 hover:text-white"
        >
          <span className={`w-8 h-5 rounded-full relative transition-colors ${engine.bestPartsMode ? 'bg-amber-500' : 'bg-white/10'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${engine.bestPartsMode ? 'left-3.5' : 'left-0.5'}`} />
          </span>
          Best parts
        </button>
      </div>

      {/* Master: level meter + mix status */}
      <div className="pro-inset p-3 flex items-stretch gap-3">
        <div id="mixer-vu-meter" className="flex items-center justify-center shrink-0">
          <VuMeter
            analyserL={engine.masterAnalyserL}
            analyserR={engine.masterAnalyserR}
            analyser={engine.masterAnalyser}
            isPlaying={aPlaying || bPlaying}
            height={128}
            barWidth={8}
            barGap={4}
            segments={16}
            showLabels={true}
            showPeakText={true}
            title="MASTER"
          />
        </div>
        <div className="flex-1 flex flex-col justify-between gap-2 min-w-0">
          <div>
            <div className="pro-label mb-1">On air</div>
            <div className="flex gap-1.5">
              {(['A', 'B'] as const).map((id) => {
                const playing = id === 'A' ? aPlaying : bPlaying;
                const share = id === 'A' ? shareA : shareB;
                const color = id === 'A' ? 'var(--pro-a)' : 'var(--pro-b)';
                return (
                  <div key={id} className="flex-1 rounded-md border border-white/5 bg-[#0f1218] px-2 py-1.5">
                    <div className="flex items-center justify-between text-[10px] font-semibold">
                      <span style={{ color }}>DECK {id}</span>
                      <span className={playing ? 'text-emerald-400' : 'text-slate-600'}>{playing ? '●' : '○'}</span>
                    </div>
                    <div className="pro-num text-base font-bold text-white">{share}%</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="pro-label">Master</span>
              <span className="pro-num text-[11px] text-slate-400">{Math.round(engine.masterVolume * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={engine.masterVolume}
                onChange={(e) => engine.setMasterVolume(parseFloat(e.target.value))}
                className="w-full"
                title="Master volume"
                aria-label="Master volume"
              />
            </div>
          </div>
          <MusicLevelControl engine={engine} variant="pro" />
        </div>
      </div>

      {/* Crossfader */}
      <div id="mixer-crossfader-section" className="pro-inset px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => engine.setCrossfader(-1)}
            className={`text-[11px] font-bold px-1.5 rounded ${crossfader < -0.7 ? 'text-cyan-300' : 'text-slate-500 hover:text-cyan-300'}`}
            title="All Deck A"
          >
            A
          </button>
          <span className="pro-label">Crossfader</span>
          <button
            type="button"
            onClick={() => engine.setCrossfader(1)}
            className={`text-[11px] font-bold px-1.5 rounded ${crossfader > 0.7 ? 'text-amber-300' : 'text-slate-500 hover:text-amber-300'}`}
            title="All Deck B"
          >
            B
          </button>
        </div>
        <div id="mixer-crossfader-slider" className="relative">
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={crossfader}
            onChange={(e) => engine.setCrossfader(parseFloat(e.target.value))}
            disabled={isTransitioning}
            className="w-full pro-xfader cursor-ew-resize"
            aria-label="Crossfader"
          />
          {/* Centre detent */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-px h-1.5 bg-white/25" />
        </div>
        <button type="button" onClick={() => engine.setCrossfader(0)} className="self-center text-[10px] text-slate-500 hover:text-white mt-1">
          Centre
        </button>
      </div>

      {/* Automatic mix */}
      <div id="mixer-transition-controls" className="pro-inset p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pro-label">Auto mix</span>
          <span className="text-[10px] text-slate-600">On the phrase, beat-aligned</span>
        </div>
        {/* Styles as a wrapping grid of tiles: any number of them fits the mixer's width */}
        <div id="mixer-style-selector" className="grid grid-cols-3 gap-1.5" role="group" aria-label="Mix style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTransitionStyle(s.id)}
              aria-pressed={transitionStyle === s.id}
              title={s.hint}
              className="pro-btn !h-8 !px-1.5 !text-[11px] whitespace-nowrap overflow-hidden"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="pro-label">Length</span>
          <div id="mixer-duration-selector" className="pro-seg" role="group" aria-label="Mix length">
            {[4, 8, 16].map((sec) => (
              <button id={`mixer-duration-${sec}`} key={sec} type="button" onClick={() => setTransitionDuration(sec)} aria-pressed={transitionDuration === sec} className="pro-num">
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {isTransitioning && (
          <div id="mixer-transition-progress" className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-300">Mixing…</span>
              <span className="pro-num text-slate-400">{Math.round(progress * 100)}%</span>
            </div>
            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
              <div className="h-full bg-white/80 transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}

        <div id="mixer-mix-buttons" className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleStartTransition('A')}
            disabled={isTransitioning}
            className="pro-btn !h-10 !border-cyan-500/40 hover:!border-cyan-400 !text-cyan-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Mix to A
          </button>
          <button
            type="button"
            onClick={() => handleStartTransition('B')}
            disabled={isTransitioning}
            className="pro-btn !h-10 !border-amber-500/40 hover:!border-amber-400 !text-amber-200"
          >
            Mix to B
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
