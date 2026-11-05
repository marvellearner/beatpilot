import React, { useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { AudioEngine } from '../../audio/AudioEngine';
import { NowPlayingHero } from './NowPlayingHero';
import { EngineRhythmPanel } from './RhythmPanel';
import { MoodEqPanel } from './MoodEqPanel';
import { LocalLibraryPanel } from './LocalLibraryPanel';
import { QueueManagerPanel } from './QueueManagerPanel';
import { PreviouslyPlayedPanel } from './PreviouslyPlayedPanel';
import { BangersPanel } from './BangersPanel';
import { SongListEditorModal } from './SongListEditorModal';
import { useEngineTrack, useEngineMood } from '../hooks/useEngineStore';
import { PLAY_LOG_MAX } from '../../audio/engine/SongLibrary';
import { FileText, Edit3, Play, Disc3, Loader2, Sparkles } from 'lucide-react';

interface PartyConsoleViewProps {
  engine: AudioEngine;
  headerSlot?: HTMLElement | null; // where the app's top bar takes this console's my_songs.txt buttons
}

export const PartyConsoleView: React.FC<PartyConsoleViewProps> = ({ engine, headerSlot }) => {
  // Song and mix state only (not the clock): this view lays out the whole console
  const playback = useEngineTrack(engine);
  const moodState = useEngineMood(engine);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const formatTime = useCallback((secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }, []);

  // Handlers for my_songs.txt actions in the navbar portal
  const handleLoadMySongs = async () => {
    setIsLoadingSongs(true);
    try {
      const res = await engine.loadSongsFromTextFile();
      showToast(`Loaded ${res.count} songs from my_songs.txt!`);
    } catch {
      showToast('Failed to load songs from my_songs.txt');
    } finally {
      setIsLoadingSongs(false);
    }
  };

  const handleOpenEditor = async () => {
    try {
      const res = await fetch('/api/my-songs');
      const data = await res.json();
      setFileContent(data.raw || '');
      setIsEditingFile(true);
    } catch {
      showToast('Could not load my_songs.txt content');
    }
  };

  const handleSaveEditor = async (content: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/my-songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        showToast('Saved my_songs.txt successfully!');
        return true;
      }
    } catch {
      showToast('Failed to save my_songs.txt');
    }
    return false;
  };

  // Previously played songs (newest first); last 3 hours kept out of Up Next
  const playLogTop = engine.playLog[0]?.playedAt;
  const historyEntries = useMemo(
    () => engine.playLog.slice(0, PLAY_LOG_MAX),
    [engine, engine.playLog.length, playLogTop]
  );

  const mixFromHistory = useCallback(
    (entry: { url?: string; artist: string; title: string }) =>
      engine.acquireTrack(entry.url || `${entry.artist} ${entry.title}`, true),
    [engine]
  );

  const queueFromHistory = useCallback(
    (entry: { url?: string; artist: string; title: string }) =>
      engine.acquireTrack(entry.url || `${entry.artist} ${entry.title}`, false, 'front'),
    [engine]
  );

  const pendingMix = playback.pendingMix;
  const mixLoadingItem = playback.mixLoadingId
    ? engine.queue.find((q) => q.id === playback.mixLoadingId)
    : null;

  return (
    <div id="party-console" className="flex flex-col gap-2.5 max-w-[1440px] mx-auto w-full relative">
      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          id="party-console-toast"
          className="fixed top-5 right-5 z-50 bg-black/90 border border-cyan-500/40 text-cyan-200 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-3"
        >
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Lined up to mix banner (floating corner notification) */}
      {(pendingMix || mixLoadingItem) && (
        <div
          id="party-console-lined-up-mix"
          role="status"
          className="fixed bottom-4 right-4 z-50 w-[min(460px,calc(100vw-2rem))] p-3 rounded-xl bg-gradient-to-r from-cyan-950/95 via-blue-950/95 to-purple-950/95 backdrop-blur border border-cyan-500/40 shadow-2xl shadow-cyan-500/20 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-slate-900 border border-cyan-500/30 flex items-center justify-center shadow-md">
              {pendingMix?.thumbnail || mixLoadingItem?.thumbnail ? (
                <img
                  src={pendingMix?.thumbnail || mixLoadingItem?.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-6 h-6 text-cyan-400 animate-spin [animation-duration:8s]" />
              )}
              <span className="absolute bottom-0 right-0 px-1 py-0.2 bg-cyan-500 text-[8px] font-black text-black rounded-tl shadow-sm">
                NEXT
              </span>
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase flex items-center gap-1.5 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  LINED UP TO MIX
                </span>
                {pendingMix && (
                  <span className="text-[11px] font-mono font-extrabold text-cyan-200 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-400/40 shadow-sm animate-pulse">
                    ⏱ in {Math.ceil(pendingMix.startsInSeconds)}s
                  </span>
                )}
                {pendingMix?.harmonicShift && (
                  <span
                    className="text-[9px] font-mono font-bold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded-full"
                    title="Energy & harmonic flow compatibility"
                  >
                    ⚡ {pendingMix.harmonicShift}
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2 truncate mt-1">
                <span
                  className="text-xs sm:text-sm font-extrabold text-white truncate leading-snug"
                  title={pendingMix?.title || mixLoadingItem?.title}
                >
                  {pendingMix?.title || mixLoadingItem?.title}
                </span>
                {(pendingMix?.artist || mixLoadingItem?.artist) && (
                  <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                    by {pendingMix?.artist || mixLoadingItem?.artist}
                  </span>
                )}
              </div>

              <div className="text-[10px] font-mono text-slate-300 flex items-center gap-1.5 truncate mt-0.5">
                {pendingMix ? (
                  <>
                    <span className="text-cyan-300 font-semibold truncate" title={pendingMix.reason}>
                      {pendingMix.reason}
                    </span>
                    {pendingMix.entryTime > 0 && (
                      <>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400">enters at {formatTime(pendingMix.entryTime)}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-amber-300 font-semibold flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                    Loading track audio… will mix in automatically once ready
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pendingMix && (
              <button
                type="button"
                onClick={() => engine.nextTrack()}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/25 transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                title="Mix now immediately (skip phrase wait)"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Mix now</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => engine.skipPlannedSong()}
              className="px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white font-semibold text-xs border border-white/10 transition-colors active:scale-95 cursor-pointer"
              title="Not this song next: it moves down Up Next and the next song is lined up instead"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* my_songs.txt actions in navbar portal */}
      {headerSlot &&
        createPortal(
          <div id="party-console-my-songs" className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
            <span className="flex items-center gap-1 pl-1.5 pr-1 text-[11px] text-slate-400" title="Your song list (my_songs.txt)">
              <FileText className="w-3 h-3 text-cyan-400" />
              <span className="hidden min-[1800px]:inline">my_songs.txt</span>
            </span>
            <button
              onClick={handleLoadMySongs}
              disabled={isLoadingSongs}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 transition-all disabled:opacity-60"
              title="Load songs from my_songs.txt"
            >
              {isLoadingSongs ? 'Loading…' : 'Load'}
            </button>
            <button
              onClick={handleOpenEditor}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-all"
              title="View or add songs to my_songs.txt"
            >
              <Edit3 className="w-3 h-3 text-amber-400" />
              Edit
            </button>
          </div>,
          headerSlot
        )}

      {/* 3-Column Dashboard Grid: player (38-40%) | sound controls (25%) | queue & history (35-37%) */}
      <div
        id="party-console-grid"
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,40fr)_minmax(0,25fr)_minmax(0,35fr)] xl:grid-cols-[minmax(0,38fr)_minmax(0,25fr)_minmax(0,37fr)] gap-3 items-start"
      >
        {/* Left Column: Now Playing Hero */}
        <div id="party-console-left-column" className="flex flex-col gap-3 min-w-0">
          <NowPlayingHero engine={engine} formatTime={formatTime} />
        </div>

        {/* Middle Column: Rhythm Enhancer + Mood & Equalizer + Offline Library */}
        <div id="party-console-middle-column" className="flex flex-col gap-3 min-w-0">
          <EngineRhythmPanel engine={engine} />
          <MoodEqPanel
            compact
            mood={moodState.mood}
            eqGains={moodState.eqGains}
            onSetMood={(m) => engine.setMood(m)}
            onSetEq={(band, db) => engine.setEqBand(band, db)}
            onResetEq={() => engine.resetEq()}
          />
          <LocalLibraryPanel offlineOnly={moodState.offlineOnly} onToggleOfflineOnly={() => engine.toggleOfflineOnly()} />
        </div>

        {/* Right Column: Up Next Queue + Previously Played + Bangers Panel */}
        <div id="party-console-right-column" className="flex flex-col gap-3 min-w-0">
          <QueueManagerPanel engine={engine} onToast={showToast} formatTime={formatTime} />
          <PreviouslyPlayedPanel entries={historyEntries} onMix={mixFromHistory} onQueue={queueFromHistory} />
          <BangersPanel engine={engine} onToast={showToast} />
        </div>
      </div>

      {/* In-App Editor Modal for my_songs.txt */}
      <SongListEditorModal
        isOpen={isEditingFile}
        initialContent={fileContent}
        onClose={() => setIsEditingFile(false)}
        onSave={handleSaveEditor}
      />
    </div>
  );
};
