import React, { useRef } from 'react';
import { VirtualDeck } from '../../audio/VirtualDeck';
import type { AudioEngine } from '../../audio/AudioEngine';
import { shiftKey, getCamelotDetails, getHarmonicCompatibility } from '../../audio/KeyDetector';
import { isStrictStartSong } from '../../audio/songMatch';
import { DeckId } from '../../types';
import { WaveformCanvas } from './WaveformCanvas';
import { Play, Pause, FolderPlus, Disc3, RotateCcw, Square } from 'lucide-react';

interface DeckViewProps {
  deck: VirtualDeck;
  deckId: DeckId;
  engine: AudioEngine; // hot cues and loops go through the engine (it re-syncs the mix and drums)
}

const LOOP_BARS = [1, 2, 4];

export const DeckView: React.FC<DeckViewProps> = ({ deck, deckId, engine }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = deck.getPlaybackState();
  const track = state.track;

  // The key as heard: without key lock, speed shifts pitch (6 % = a semitone)
  const heardKey = track?.key ? (engine.keyLock ? track.key : shiftKey(track.key, state.playbackRate)) : null;
  const keySure = (track?.keyConfidence ?? 0) >= 0.3;
  const keyDetails = heardKey ? getCamelotDetails(heardKey) : null;
  const hotCues = engine.getHotCues(deckId);
  const loopBars = engine.getLoopBars(deckId);

  // Cross-deck harmonic compatibility for Pro DJing
  const otherDeck = deckId === 'A' ? engine.deckB : engine.deckA;
  const otherState = otherDeck.getPlaybackState();
  const otherTrack = otherState.track;
  const otherKey = otherTrack?.key
    ? (engine.keyLock ? otherTrack.key : shiftKey(otherTrack.key, otherState.playbackRate))
    : null;
  const deckCompat = heardKey && otherKey ? getHarmonicCompatibility(otherKey, heardKey) : null;

  const isA = deckId === 'A';
  const primaryColor = isA ? '#00f2fe' : '#ff8c00';
  const borderGlow = isA ? 'border-cyan-500/40 glow-deck-a' : 'border-amber-500/40 glow-deck-b';
  const badgeColor = isA ? 'bg-cyan-500 text-black' : 'bg-amber-500 text-black';

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      await deck.loadAudioFile(files[0]);
    }
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rate = parseFloat(e.target.value);
    deck.setPlaybackRate(rate);
  };

  const resetPitch = () => {
    deck.setPlaybackRate(1.0);
  };

  return (
    <div id={`deck-${deckId.toLowerCase()}`} className={`dj-panel rounded-2xl p-5 border flex flex-col gap-4 relative transition-all ${state.isPlaying ? borderGlow : 'border-white/10'}`}>
      {/* Deck Header */}
      <div id={`deck-${deckId.toLowerCase()}-header`} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-black px-2.5 py-1 rounded-md tracking-wider ${badgeColor}`}>
            DECK {deckId}
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base tracking-wide line-clamp-1 max-w-[320px] sm:max-w-[420px] lg:max-w-[520px] break-words" title={track ? track.title : 'No Track Loaded'}>
                {track ? track.title : 'No Track Loaded'}
              </span>
              {track?.highlightTime !== undefined && (
                <button
                  onClick={() => deck.jumpToHighlight()}
                  title={`World's Most Liked Hook at ${formatTime(track.highlightTime)}. Click to jump!`}
                  className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-all"
                >
                  <span>🔥</span>
                  <span>{formatTime(track.highlightTime)}</span>
                </button>
              )}
              {track?.musicStartTime && track.musicStartTime > 0 && (
                <span
                  title={track.introSkipReason || `Skipped initial ${formatTime(track.musicStartTime)} conversation`}
                  className="flex items-center gap-1 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold"
                >
                  <span>🗣️</span>
                  <span>{formatTime(track.musicStartTime)}</span>
                </span>
              )}
              {isStrictStartSong(track) && (
                <span
                  title="Exception: strictly plays from the starting 0:00 without skipping intro build-up"
                  className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold"
                >
                  <span>🎯</span>
                  <span>Start (0:00)</span>
                </span>
              )}
              {heardKey && keyDetails && (
                <span
                  className="flex items-center gap-1 bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0"
                  title={`Camelot: ${heardKey} (${keyDetails.musicalKey})`}
                >
                  <span>🎵</span>
                  <span>{heardKey}</span>
                  <span className="text-[9px] text-purple-200/70">({keyDetails.shortName})</span>
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400 truncate max-w-[320px] sm:max-w-[420px] lg:max-w-[520px]">
              {track ? track.artist : 'Load local MP3/WAV or Demo'}
            </span>
          </div>
        </div>

        {/* Load Local File Button */}
        <div id={`deck-${deckId.toLowerCase()}-load-file`}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="audio/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-slate-200 px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-slate-300" />
            <span>Load Track</span>
          </button>
        </div>
      </div>

      {/* Waveform & Playhead */}
      <WaveformCanvas
        id={`deck-${deckId.toLowerCase()}-waveform`}
        analyser={deck.analyserNode}
        isPlaying={state.isPlaying}
        currentTime={state.currentTime}
        duration={state.duration}
        peaks={track?.waveformPeaks}
        color={primaryColor}
        highlightTime={track?.highlightTime}
        cueInTime={track?.cueInTime}
        loop={state.loop}
        loopInTime={state.loopInTime}
        onSeek={(time) => deck.seek(time)}
      />

      {/* Deck Telemetry (BPM, Key, Time Elapsed / Remaining) */}
      <div id={`deck-${deckId.toLowerCase()}-telemetry`} className="grid grid-cols-4 gap-2 bg-black/40 p-2.5 rounded-xl border border-white/5 font-mono text-center">
        <div>
          <div className="text-[10px] text-slate-400">BPM</div>
          <div className="text-base font-bold text-white tracking-wider">
            {state.effectiveBpm.toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">KEY</div>
          <div
            className={`text-sm sm:text-base font-bold flex items-center justify-center gap-1 ${
              deckCompat
                ? deckCompat.color === 'emerald'
                  ? 'text-emerald-400'
                  : deckCompat.color === 'amber'
                  ? 'text-amber-400'
                  : deckCompat.color === 'cyan'
                  ? 'text-cyan-400'
                  : deckCompat.color === 'rose'
                  ? 'text-rose-400'
                  : 'text-cyan-400'
                : keySure
                ? 'text-cyan-400'
                : 'text-slate-500'
            }`}
            title={
              heardKey
                ? `${heardKey} (${keyDetails?.musicalKey}) ${
                    state.playbackRate !== 1.0 && !engine.keyLock
                      ? `heard at ${state.playbackRate.toFixed(2)}x (detected: ${track?.key})`
                      : ''
                  }${deckCompat ? ` • Deck ${deckId === 'A' ? 'B' : 'A'} Match: ${deckCompat.label} (${deckCompat.description})` : ''}`
                : 'Key not detected yet'
            }
          >
            <span>{heardKey ?? '—'}</span>
            {keyDetails && keyDetails.shortName !== '—' && (
              <span className="text-[10px] font-normal opacity-80">({keyDetails.shortName})</span>
            )}
            {deckCompat && deckCompat.relation !== 'usable' && (
              <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-white/10" title={deckCompat.description}>
                {deckCompat.badgeText}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">ELAPSED</div>
          <div className="text-sm font-semibold text-slate-300">
            {formatTime(state.currentTime)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">REMAINING</div>
          <div className="text-sm font-semibold text-slate-400">
            -{formatTime(Math.max(0, state.duration - state.currentTime))}
          </div>
        </div>
      </div>

      {/* Hot cues (tap an empty pad to save the spot, tap a saved one to jump) & beat loops */}
      <div id={`deck-${deckId.toLowerCase()}-cues`} className="flex items-center gap-1.5">
        {hotCues.map((cue, slot) => (
          <div key={slot} className="relative flex-1">
            <button
              id={`deck-${deckId.toLowerCase()}-cue-${slot + 1}`}
              onClick={() => engine.hotCue(deckId, slot)}
              disabled={!track}
              className={`w-full py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all disabled:opacity-40 ${
                cue !== null
                  ? isA
                    ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-100'
                    : 'bg-amber-500/25 border-amber-400/60 text-amber-100'
                  : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
              }`}
              title={cue !== null ? `Jump to ${formatTime(cue)}` : 'Save the current spot (on the beat)'}
            >
              {cue !== null ? `${slot + 1} · ${formatTime(cue)}` : `${slot + 1} · Set`}
            </button>
            {cue !== null && (
              <button
                onClick={() => engine.clearHotCue(deckId, slot)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black border border-white/20 text-[9px] leading-none text-slate-300 hover:text-red-300"
                aria-label={`Clear hot cue ${slot + 1}`}
                title="Clear"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-1 pl-1.5 border-l border-white/10">
          {/* Manual Loop Controls (Virtual DJ Style) */}
          <button
            id={`deck-${deckId.toLowerCase()}-loop-in-btn`}
            onClick={() => engine.setLoopIn(deckId)}
            disabled={!state.isPlaying}
            className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all ${
              state.loopInTime !== null && !state.loop
                ? 'bg-amber-500 text-black border-amber-400 animate-pulse'
                : state.loop
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
            title="Set Loop IN (Start) point (snaps to beat)"
          >
            IN
          </button>
          <button
            id={`deck-${deckId.toLowerCase()}-loop-out-btn`}
            onClick={() => engine.setLoopOut(deckId)}
            disabled={!state.isPlaying}
            className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all ${
              state.loop
                ? 'bg-emerald-500 text-black border-emerald-400 shadow-sm shadow-emerald-500/40'
                : state.loopInTime !== null
                ? 'bg-amber-500/20 text-amber-300 border-amber-400 animate-bounce'
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
            title={state.loop ? 'Exit loop (Click to release song)' : 'Set Loop OUT (End) point and start looping'}
          >
            OUT
          </button>
          <button
            id={`deck-${deckId.toLowerCase()}-reloop-btn`}
            onClick={() => engine.reloop(deckId)}
            disabled={!state.loop && !state.hasLastLoop}
            className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all disabled:opacity-30 ${
              state.loop
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
            title={state.loop ? 'Exit current loop' : 'Reloop (re-enter previous loop)'}
          >
            {state.loop ? 'EXIT' : 'RELOOP'}
          </button>

          {/* Quick Beat Loops */}
          {LOOP_BARS.map((bars) => (
            <button
              key={bars}
              id={`deck-${deckId.toLowerCase()}-loop-${bars}`}
              onClick={() => engine.toggleBeatLoop(deckId, bars)}
              disabled={!state.isPlaying}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all disabled:opacity-40 ${
                loopBars === bars ? 'bg-emerald-500/30 border-emerald-400 text-emerald-100 animate-pulse' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}
              title={loopBars === bars ? 'Leave the loop' : `Loop ${bars} bar${bars > 1 ? 's' : ''} from the current bar`}
              aria-pressed={loopBars === bars}
            >
              ⟲{bars}
            </button>
          ))}
        </div>
      </div>

      {/* Transport & Pitch Controls */}
      <div id={`deck-${deckId.toLowerCase()}-transport`} className="grid grid-cols-12 gap-2.5 items-center">
        {/* Play/Pause Button */}
        <button id={`deck-${deckId.toLowerCase()}-play-pause-button`}
          onClick={() => deck.togglePlay()}
          disabled={!track}
          className={`col-span-3 flex items-center justify-center gap-1.5 py-3.5 rounded-xl font-bold text-xs tracking-wide transition-all shadow-lg ${
            !track
              ? 'bg-white/5 text-slate-500 cursor-not-allowed'
              : state.isPlaying
              ? isA
                ? 'bg-cyan-500 text-black shadow-cyan-500/30'
                : 'bg-amber-500 text-black shadow-amber-500/30'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          {state.isPlaying ? (
            <>
              <Pause className="w-4 h-4 fill-current" />
              <span>PAUSE</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>PLAY</span>
            </>
          )}
        </button>

        {/* Stop Button */}
        <button id={`deck-${deckId.toLowerCase()}-stop-button`}
          onClick={() => deck.stop()}
          disabled={!track}
          title="Stop and cue to beginning"
          className="col-span-2 flex items-center justify-center gap-1 py-3.5 rounded-xl font-bold text-xs bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>STOP</span>
        </button>

        {/* Jump to Viral Hook Button */}
        <button id={`deck-${deckId.toLowerCase()}-hook-button`}
          onClick={() => deck.jumpToHighlight()}
          disabled={!track}
          title={track?.highlightTime ? `Jump to world's favorite part (${formatTime(track.highlightTime)})` : 'Jump to hook'}
          className="col-span-2 flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span className="text-xs">🔥</span>
          <span className="leading-tight">HOOK</span>
        </button>

        {/* Pitch Slider (Tempo) */}
        <div id={`deck-${deckId.toLowerCase()}-pitch-slider`} className="col-span-5 flex flex-col gap-1 bg-black/30 p-2.5 rounded-xl border border-white/5">
          <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
            <span>TEMPO / PITCH</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-200 font-bold">
                {state.playbackRate >= 1.0 ? '+' : ''}
                {(((state.playbackRate - 1.0) * 100)).toFixed(1)}%
              </span>
              <button
                onClick={resetPitch}
                title="Reset pitch to 0%"
                className="hover:text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.002"
            value={state.playbackRate}
            onChange={handlePitchChange}
            className={`w-full h-1.5 ${isA ? 'fader-a' : 'fader-b'}`}
          />
        </div>
      </div>

      {/* 3-Band Isolator EQ & Channel Volume */}
      <div id={`deck-${deckId.toLowerCase()}-eq`} className="bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col gap-2.5">
        <div className="text-[10px] font-mono font-semibold text-slate-400 tracking-wider flex items-center justify-between">
          <span>3-BAND ISOLATOR EQ & CHANNEL GAIN</span>
          <Disc3 className={`w-3.5 h-3.5 ${state.isPlaying ? 'animate-spin' : ''}`} />
        </div>

        <div className="grid grid-cols-4 gap-3 text-center">
          {/* LOW EQ */}
          <div id={`deck-${deckId.toLowerCase()}-low-eq`} className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-slate-400">LOW</span>
            <input
              type="range"
              min="-40"
              max="6"
              step="1"
              value={state.lowGain}
              onChange={(e) => deck.setEQ(parseFloat(e.target.value), state.midGain, state.highGain)}
              className="w-full h-1.5"
            />
            <button
              onClick={() => deck.setEQ(state.lowGain === -40 ? 0 : -40, state.midGain, state.highGain)}
              className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                state.lowGain <= -24 ? 'bg-red-500/80 text-white font-bold' : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {state.lowGain <= -24 ? 'KILLED' : `${Math.round(state.lowGain)}dB`}
            </button>
          </div>

          {/* MID EQ */}
          <div id={`deck-${deckId.toLowerCase()}-mid-eq`} className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-slate-400">MID</span>
            <input
              type="range"
              min="-40"
              max="6"
              step="1"
              value={state.midGain}
              onChange={(e) => deck.setEQ(state.lowGain, parseFloat(e.target.value), state.highGain)}
              className="w-full h-1.5"
            />
            <button
              onClick={() => deck.setEQ(state.lowGain, state.midGain === -40 ? 0 : -40, state.highGain)}
              className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                state.midGain <= -24 ? 'bg-red-500/80 text-white font-bold' : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {state.midGain <= -24 ? 'KILLED' : `${Math.round(state.midGain)}dB`}
            </button>
          </div>

          {/* HIGH EQ */}
          <div id={`deck-${deckId.toLowerCase()}-high-eq`} className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-slate-400">HIGH</span>
            <input
              type="range"
              min="-40"
              max="6"
              step="1"
              value={state.highGain}
              onChange={(e) => deck.setEQ(state.lowGain, state.midGain, parseFloat(e.target.value))}
              className="w-full h-1.5"
            />
            <button
              onClick={() => deck.setEQ(state.lowGain, state.midGain, state.highGain === -40 ? 0 : -40)}
              className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                state.highGain <= -24 ? 'bg-red-500/80 text-white font-bold' : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {state.highGain <= -24 ? 'KILLED' : `${Math.round(state.highGain)}dB`}
            </button>
          </div>

          {/* CHANNEL GAIN */}
          <div id={`deck-${deckId.toLowerCase()}-channel-gain`} className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-slate-400">VOL</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.volume}
              onChange={(e) => deck.setVolume(parseFloat(e.target.value))}
              className={`w-full h-1.5 ${isA ? 'fader-a' : 'fader-b'}`}
            />
            <span className="text-[9px] font-mono text-slate-400">
              {Math.round(state.volume * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
