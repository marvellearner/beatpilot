import React, { useState } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { useEngineBangers } from '../hooks/useEngineStore';
import { Heart, Star, ThumbsDown, Music, Plus, Play, X } from 'lucide-react';

interface BangersPanelProps {
  engine: AudioEngine;
  onToast?: (msg: string) => void;
}

export const BangersPanel: React.FC<BangersPanelProps> = ({ engine, onToast }) => {
  const [bangersTab, setBangersTab] = useState<'favorites' | 'most_played' | 'banned'>('favorites');
  const { favorites, mostPlayed, banned } = useEngineBangers(engine);

  return (
    <div
      id="party-console-most-played"
      className="dj-panel rounded-2xl p-3.5 border border-white/10 bg-gradient-to-b from-[#131926]/95 to-[#0b0e17]/95 shadow-xl flex flex-col gap-2"
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
        {/* Tab Selector */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setBangersTab('favorites')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              bangersTab === 'favorites'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Heart className={`w-3 h-3 ${favorites.length > 0 ? 'fill-rose-500 text-rose-500' : ''}`} />
            <span>Favourites</span>
            <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
              {favorites.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setBangersTab('most_played')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              bangersTab === 'most_played'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span>Most Played</span>
            <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
              {mostPlayed.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setBangersTab('banned')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              bangersTab === 'banned'
                ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Songs saved in Don't Play Again Ever"
          >
            <ThumbsDown className="w-3 h-3 text-red-400" />
            <span>Don&apos;t Play</span>
            <span className="text-[9px] font-mono font-bold bg-white/10 px-1 rounded">
              {banned.length}
            </span>
          </button>
        </div>

        <span className="text-[10px] text-slate-400 hidden sm:inline">1-Click Play</span>
      </div>

      {/* Favourites Tab View */}
      {bangersTab === 'favorites' ? (
        <div id="party-console-favorites-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
          {favorites.length === 0 ? (
            <div id="party-console-favorites-empty" className="text-center py-6 px-3 flex flex-col items-center gap-2 text-slate-500">
              <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400/80">
                <Heart className="w-5 h-5" />
              </div>
              <p className="text-[11px] font-medium leading-relaxed">
                No favourites saved yet.<br />
                Click the <span className="text-rose-400 font-bold">❤️ heart</span> on any song image to save it here!
              </p>
            </div>
          ) : (
            favorites.map((song) => (
              <div
                id={`party-console-favorite-item-${song.id}`}
                key={song.id}
                className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-rose-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 group/favthumb">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-rose-950 to-slate-900">
                        <Music className="w-3.5 h-3.5 text-rose-400" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        engine.toggleFavorite(song);
                      }}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity opacity-0 group-hover/favthumb:opacity-100"
                      title="Remove from Favourites"
                    >
                      <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                    </button>
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-rose-300 transition-colors" title={song.title}>
                      {song.title}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="truncate">{song.artist}</span>
                      {song.bpm && (
                        <span className="font-mono text-cyan-300/90 font-bold shrink-0">
                          {Math.round(song.bpm)} BPM
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      engine.acquireTrack(song.url || `${song.title} ${song.artist}`, false, 'front');
                      onToast?.(`Queued "${song.title}" at top of Up Next`);
                    }}
                    className="p-1 hover:bg-white/10 text-slate-400 hover:text-cyan-300 rounded-lg text-[10px] font-bold transition-all"
                    title="Add to top of Up Next Queue"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => engine.playStarterSong(song.id)}
                    className="py-1 px-2.5 bg-gradient-to-r from-rose-500/20 to-orange-500/20 hover:from-rose-500 hover:to-orange-500 text-rose-300 hover:text-black border border-rose-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                    title="Start playing now"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>Play</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : bangersTab === 'most_played' ? (
        /* Top Bangers Tab View */
        <div id="party-console-most-played-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
          {mostPlayed.length === 0 ? (
            <div id="party-console-most-played-empty" className="text-center py-6 text-[11px] text-slate-500 font-medium">
              {engine.rawMostPlayedSongsList.length > 0
                ? 'All top bangers are currently queued or already played.'
                : 'No play history yet. Play songs to see your top party bangers here!'}
            </div>
          ) : (
            mostPlayed.map((song) => (
              <div
                id={`party-console-most-played-item-${song.id}`}
                key={song.id}
                className="group bg-black/40 hover:bg-black/60 border border-white/10 hover:border-amber-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10 group/bangerthumb">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-purple-900 to-indigo-900">
                        <Music className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        engine.toggleFavorite(song);
                      }}
                      className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                        engine.isFavorite(song) ? 'opacity-100 bg-black/40' : 'opacity-0 group-hover/bangerthumb:opacity-100'
                      }`}
                      title={engine.isFavorite(song) ? 'Saved in Favourites' : 'Save to Favourites'}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 transition-transform ${
                          engine.isFavorite(song) ? 'fill-rose-500 text-rose-500' : 'text-white hover:text-rose-400'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-amber-300 transition-colors" title={song.title}>
                      {song.title}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="truncate">{song.artist}</span>
                      <span className="font-mono text-amber-400/90 font-bold shrink-0">
                        ⭐ {song.playCount}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => engine.playStarterSong(song.id)}
                  className="py-1 px-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500 hover:to-orange-500 text-amber-300 hover:text-black border border-amber-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 shadow-sm"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Play</span>
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Don't Play Again Ever Tab View */
        <div id="party-console-banned-list" className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
          {banned.length === 0 ? (
            <div id="party-console-banned-empty" className="text-center py-6 px-3 flex flex-col items-center gap-2 text-slate-500">
              <div className="p-2.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400/80">
                <ThumbsDown className="w-5 h-5" />
              </div>
              <p className="text-[11px] font-medium leading-relaxed">
                No blocked songs.<br />
                Click the <span className="text-red-400 font-bold">👎 thumbs down</span> on any song to permanently block it from playing!
              </p>
            </div>
          ) : (
            banned.map((song) => (
              <div
                id={`party-console-banned-item-${song.id}`}
                key={song.id}
                className="group bg-black/40 hover:bg-black/60 border border-red-500/20 hover:border-red-400/40 rounded-xl p-2 flex items-center justify-between gap-2.5 transition-all shadow-sm shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-red-950 to-slate-900">
                        <Music className="w-3.5 h-3.5 text-red-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-white line-clamp-2 leading-snug break-words group-hover:text-red-300 transition-colors" title={song.title}>
                      {song.title}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate">{song.artist}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => engine.toggleDontPlayAgain(song)}
                  className="py-1 px-2.5 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white border border-red-500/40 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 shadow-sm"
                  title="Remove from Don't Play Again Ever (Unblock)"
                >
                  <X className="w-2.5 h-2.5" />
                  <span>Unblock</span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
