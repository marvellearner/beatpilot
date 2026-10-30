/**
 * One song in the party console's Up Next list: the #1 "on deck" hero card, or a compact row
 * for #2 onwards, with harmonic-key, BPM and status badges and the mix / move / dislike / remove
 * actions.
 */
import React from 'react';
import { ArrowUp, Heart, Music, ThumbsDown, X, Zap } from 'lucide-react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { getCamelotDetails, getHarmonicCompatibility } from '../../audio/KeyDetector';
import type { QueuedTrack } from '../../types';
import { timeAgo } from './PreviouslyPlayedPanel';

interface UpNextQueueItemProps {
  engine: AudioEngine;
  item: QueuedTrack;
  idx: number; // position in the queue, 0 = on deck
  curKey?: string; // the on-air song's key as heard (after any tempo shift)
  pendingMixId?: string; // the song a planned mix is waiting to bring in
}

export const UpNextQueueItem: React.FC<UpNextQueueItemProps> = ({ engine, item, idx, curKey, pendingMixId }) => {
  // Mix works on any song that hasn't failed: a ready one mixes, others stream or load first
  const canMix = item.status !== 'failed';
  const planned = pendingMixId === item.id;
  const loading = engine.mixLoadingId === item.id;
  const mixTitle = planned
    ? 'Mix planned at the best point — click to mix right now'
    : loading
      ? 'Loading this song — it mixes in as soon as it is ready'
      : item.status === 'ready'
        ? 'Mix into this song at the best point in the next 45 s'
        : 'Not downloaded yet: plays straight away if nothing is on air, else mixes in once loaded';
  const keyDetails = item.key ? getCamelotDetails(item.key) : null;
  const compat = (curKey && item.key) ? getHarmonicCompatibility(curKey, item.key) : null;
  const colorClass = compat
    ? compat.color === 'emerald'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : compat.color === 'amber'
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      : compat.color === 'cyan'
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
      : compat.color === 'teal'
      ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
      : compat.color === 'purple'
      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
      : compat.color === 'rose'
      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
      : 'bg-white/10 text-slate-300 border-white/10'
    : 'bg-purple-500/15 text-purple-300 border-purple-500/25';

  if (idx === 0) {
    // #1 ON-DECK / UP NEXT HERO CARD (Spacious 2-tier layout, 50+ chars title upfront)
    return (
      <div
        id={`party-console-queue-item-${item.id}`}
        className="group/qhero relative shrink-0 overflow-hidden rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 via-[#0e1526]/90 to-[#0b0f1a]/95 p-3 shadow-lg shadow-cyan-950/40 hover:border-cyan-400/60 transition-all flex flex-col gap-2 ring-1 ring-cyan-500/20"
      >
        {/* Top Status Strip */}
        <div className="flex items-center justify-between gap-2 text-[9px] font-mono flex-wrap">
          <div className="flex items-center gap-1.5 font-extrabold uppercase tracking-wider shrink-0 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
            </span>
            <span className="bg-gradient-to-r from-cyan-300 via-teal-200 to-cyan-400 bg-clip-text text-transparent font-black tracking-wide whitespace-nowrap shrink-0 inline-block py-0.5 leading-tight">
              #1 ON DECK • UP NEXT
            </span>
            {item.isAiRecommended && (
              <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 py-0.2 rounded font-bold text-[8px] whitespace-nowrap shrink-0">
                AI PICK
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {item.isDiskCached && (
              <span
                className="text-[8px] font-mono text-cyan-300 bg-cyan-500/15 border border-cyan-500/25 px-1 py-0.5 rounded font-bold whitespace-nowrap shrink-0"
                title="Audio saved on laptop disk in cache/audio"
              >
                💾 DISK
              </span>
            )}
            <span
              className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-black tracking-wide whitespace-nowrap shrink-0 ${
                item.status === 'ready'
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                  : item.status === 'failed'
                  ? 'bg-red-500/25 text-red-300 border border-red-500/40'
                  : 'bg-yellow-500/25 text-yellow-300 border border-yellow-500/40 animate-pulse'
              }`}
            >
              {item.status === 'ready' ? 'READY TO MIX' : item.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Main Row: Thumbnail + Full Width 2-line wrapped Title (50+ chars visible upfront) */}
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-cyan-500/30 group/hthumb shadow-md bg-slate-900 mt-0.5">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-800">
                <Music className="w-4 h-4 text-cyan-400" />
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                engine.toggleFavorite(item);
              }}
              className={`absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity ${
                engine.isFavorite(item) ? 'opacity-100 bg-black/40' : 'opacity-0 group-hover/hthumb:opacity-100'
              }`}
              title={engine.isFavorite(item) ? 'Saved in Favourites' : 'Save to Favourites'}
            >
              <Heart
                className={`w-4 h-4 transition-transform ${
                  engine.isFavorite(item) ? 'fill-rose-500 text-rose-500 scale-110' : 'text-white hover:text-rose-400'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            {/* 2-line title wrap: at least 50-80 chars fully visible upfront! */}
            <span
              className="font-extrabold text-white text-[12.5px] leading-snug line-clamp-2 break-words group-hover/qhero:text-cyan-200 transition-colors"
              title={item.title}
            >
              {item.title}
            </span>
            <span className="text-[10.5px] text-slate-300 font-medium truncate pt-0.5">
              {item.artist}
            </span>
          </div>
        </div>

        {/* Bottom Row: Metadata Badges + Actions Strip */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/10 flex-wrap sm:flex-nowrap min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap text-[10px] min-w-0 flex-1">
            {/* Camelot Badge */}
            {item.key && keyDetails && (
              <span
                className={`inline-flex items-center gap-1 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 transition-colors shadow-sm whitespace-nowrap ${colorClass}`}
                title={compat ? `${item.key} (${keyDetails.musicalKey}) • ${compat.description}` : `Key: ${item.key}`}
              >
                <span>{item.key}</span>
                <span className="opacity-75">{keyDetails.shortName}</span>
                {compat && compat.relation !== 'usable' && (
                  <span className="font-black ml-0.5">{compat.badgeText}</span>
                )}
              </span>
            )}

            {/* BPM */}
            {item.bpm !== undefined && item.bpmConfidence !== undefined && (
              <span className="font-mono text-slate-300 shrink-0 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 text-[9px] whitespace-nowrap">
                {Math.round(item.bpm)} BPM
                {item.tempoLockedTo !== undefined && item.original && (
                  <span className="text-emerald-300 ml-0.5" title={`Tuned from ${Math.round(item.original.bpm)} BPM`}>
                    🔒
                  </span>
                )}
              </span>
            )}

            {engine.topSongAvoidCount > 0 && (
              <span
                className="text-[8px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 py-0.5 rounded shrink-0 animate-pulse whitespace-nowrap"
                title={`Avoided ${engine.topSongAvoidCount}/7 times.`}
              >
                ⚠️ Skipped {engine.topSongAvoidCount}/7
              </span>
            )}

            {item.lastPlayedAt !== undefined && (
              <span className="text-violet-300 shrink-0 text-[8.5px] whitespace-nowrap">
                🔁 played {timeAgo(item.lastPlayedAt)}
              </span>
            )}
          </div>

          {/* Hero Actions */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {canMix && (
              <button
                onClick={() => engine.mixQueuedTrack(item.id)}
                disabled={engine.isTransitioning || loading}
                className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0 ${
                  planned || loading
                    ? 'bg-gradient-to-r from-cyan-400 to-teal-300 text-black shadow-cyan-400/50 animate-pulse'
                    : 'bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-black shadow-cyan-500/25'
                }`}
                title={mixTitle}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{planned ? 'PLANNED ✓' : loading ? 'LOADING…' : 'MIX NOW'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => engine.toggleDontPlayAgain(item)}
              className="text-slate-500 hover:text-red-400 p-1 rounded-lg hover:bg-white/5 transition-all shrink-0"
              title="Don't play again ever (Dislike)"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => engine.removeFromQueue(item.id)}
              className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors shrink-0"
              title="Remove from queue"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // #2 to #50 SUBSEQUENT TRACKS (Spacious 2-tier layout, at least 50+ chars title upfront)
  return (
    <div
      id={`party-console-queue-item-${item.id}`}
      className="group/qitem shrink-0 p-2.5 rounded-xl bg-black/40 hover:bg-[#121827]/90 border border-white/5 hover:border-white/15 flex flex-col gap-1.5 text-xs transition-all"
    >
      {/* Top Row: Rank + Thumb + Full-Width Title (Zero right-side competition, 50-80+ chars visible upfront) */}
      <div className="flex items-start gap-2.5 min-w-0 w-full">
        <span className="font-mono text-[10px] font-bold text-slate-500 w-4 text-center shrink-0 pt-0.5">
          #{idx + 1}
        </span>
        <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 group/qthumb border border-white/10 bg-slate-900 mt-0.5">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-slate-800 flex items-center justify-center">
              <Music className="w-3.5 h-3.5 text-slate-400" />
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              engine.toggleFavorite(item);
            }}
            className={`absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity ${
              engine.isFavorite(item) ? 'opacity-100 bg-black/40' : 'opacity-0 group-hover/qthumb:opacity-100'
            }`}
            title={engine.isFavorite(item) ? 'Saved in Favourites' : 'Save to Favourites'}
          >
            <Heart
              className={`w-3.5 h-3.5 transition-transform ${
                engine.isFavorite(item) ? 'fill-rose-500 text-rose-500 scale-110' : 'text-white hover:text-rose-400'
              }`}
            />
          </button>
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          {/* Full-width 2-line title wrap: easily displays 50-80+ characters upfront! */}
          <span
            className="font-bold text-white text-[12px] leading-snug line-clamp-2 break-words group-hover/qitem:text-cyan-300 transition-colors"
            title={item.title}
          >
            {item.title}
          </span>
          <span className="text-[10px] text-slate-400 font-medium truncate pt-0.5">
            {item.artist}
          </span>
        </div>
      </div>

      {/* Sub-row: Telemetry Badges on left + Action Triggers on right - zero competition with title */}
      <div className="flex items-center justify-between text-[9px] pl-6 pt-1.5 border-t border-white/[0.06] gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Camelot Badge */}
          {item.key && keyDetails && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-[8px] font-bold px-1.5 py-0.5 rounded border shrink-0 transition-colors ${colorClass}`}
              title={compat ? `${item.key} (${keyDetails.musicalKey}) • ${compat.description}` : `Key: ${item.key} (${keyDetails.musicalKey})`}
            >
              <span>{item.key}</span>
              <span className="opacity-75">{keyDetails.shortName}</span>
              {compat && compat.relation !== 'usable' && (
                <span className="font-extrabold ml-0.5">{compat.badgeText}</span>
              )}
            </span>
          )}

          {/* BPM */}
          {item.bpm !== undefined && item.bpmConfidence !== undefined && (
            <span className="font-mono text-slate-300 bg-white/5 px-1 py-0.5 rounded border border-white/5 shrink-0 text-[8.5px]">
              {Math.round(item.bpm)} BPM
              {item.tempoLockedTo !== undefined && item.original && (
                <span className="text-emerald-300 ml-0.5" title={`Tuned from ${Math.round(item.original.bpm)} BPM, key-locked`}>
                  🔒
                </span>
              )}
            </span>
          )}

          {item.isDiskCached && (
            <span
              className="text-[8px] font-mono text-cyan-300 bg-cyan-500/15 border border-cyan-500/25 px-1 py-0.5 rounded font-bold"
              title="Audio saved on laptop disk in cache/audio"
            >
              DISK
            </span>
          )}

          {item.isAiRecommended && (
            <span className="text-[7.5px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 py-0.2 rounded shrink-0 font-bold">
              AI
            </span>
          )}

          {/* Status Pill */}
          <span
            className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-bold shrink-0 ${
              item.status === 'ready'
                ? 'bg-emerald-500/20 text-emerald-300'
                : item.status === 'failed'
                ? 'bg-red-500/20 text-red-300'
                : 'bg-yellow-500/20 text-yellow-300 animate-pulse'
            }`}
          >
            {item.status.toUpperCase()}
          </span>

          {item.lastPlayedAt !== undefined && (
            <span className="text-violet-300 shrink-0 text-[8px]">
              • 🔁 {timeAgo(item.lastPlayedAt)}
            </span>
          )}
        </div>

        {/* Quick Actions on bottom-right */}
        <div className="flex items-center gap-1 shrink-0">
          {canMix && (
            <button
              onClick={() => engine.mixQueuedTrack(item.id)}
              disabled={engine.isTransitioning || loading}
              className={`text-[9px] font-bold px-2 py-0.5 rounded transition-all disabled:opacity-40 cursor-pointer ${
                planned || loading
                  ? 'text-cyan-950 bg-cyan-400 hover:bg-cyan-300 font-extrabold animate-pulse'
                  : 'text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/30'
              }`}
              title={mixTitle}
            >
              {planned ? 'PLANNED ✓' : loading ? 'LOADING…' : 'MIX'}
            </button>
          )}

          {/* Play Next / Move To Top Button */}
          <button
            type="button"
            onClick={() => engine.moveQueueItem(item.id, 'top')}
            className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-all"
            title="Play Next (Move to #1 on deck)"
          >
            <ArrowUp className="w-3 h-3" />
          </button>

          {/* Dislike */}
          <button
            type="button"
            onClick={() => engine.toggleDontPlayAgain(item)}
            className="text-slate-400 hover:text-red-400 hover:bg-white/10 p-1 rounded transition-all"
            title="Don't play again ever (Thumbs Down)"
          >
            <ThumbsDown className="w-3 h-3" />
          </button>

          {/* Remove */}
          <button
            onClick={() => engine.removeFromQueue(item.id)}
            className="text-slate-400 hover:text-white hover:bg-white/10 p-1 rounded transition-colors"
            title="Remove from queue"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
