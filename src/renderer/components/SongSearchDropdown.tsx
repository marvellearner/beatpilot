import React, { useState, useEffect, useRef } from 'react';
import { SearchResult } from '../../types';
import { Search, Loader2, X, Plus, Play, Sparkles, Music, SlidersHorizontal } from 'lucide-react';
import { parseNlpSearchQuery, describeFilter, fitsFilter, type NlpSearchIntent, type SongFilter } from '../../../shared/songFilter';
import { MAX_AUTO_SONG_SECONDS } from '../../../shared/taste';
import { parseSongCommand } from '../../ai/DJAgent';

/**
 * The search's intent, plus "play only X & Y" / "just X" / "X only" / "sirf X" for ANY names: the
 * search parser knows "only" for its built-in artists only, so "Play nusrat fatah ali khan & sagar
 * wali qawali only" was read as one song title. The AI command bar's parser reads it as a filter.
 */
function readSearchIntent(q: string, base?: NlpSearchIntent | null): NlpSearchIntent | null {
  const intent = base ?? parseNlpSearchQuery(q);
  if (!intent.filter) {
    const cmd = parseSongCommand(q);
    const qc = cmd?.action === 'queue_control' ? cmd.queue : undefined;
    if (qc?.only && (qc.focus_artists?.length || qc.vibe || qc.language || qc.era)) {
      const filter: SongFilter = {
        artists: qc.focus_artists ?? [],
        only: true,
        ...(qc.vibe && { vibe: qc.vibe }),
        ...(qc.language && { language: qc.language }),
        ...(qc.era && { era: qc.era }),
      } as SongFilter;
      return { ...intent, isNlp: true, intentType: 'artist_vibe', artists: filter.artists, only: true, filter, badgeLabel: describeFilter(filter) };
    }
  }
  return intent.isNlp ? intent : null;
}

interface SongSearchDropdownProps {
  onSelectSong: (song: SearchResult, autoMix: boolean) => void;
  onSearchSubmit: (query: string, autoMix: boolean) => void;
  formatTime: (secs: number) => string;
  onApplyFilter?: (filter: SongFilter) => void;
}

export const SongSearchDropdown: React.FC<SongSearchDropdownProps> = ({
  onSelectSong,
  onSearchSubmit,
  formatTime,
  onApplyFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [detectedNlp, setDetectedNlp] = useState<NlpSearchIntent | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  // Lazy load pagination
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchPageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  // Debounced search query listener for opening matching songs dropdown
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setDetectedNlp(null);
      setIsSearching(false);
      setIsDropdownOpen(false);
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
        searchAbortControllerRef.current = null;
      }
      return;
    }

    // Immediately parse NLP intent client-side for zero latency visual feedback
    setDetectedNlp(readSearchIntent(q));

    setIsDropdownOpen(true);
    setIsSearching(true);
    searchPageRef.current = 1;
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
    setSearchHasMore(false);

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    searchAbortControllerRef.current = abortCtrl;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`, {
          signal: abortCtrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results)) {
            setSearchResults(data.results);
            setSearchHasMore(!!data.hasMore);
          }
          if (data.nlp) {
            setDetectedNlp(readSearchIntent(q, data.nlp));
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Error fetching search matches:', err);
        }
      } finally {
        if (!abortCtrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Next page of current search
  const loadMoreResults = async () => {
    const q = searchQuery.trim();
    if (loadingMoreRef.current || !searchHasMore || isSearching || q.length < 2) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const signal = searchAbortControllerRef.current?.signal;
    const page = searchPageRef.current + 1;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`, { signal });
      const data = res.ok ? await res.json() : null;
      if (signal?.aborted) return;
      const more: SearchResult[] = Array.isArray(data?.results) ? data.results : [];
      searchPageRef.current = page;
      const seen = new Set(searchResults.map((s) => s.url));
      const fresh = more.filter((s) => s.url && !seen.has(s.url));
      setSearchResults((prev) => [...prev, ...fresh]);
      setSearchHasMore(!!data?.hasMore && fresh.length > 0);
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') setSearchHasMore(false);
    } finally {
      if (!signal?.aborted) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSong = (song: SearchResult, autoMix: boolean = false) => {
    // If user clicked a song while an explicit "only <artist>" or vibe filter was parsed, activate it
    if (detectedNlp?.filter && onApplyFilter && detectedNlp.only) {
      onApplyFilter(detectedNlp.filter);
    }
    setSearchQuery('');
    setSearchResults([]);
    setDetectedNlp(null);
    onSelectSong(song, autoMix);
  };

  const handleSubmit = (e: React.FormEvent, autoMix: boolean = false) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // If an NLP filter was recognized (e.g. "only diljit dosanjh" or "play romantic bollywood songs") and no track in list
    if (detectedNlp?.filter && onApplyFilter && searchResults.length === 0) {
      onApplyFilter(detectedNlp.filter);
      setIsDropdownOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      setDetectedNlp(null);
      return;
    }

    // "Play only …": the filter is the request. Start with the first result that fits it and isn't a
    // long mix (the top hit was a 45-minute full show); none: the filter alone fills Up Next
    const onlyFilter = detectedNlp?.only && detectedNlp.filter ? detectedNlp.filter : null;
    const topMatch = onlyFilter
      ? searchResults.find((r) => fitsFilter(onlyFilter, { title: r.title, author: r.author }) && (!r.duration || r.duration <= MAX_AUTO_SONG_SECONDS))
      : searchResults[0];
    const targetQuery = topMatch ? topMatch.url : onlyFilter ? null : searchQuery.trim();

    if (detectedNlp?.filter && onApplyFilter && detectedNlp.only) {
      onApplyFilter(detectedNlp.filter);
    }

    setIsDropdownOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setDetectedNlp(null);
    if (targetQuery) onSearchSubmit(targetQuery, autoMix);
  };

  return (
    <div ref={searchContainerRef} className="relative z-30">
      <form id="party-console-song-request-form" onSubmit={(e) => handleSubmit(e, false)} className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search song, artist, link, or ask AI (e.g. 'romantic songs by Arijit', 'bhangra party by Diljit')..."
            value={searchQuery}
            onFocus={() => {
              if (searchQuery.trim().length >= 2) setIsDropdownOpen(true);
            }}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-12 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
          />
          {isSearching && (
            <Loader2 className="w-3.5 h-3.5 absolute right-6 top-1/2 -translate-y-1/2 text-cyan-400 animate-spin" />
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
                setDetectedNlp(null);
                setIsDropdownOpen(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-0.5 rounded transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!searchQuery.trim()}
          className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0 shadow-md shadow-cyan-500/20"
          title="Queue next (at top of Up Next)"
        >
          <Plus className="w-3 h-3" />
          <span>Queue</span>
        </button>
        <button
          type="button"
          onClick={(e) => handleSubmit(e, true)}
          disabled={!searchQuery.trim()}
          className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0 shadow-md shadow-orange-500/20"
          title="Play: mixes this song in now, and the AI reads its mood and moves 5 matching songs to the top of Up Next"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Play</span>
        </button>
      </form>

      {/* Matching Songs Dropdown */}
      {isDropdownOpen && searchQuery.trim().length >= 2 && (
        <div
          id="party-console-search-dropdown"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) void loadMoreResults();
          }}
          className="absolute left-0 right-0 top-full mt-1.5 bg-[#0e1322]/98 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-[440px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-cyan-500/30 scrollbar-track-transparent animate-in fade-in slide-in-from-top-1 duration-150 ring-1 ring-black/80"
        >
          <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-slate-400 border-b border-white/10 mb-1">
            <span className="flex items-center gap-1.5 font-bold text-cyan-300">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              MATCHING SONGS {searchResults.length > 0 ? `(${searchResults.length})` : ''}
            </span>
            <span className="text-[9px] text-slate-400">Click to play & sync mood, or use + Queue</span>
          </div>

          {/* AI NLP Intent Banner */}
          {detectedNlp?.isNlp && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-500/20 via-cyan-500/15 to-pink-500/15 border border-purple-500/35 text-[11px] mb-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 font-bold text-purple-200 truncate min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
                <span className="truncate">{detectedNlp.badgeLabel}</span>
              </div>
              {detectedNlp.filter && onApplyFilter && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyFilter(detectedNlp.filter!);
                    setIsDropdownOpen(false);
                    setSearchQuery('');
                    setSearchResults([]);
                    setDetectedNlp(null);
                  }}
                  className="px-2 py-0.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white border border-purple-400/40 text-[10px] font-bold font-mono transition-all flex items-center gap-1 shrink-0 shadow-sm"
                  title="Lock Up Next queue & mood to this filter"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Set Filter</span>
                </button>
              )}
            </div>
          )}

          {isSearching && searchResults.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-7 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>Searching song catalog...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 flex flex-col gap-1">
              <span>No direct matches found for &quot;{searchQuery}&quot;</span>
              <span className="text-[10px] text-slate-500">Press Enter or click Queue to auto-search & fetch.</span>
            </div>
          ) : (
            searchResults.map((song, idx) => (
              <div
                id={`party-console-search-item-${idx}`}
                key={song.url || idx}
                onClick={() => handleSelectSong(song, true)}
                className="group/item flex items-center justify-between gap-2.5 p-2 rounded-xl bg-black/30 hover:bg-white/10 border border-white/5 hover:border-cyan-500/40 cursor-pointer transition-all shrink-0"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-800 border border-white/10">
                    {song.thumbnail ? (
                      <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-900">
                        <Music className="w-4 h-4 text-slate-400" />
                      </div>
                    )}
                    {song.timestamp && (
                      <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono font-bold bg-black/85 px-1 rounded text-white/90">
                        {song.timestamp}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <span
                      className="text-xs font-bold text-white group-hover/item:text-cyan-300 transition-colors line-clamp-2 leading-snug break-words"
                      title={song.title}
                    >
                      {song.title}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="truncate">{song.author}</span>
                      {detectedNlp?.isNlp && idx === 0 && (
                        <span className="text-[9px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.2 rounded shrink-0">
                          🎯 Best AI Match
                        </span>
                      )}
                      {song.highlightTime !== undefined && (
                        <span className="text-amber-400 font-bold flex items-center gap-0.5 shrink-0" title="Viral hook moment">
                          🔥 Hook {formatTime(song.highlightTime)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleSelectSong(song, false)}
                    className="py-1 px-2.5 bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-black border border-cyan-500/40 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                    title="Add to top of Up Next Queue"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Queue</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectSong(song, true)}
                    className="py-1 px-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500 hover:to-orange-500 text-amber-300 hover:text-black border border-amber-500/30 hover:border-transparent rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-sm"
                    title="Play: mixes this song in now, and the AI reads its mood and moves 5 matching songs to the top of Up Next"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>Play</span>
                  </button>
                </div>
              </div>
            ))
          )}
          {searchResults.length > 0 && (isLoadingMore || searchHasMore) && (
            <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-slate-400 shrink-0">
              {isLoadingMore ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                  <span>Loading more songs…</span>
                </>
              ) : (
                <button type="button" onClick={() => void loadMoreResults()} className="text-cyan-300 hover:text-cyan-200 font-semibold">
                  Scroll for more songs
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

