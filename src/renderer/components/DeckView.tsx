import React, { useRef } from 'react';
import { VirtualDeck } from '../../audio/VirtualDeck';
import type { AudioEngine } from '../../audio/AudioEngine';
import { shiftKey, getCamelotDetails, getHarmonicCompatibility } from '../../audio/KeyDetector';
import { isStrictStartSong } from '../../audio/songMatch';
import { DeckId } from '../../types';
import { WaveformCanvas } from './WaveformCanvas';
import { useEngineRefresh } from '../hooks/useEngineStore';
import { Play, Pause, FolderOpen, RotateCcw, Square, Flame } from 'lucide-react';

interface DeckViewProps {
  deck: VirtualDeck;
  deckId: DeckId;
  engine: AudioEngine; // hot cues and loops go through the engine (it re-syncs the mix and drums)
}

const LOOP_BARS = [1, 2, 4];

const COMPAT_TEXT: Record<string, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
  teal: 'text-teal-400',
  purple: 'text-purple-400',
  rose: 'text-rose-400',
};

const formatTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/** One vertical channel fader (EQ band or volume) with its value / kill switch underneath. */
const ChannelFader: React.FC<{
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  footer: React.ReactNode;
}> = ({ id, label, min, max, step, value, onChange, className = '', footer }) => (
  <div id={id} className="flex flex-col items-center gap-2">
    <span className="pro-label">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`pro-vfader ${className}`}
      aria-label={label}
    />
    {footer}
  </div>
);

export const DeckView: React.FC<DeckViewProps> = ({ deck, deckId, engine }) => {
  // The deck's time, play state and track live in the engine: redraw as they change
  useEngineRefresh(engine);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = deck.getPlaybackState();
  const track = state.track;
  const d = deckId.toLowerCase();

  // The key as heard: without key lock, speed shifts pitch (6 % = a semitone)
  const heardKey = track?.key ? (engine.keyLock ? track.key : shiftKey(track.key, state.playbackRate)) : null;
  const keySure = (track?.keyConfidence ?? 0) >= 0.3;
  const keyDetails = heardKey ? getCamelotDetails(heardKey) : null;
  const hotCues = engine.getHotCues(deckId);
  const loopBars = engine.getLoopBars(deckId);

  // Cross-deck harmonic compatibility
  const otherDeck = deckId === 'A' ? engine.deckB : engine.deckA;
  const otherState = otherDeck.getPlaybackState();
  const otherTrack = otherState.track;
  const otherKey = otherTrack?.key ? (engine.keyLock ? otherTrack.key : shiftKey(otherTrack.key, otherState.playbackRate)) : null;
  const deckCompat = heardKey && otherKey ? getHarmonicCompatibility(otherKey, heardKey) : null;

  const isA = deckId === 'A';
  const accent = isA ? 'var(--pro-a)' : 'var(--pro-b)';
  const accentText = isA ? 'text-cyan-300' : 'text-amber-300';
  const onAir = engine.activeDeck === deckId && state.isPlaying;
  const hookTimes = track?.highlightTime !== undefined ? (track.hooks?.length ? track.hooks.map((h) => h.time) : [track.highlightTime]) : [];
  const pitchPct = (state.playbackRate - 1) * 100;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) await deck.loadAudioFile(files[0]);
  };

  const eqFooter = (gain: number, kill: () => void) => (
    <button
      type="button"
      onClick={kill}
      className={`w-12 h-5 rounded text-[10px] font-semibold pro-num transition-colors ${
        gain <= -24 ? 'bg-rose-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white'
      }`}
      title={gain <= -24 ? 'Bring this band back' : 'Kill this band'}
    >
      {gain <= -24 ? 'KILL' : `${gain > 0 ? '+' : ''}${Math.round(gain)} dB`}
    </button>
  );

  return (
    <div
      id={`deck-${d}`}
      className="pro-panel p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{ boxShadow: onAir ? `0 0 0 1px ${accent} inset, 0 10px 30px rgba(0,0,0,0.35)` : undefined }}
    >
      {/* Accent strip: shows which deck this is at a glance */}
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent, opacity: onAir ? 1 : 0.35 }} />

      {/* Header */}
      <div id={`deck-${d}-header`} className="flex items-start gap-3">
        <div
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-sm font-extrabold text-black"
          style={{ background: accent }}
        >
          {deckId}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-white truncate leading-tight" title={track ? track.title : 'No track loaded'}>
            {track ? track.title : 'No track loaded'}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 min-w-0">
            <span className="truncate">{track ? track.artist : 'Load an audio file, or mix a song in from Up Next'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`h-6 px-2 rounded-md text-[10px] font-bold tracking-wider flex items-center ${
              onAir ? 'text-black' : state.isPlaying ? 'bg-white/10 text-white' : 'bg-white/5 text-slate-500'
            }`}
            style={onAir ? { background: accent } : undefined}
          >
            {!track ? 'EMPTY' : onAir ? 'ON AIR' : state.isPlaying ? 'PLAYING' : 'CUED'}
          </span>
          <div id={`deck-${d}-load-file`}>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="pro-btn !h-6 !px-2" title="Load an audio file onto this deck">
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Load</span>
            </button>
          </div>
        </div>
      </div>

      {/* Song markers: hooks, skipped talk, fixed start (one line, never wraps) */}
      <div className="flex items-center gap-1.5 h-6 overflow-hidden whitespace-nowrap text-[11px]">
        {hookTimes.length > 0 ? (
          <button
            type="button"
            onClick={() => deck.jumpToHighlight()}
            title={`Hooks (each chorus / a drop): ${hookTimes.map(formatTime).join(', ')}. Click to jump to the next.`}
            className="h-6 px-2 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 flex items-center gap-1.5 shrink-0"
          >
            <Flame className="w-3 h-3 text-amber-400" />
            <span className="text-slate-500">Hooks</span>
            <span className="pro-num flex items-center gap-2">
              {hookTimes.map((t, i) => (
                <span key={i}>{formatTime(t)}</span>
              ))}
            </span>
          </button>
        ) : (
          <span className="text-slate-600">{track ? 'Finding hooks…' : ''}</span>
        )}
        {!!track?.musicStartTime && track.musicStartTime > 0 && (
          <span
            title={track.introSkipReason || `Skips the first ${formatTime(track.musicStartTime)} (talking before the music)`}
            className="h-6 px-2 rounded-md bg-white/5 text-slate-400 flex items-center gap-1 shrink-0"
          >
            <span className="text-slate-500">Music starts</span>
            <span className="pro-num text-slate-300">{formatTime(track.musicStartTime)}</span>
          </span>
        )}
        {isStrictStartSong(track) && (
          <span title="Exception: always plays from 0:00, intro included" className="h-6 px-2 rounded-md bg-emerald-500/10 text-emerald-300 flex items-center shrink-0">
            Starts at 0:00
          </span>
        )}
      </div>

      {/* Waveform & playhead */}
      <WaveformCanvas
        id={`deck-${d}-waveform`}
        analyser={deck.analyserNode}
        isPlaying={state.isPlaying}
        currentTime={state.currentTime}
        duration={state.duration}
        peaks={track?.waveformPeaks}
        color={isA ? '#22d3ee' : '#f59e0b'}
        highlightTime={track?.highlightTime}
        hookTimes={track?.hooks?.map((h) => h.time)}
        cueInTime={track?.cueInTime}
        loop={state.loop}
        loopInTime={state.loopInTime}
        onSeek={(time) => deck.seek(time)}
      />

      {/* Readouts */}
      <div id={`deck-${d}-telemetry`} className="pro-inset grid grid-cols-5 divide-x divide-white/5">
        <div className="px-3 py-2">
          <div className="pro-label">BPM</div>
          <div className="pro-num text-xl font-bold text-white leading-tight">{track ? state.effectiveBpm.toFixed(1) : '—'}</div>
        </div>
        <div
          className="px-3 py-2"
          title={
            heardKey
              ? `${heardKey} (${keyDetails?.musicalKey})${
                  state.playbackRate !== 1.0 && !engine.keyLock ? ` heard at ${state.playbackRate.toFixed(2)}x (detected: ${track?.key})` : ''
                }${deckCompat ? ` • with Deck ${isA ? 'B' : 'A'}: ${deckCompat.label} (${deckCompat.description})` : ''}`
              : 'Key not detected yet'
          }
        >
          <div className="pro-label">Key</div>
          <div
            className={`pro-num text-xl font-bold leading-tight flex items-baseline gap-1 ${
              deckCompat ? COMPAT_TEXT[deckCompat.color] ?? 'text-cyan-400' : keySure ? 'text-white' : 'text-slate-500'
            }`}
          >
            <span>{heardKey ?? '—'}</span>
            {keyDetails && keyDetails.shortName !== '—' && <span className="text-[11px] font-medium text-slate-500">{keyDetails.shortName}</span>}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="pro-label">Pitch</div>
          <div className={`pro-num text-xl font-bold leading-tight ${Math.abs(pitchPct) < 0.05 ? 'text-slate-400' : accentText}`}>
            {pitchPct >= 0 ? '+' : ''}
            {pitchPct.toFixed(1)}%
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="pro-label">Elapsed</div>
          <div className="pro-num text-xl font-semibold text-slate-200 leading-tight">{formatTime(state.currentTime)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="pro-label">Remain</div>
          <div className="pro-num text-xl font-semibold text-slate-400 leading-tight">-{formatTime(Math.max(0, state.duration - state.currentTime))}</div>
        </div>
      </div>

      {/* Transport + tempo */}
      <div id={`deck-${d}-transport`} className="flex items-stretch gap-2">
        <button
          id={`deck-${d}-play-pause-button`}
          type="button"
          onClick={() => engine.toggleDeckPlay(deckId)}
          disabled={!track}
          className="w-24 h-12 rounded-lg flex items-center justify-center gap-2 text-xs font-bold tracking-wide transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          style={
            state.isPlaying
              ? { background: accent, color: '#000' }
              : { background: '#161a22', color: '#e2e8f0', border: '1px solid var(--pro-line-strong)' }
          }
        >
          {state.isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{state.isPlaying ? 'PAUSE' : 'PLAY'}</span>
        </button>
        <button
          id={`deck-${d}-stop-button`}
          type="button"
          onClick={() => deck.stop()}
          disabled={!track}
          title="Stop and go back to the start"
          className="pro-btn !h-12 w-14 flex-col !gap-0.5"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span className="text-[10px]">STOP</span>
        </button>
        <button
          id={`deck-${d}-hook-button`}
          type="button"
          onClick={() => deck.jumpToHighlight()}
          disabled={!track}
          title="Jump to the next hook (each chorus / the drop in turn)"
          className="pro-btn !h-12 w-14 flex-col !gap-0.5"
        >
          <Flame className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[10px]">HOOK</span>
        </button>
        <div id={`deck-${d}-pitch-slider`} className="pro-inset flex-1 px-3 flex flex-col justify-center gap-2 min-w-0">
          <div className="flex items-center justify-between">
            <span className="pro-label">Tempo</span>
            <button type="button" onClick={() => deck.setPlaybackRate(1.0)} title="Reset tempo to 0%" className="text-slate-500 hover:text-white flex items-center gap-1 text-[10px]">
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.002"
            value={state.playbackRate}
            onChange={(e) => deck.setPlaybackRate(parseFloat(e.target.value))}
            className={`w-full ${isA ? 'fader-a' : 'fader-b'}`}
            aria-label="Tempo"
          />
        </div>
      </div>

      {/* Hot cues (tap an empty pad to save the spot, a saved one to jump) & loops */}
      <div id={`deck-${d}-cues`} className="flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1.5">
          {hotCues.map((cue, slot) => (
            <div key={slot} className="relative">
              <button
                id={`deck-${d}-cue-${slot + 1}`}
                type="button"
                onClick={() => engine.hotCue(deckId, slot)}
                disabled={!track}
                className="w-full h-9 rounded-md text-[11px] font-semibold pro-num transition-colors disabled:opacity-35 flex items-center justify-center gap-1.5"
                style={
                  cue !== null
                    ? { background: isA ? 'rgba(34,211,238,0.14)' : 'rgba(245,158,11,0.14)', border: `1px solid ${accent}`, color: '#f8fafc' }
                    : { background: '#12151c', border: '1px dashed rgba(255,255,255,0.12)', color: '#64748b' }
                }
                title={cue !== null ? `Jump to ${formatTime(cue)}` : 'Save the current spot (on the beat)'}
              >
                <span className="opacity-60">{slot + 1}</span>
                <span>{cue !== null ? formatTime(cue) : 'Set'}</span>
              </button>
              {cue !== null && (
                <button
                  type="button"
                  onClick={() => engine.clearHotCue(deckId, slot)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#0b0d12] border border-white/20 text-[9px] leading-none text-slate-300 hover:text-rose-300"
                  aria-label={`Clear hot cue ${slot + 1}`}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          <button
            id={`deck-${d}-loop-in-btn`}
            type="button"
            onClick={() => engine.setLoopIn(deckId)}
            disabled={!state.isPlaying}
            aria-pressed={state.loopInTime !== null && !state.loop}
            className={`pro-btn !h-8 ${state.loopInTime !== null && !state.loop ? '!border-amber-400 !text-amber-300' : ''}`}
            title="Loop in: start point (snaps to the beat)"
          >
            IN
          </button>
          <button
            id={`deck-${d}-loop-out-btn`}
            type="button"
            onClick={() => engine.setLoopOut(deckId)}
            disabled={!state.isPlaying}
            aria-pressed={!!state.loop}
            className={`pro-btn !h-8 ${state.loop ? '!bg-emerald-500 !text-black !border-emerald-400' : state.loopInTime !== null ? '!border-amber-400 !text-amber-300' : ''}`}
            title={state.loop ? 'Leave the loop' : 'Loop out: end point, starts looping'}
          >
            OUT
          </button>
          <button
            id={`deck-${d}-reloop-btn`}
            type="button"
            onClick={() => engine.reloop(deckId)}
            disabled={!state.loop && !state.hasLastLoop}
            className={`pro-btn !h-8 ${state.loop ? '!text-rose-300 !border-rose-500/50' : ''}`}
            title={state.loop ? 'Leave the loop' : 'Reloop (back into the last loop)'}
          >
            {state.loop ? 'EXIT' : 'RELOOP'}
          </button>
          {LOOP_BARS.map((bars) => (
            <button
              key={bars}
              id={`deck-${d}-loop-${bars}`}
              type="button"
              onClick={() => engine.toggleBeatLoop(deckId, bars)}
              disabled={!state.isPlaying}
              aria-pressed={loopBars === bars}
              className={`pro-btn !h-8 pro-num ${loopBars === bars ? '!bg-emerald-500 !text-black !border-emerald-400' : ''}`}
              title={loopBars === bars ? 'Leave the loop' : `Loop ${bars} bar${bars > 1 ? 's' : ''} from the current bar`}
            >
              {bars} BAR
            </button>
          ))}
        </div>
      </div>

      {/* Channel strip: 3-band isolator EQ & channel volume */}
      <div id={`deck-${d}-eq`} className="pro-inset px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="pro-label">Channel EQ</span>
          <span className="text-[10px] text-slate-600">Click a value to kill the band</span>
        </div>
        <div className="grid grid-cols-4">
          <ChannelFader
            id={`deck-${d}-low-eq`}
            label="Low"
            min={-40}
            max={6}
            step={1}
            value={state.lowGain}
            onChange={(v) => deck.setEQ(v, state.midGain, state.highGain)}
            footer={eqFooter(state.lowGain, () => deck.setEQ(state.lowGain === -40 ? 0 : -40, state.midGain, state.highGain))}
          />
          <ChannelFader
            id={`deck-${d}-mid-eq`}
            label="Mid"
            min={-40}
            max={6}
            step={1}
            value={state.midGain}
            onChange={(v) => deck.setEQ(state.lowGain, v, state.highGain)}
            footer={eqFooter(state.midGain, () => deck.setEQ(state.lowGain, state.midGain === -40 ? 0 : -40, state.highGain))}
          />
          <ChannelFader
            id={`deck-${d}-high-eq`}
            label="High"
            min={-40}
            max={6}
            step={1}
            value={state.highGain}
            onChange={(v) => deck.setEQ(state.lowGain, state.midGain, v)}
            footer={eqFooter(state.highGain, () => deck.setEQ(state.lowGain, state.midGain, state.highGain === -40 ? 0 : -40))}
          />
          <ChannelFader
            id={`deck-${d}-channel-gain`}
            label="Vol"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            onChange={(v) => deck.setVolume(v)}
            className={isA ? 'fader-a' : 'fader-b'}
            footer={<span className="w-12 h-5 flex items-center justify-center text-[10px] font-semibold text-slate-300 pro-num">{Math.round(state.volume * 100)}%</span>}
          />
        </div>
      </div>
    </div>
  );
};
