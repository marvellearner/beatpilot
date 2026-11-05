import React from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { SearchResult } from '../../types';
import { useEngineQueue, useEngineTrack } from '../hooks/useEngineStore';
import { UpNextQueueItem, rowSignature } from './UpNextQueueItem';
import { SongSearchDropdown } from './SongSearchDropdown';
import { shiftKey } from '../../audio/KeyDetector';
import { describeFilter, type SongFilter } from '../../../shared/songFilter';
import { Music, Sparkles, RefreshCw, X } from 'lucide-react';

interface QueueManagerPanelProps {
  engine: AudioEngine;
  onToast: (msg: string) => void;
  formatTime: (secs: number) => string;
}

export const QueueManagerPanel: React.FC<QueueManagerPanelProps> = ({
  engine,
  onToast,
  formatTime,
}) => {
  const queueState = useEngineQueue(engine);
  // Song and mix state only (not the clock), so the 50 rows don't redraw every 180 ms
  const playback = useEngineTrack(engine);

  const curKey = playback.currentTrack?.key
    ? (engine.keyLock ? playback.currentTrack.key : shiftKey(playback.currentTrack.key, playback.playbackRate))
    : undefined;

  const handleSelectSong = async (song: SearchResult, autoMix: boolean = false) => {
    onToast(`${autoMix ? 'Mixing in & AI reading mood' : 'Queued at top of Up Next'}: "${song.title}"`);
    await engine.acquireTrack(song.url || `${song.title} ${song.author}`, autoMix, 'front', 'request', autoMix);
  };

  const handleSearchSubmit = async (targetQuery: string, autoMix: boolean = false) => {
    onToast(`${autoMix ? 'Mixing in & AI reading mood' : 'Queued at top of Up Next'}: "${targetQuery}"`);
    await engine.acquireTrack(targetQuery, autoMix, 'front', 'request', autoMix);
  };

  return (
    <div
      id="party-console-queue"
      className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#111625]/95 to-[#090c15]/95 shadow-xl flex flex-col gap-2.5"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/25 to-purple-500/25 border border-cyan-500/30 flex items-center justify-center shadow-sm">
            <Music className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-black text-xs text-white tracking-wide">
                UP NEXT QUEUE
              </h3>
              <span className="font-mono text-[9px] font-extrabold px-1.5 py-0.2 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                {queueState.queueLength}
              </span>
            </div>
            <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5 pt-0.5">
              <span className="text-emerald-400 font-bold">{queueState.readyCount} ready</span>
              <span>•</span>
              <span className="text-amber-300 font-medium">~{queueState.queueDurationStr} flow</span>
              {queueState.diskCacheCount > 0 && (
                <>
                  <span>•</span>
                  <span
                    className="text-cyan-400"
                    title={`Audio saved to disk at cache/audio: ${queueState.diskCacheCount} songs (~${engine.diskCacheMb} MB)`}
                  >
                    💾 {queueState.diskCacheCount} disk
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {queueState.queueLength > 1 && (
            <button
              id="party-console-sort-harmonic-btn"
              type="button"
              onClick={() => {
                const count = engine.sortQueueHarmonically();
                if (count > 0) {
                  onToast(`🪄 Sorted ${count} songs into harmonic Camelot flow!`);
                }
              }}
              className="px-2.5 py-1 rounded-xl text-[10px] font-extrabold font-mono bg-gradient-to-r from-purple-500/25 via-indigo-500/25 to-pink-500/25 hover:from-purple-500/40 hover:to-indigo-500/40 text-purple-200 border border-purple-500/40 hover:border-purple-300 transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
              title="Sort by key: reorder Up Next with the Camelot wheel so each song's key fits the next (no clashes)"
            >
              <Sparkles className="w-3 h-3 text-purple-300 animate-pulse" />
              <span>Sort by key</span>
            </button>
          )}
          <button
            id="party-console-refresh-queue-btn"
            type="button"
            onClick={() => void engine.refreshQueue()}
            disabled={engine.refreshingQueue}
            className="px-2.5 py-1 rounded-xl text-[10px] font-extrabold font-mono bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
            title="Refresh Up Next: new picks from the song playing, your taste and the mood. Keeps songs you added and the next 3."
          >
            <RefreshCw className={`w-3 h-3 ${engine.refreshingQueue ? 'animate-spin' : ''}`} />
            <span>{engine.refreshingQueue ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* "Play only / more <artist>" from the AI chat */}
      {engine.artistFocus && (
        <div
          id="party-console-artist-focus"
          className="flex items-center justify-between gap-2 text-[11px] bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg px-2.5 py-1.5"
        >
          <span className="text-fuchsia-100 truncate">
            <span className="font-bold">{engine.describeAiInstructions().join(' · ')}</span>
          </span>
          <button
            type="button"
            onClick={() => engine.clearArtistFocus()}
            className="p-0.5 rounded text-fuchsia-200 hover:text-white hover:bg-white/10 shrink-0"
            title="Back to normal: play all your music"
            aria-label="Clear artist filter"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Embedded Search Dropdown */}
      <SongSearchDropdown
        onSelectSong={handleSelectSong}
        onSearchSubmit={handleSearchSubmit}
        formatTime={formatTime}
        onApplyFilter={(filter: SongFilter) => {
          engine.setSongFilter(filter);
          onToast(`✨ AI Filter Activated: ${describeFilter(filter)}`);
        }}
      />

      {/* Scrollable Queue List */}
      <div
        id="party-console-queue-list"
        className="flex flex-col gap-2 max-h-[490px] overflow-y-auto pr-2 py-0.5 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-cyan-500/30 scrollbar-track-transparent"
      >
        {queueState.queueLength === 0 ? (
          <div
            id="party-console-queue-empty"
            className="text-center py-10 px-4 rounded-xl bg-black/30 border border-dashed border-white/10 flex flex-col items-center gap-2"
          >
            <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Music className="w-5 h-5 text-cyan-400/60" />
            </div>
            <span className="text-xs font-bold text-slate-300">Queue is empty</span>
            <span className="text-[11px] text-slate-500 max-w-[220px]">
              Search a track above or play any starter song — the AI will curate 50 bangers automatically!
            </span>
          </div>
        ) : (
          queueState.queue
            .filter((item) => item.id !== playback.currentTrack?.id)
            .map((item, idx) => (
              <UpNextQueueItem
                key={item.id}
                engine={engine}
                item={item}
                idx={idx}
                curKey={curKey}
                pendingMixId={queueState.pendingMix?.id}
                sig={rowSignature(engine, item, idx)}
              />
            ))
        )}
      </div>

      {/* Queue Footer Info Strip */}
      {queueState.queueLength > 0 && (
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-2 border-t border-white/10 px-1 shrink-0 bg-black/20 rounded-b-xl">
          <div className="flex items-center gap-1.5 text-slate-300 text-[9px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-bold">{queueState.queueLength} songs loaded</span>
            <span className="text-slate-500">(~{queueState.queueDurationStr} party flow)</span>
          </div>
          <span className="text-[9px] text-slate-500 flex items-center gap-1">
            <span>↕ Auto-curating</span>
            <span className="text-cyan-400 font-bold">50 target</span>
          </span>
        </div>
      )}
    </div>
  );
};

