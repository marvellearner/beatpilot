import React from 'react';
import { Heart, History, Music, Plus, Zap } from 'lucide-react';
import { PlayLogEntry } from '../../types';
import { areSongsConsecutivelySame, songKeys, isSameSong } from '../../audio/songMatch';

interface PreviouslyPlayedPanelProps {
  entries: PlayLogEntry[]; // newest first
  onMix: (entry: PlayLogEntry) => void; // play it now, or mix into it if a song is on air
  onQueue?: (entry: PlayLogEntry) => void; // add to Up Next queue
  favorites?: { title?: string; url?: string }[]; // to show which songs are already saved
  onFavorite?: (entry: PlayLogEntry) => void; // save to / remove from Favourites
  onClearHistory?: () => void; // wipe history & reset repeat blocks
  compact?: boolean;
}

/** Same matching as the Favourites list (SongLibrary.isFavorite): the link, else the title. */
function isSaved(entry: PlayLogEntry, favorites: { title?: string; url?: string }[]): boolean {
  const title = entry.title.trim().toLowerCase();
  return favorites.some((f) => (entry.url && f.url === entry.url) || (!!f.title && f.title.trim().toLowerCase() === title));
}

const NO_REPEAT_MS = 3 * 60 * 60 * 1000; // Up Next skips songs played this recently (AudioEngine REPLAY_GAP_MS)

/** "just now", "12 min ago", "2 h ago", "yesterday", "3 days ago" */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Songs that played recently, newest first. Songs from the last 3 hours won't be auto-queued again. */
const PreviouslyPlayedPanelView: React.FC<PreviouslyPlayedPanelProps> = ({
  entries,
  onMix,
  onQueue,
  favorites = [],
  onFavorite,
  onClearHistory,
  compact,
}) => {
  const now = Date.now();

  // RULE: In previously played no 2 consecutive songs can be same
  const displayEntries = React.useMemo(() => {
    const list: PlayLogEntry[] = [];
    for (const entry of entries) {
      if (!entry) continue;
      if (
        list.length === 0 ||
        (!areSongsConsecutivelySame(entry, list[list.length - 1]) &&
         !isSameSong(songKeys(entry), songKeys(list[list.length - 1])))
      ) {
        list.push(entry);
      }
    }
    return list;
  }, [entries]);

  const inNoRepeatWindow = displayEntries.filter((e) => now - e.playedAt < NO_REPEAT_MS).length;

  return (
    <div
      id="previously-played"
      className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#15131f]/95 to-[#0c0b14]/95 shadow-xl flex flex-col gap-2"
    >
      <div id="previously-played-header" className="flex items-center justify-between pb-1.5 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-violet-400" />
          <h3 className="font-extrabold text-xs text-white tracking-wide">PREVIOUSLY PLAYED</h3>
          <span className="text-[9px] font-mono text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/20">
            {displayEntries.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {inNoRepeatWindow > 0 && (
            <span className="text-[10px] text-slate-400" title="Songs played in the last 3 hours aren't added to Up Next automatically">
              {inNoRepeatWindow} in 3h
            </span>
          )}
          {onClearHistory && displayEntries.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-[10px] font-bold text-rose-300 hover:text-white bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
              title="Wipe previous plays and reset 3-hour repeat prevention"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {displayEntries.length === 0 ? (
        <div id="previously-played-empty" className="text-center py-4 text-[11px] text-slate-500">
          Nothing played yet. Songs appear here as they finish mixing in.
        </div>
      ) : (
        <div id="previously-played-list" className={`flex flex-col gap-1.5 overflow-y-auto pr-1 ${compact ? 'max-h-56' : 'max-h-[200px]'}`}>
          {displayEntries.map((entry) => {
            const recent = now - entry.playedAt < NO_REPEAT_MS;
            return (
              <div
                id={`previously-played-item-${entry.id}-${entry.playedAt}`}
                key={`${entry.id}-${entry.playedAt}`}
                className="p-1.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {entry.thumbnail ? (
                    <img src={entry.thumbnail} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 opacity-80" />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                      <Music className="w-3 h-3 text-slate-400" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-bold text-slate-200 text-[11px] line-clamp-2 leading-snug break-words" title={entry.title}>
                      {entry.title}
                    </span>
                    <span className="text-[9px] text-slate-400 truncate pt-0.5">
                      {entry.artist} ·{' '}
                      <span className={recent ? 'text-violet-300' : 'text-slate-500'}>{timeAgo(entry.playedAt, now)}</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onFavorite && (() => {
                    const saved = isSaved(entry, favorites);
                    return (
                      <button
                        id={`previously-played-fav-${entry.id}-${entry.playedAt}`}
                        type="button"
                        onClick={() => onFavorite(entry)}
                        aria-pressed={saved}
                        className={`shrink-0 p-1 rounded border transition-colors ${
                          saved
                            ? 'text-rose-400 bg-rose-500/15 border-rose-500/30 hover:bg-rose-500/25'
                            : 'text-slate-400 hover:text-rose-300 bg-white/5 hover:bg-white/15 border-white/10'
                        }`}
                        title={saved ? 'Saved in Favourites (click to remove)' : 'Save to Favourites'}
                      >
                        <Heart className={`w-3 h-3 ${saved ? 'fill-current' : ''}`} />
                      </button>
                    );
                  })()}
                  {onQueue && (
                    <button
                      id={`previously-played-queue-${entry.id}-${entry.playedAt}`}
                      type="button"
                      onClick={() => onQueue(entry)}
                      className="shrink-0 flex items-center gap-1 text-[9px] font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 px-1.5 py-0.5 rounded transition-colors"
                      title={recent ? 'Played within the last 3 hours — add to Up Next anyway' : 'Add to Up Next queue'}
                    >
                      <Plus className="w-3 h-3" />
                      Queue
                    </button>
                  )}
                  <button
                    id={`previously-played-mix-${entry.id}-${entry.playedAt}`}
                    type="button"
                    onClick={() => onMix(entry)}
                    className="shrink-0 flex items-center gap-1 text-[9px] font-bold text-cyan-300 hover:text-black bg-cyan-500/15 hover:bg-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded transition-colors"
                    title={recent ? 'Played within the last 3 hours — mix into it anyway' : 'Mix into this song now'}
                  >
                    <Zap className="w-3 h-3" />
                    Mix
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Redraws only when its songs or handler change (the phone gets live updates several times a second). */
export const PreviouslyPlayedPanel = React.memo(PreviouslyPlayedPanelView);
