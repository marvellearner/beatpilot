import React, { useRef } from 'react';
import { VirtualDeck } from '../../audio/VirtualDeck';
import { DeckId } from '../../types';
import { WaveformCanvas } from './WaveformCanvas';
import { Play, Pause, FolderPlus, Disc3, RotateCcw, Square } from 'lucide-react';

interface DeckViewProps {
  deck: VirtualDeck;
  deckId: DeckId;
}

export const DeckView: React.FC<DeckViewProps> = ({ deck, deckId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = deck.getPlaybackState();
  const track = state.track;

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
              <span className="font-bold text-white text-base tracking-wide truncate max-w-[170px]">
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
            </div>
            <span className="text-xs text-slate-400 truncate max-w-[220px]">
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
          <div className="text-base font-bold text-cyan-400">
            {track?.key || '8A'}
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
