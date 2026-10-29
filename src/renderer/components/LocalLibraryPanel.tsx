import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, FilePlus2, RefreshCw, X } from 'lucide-react';

interface LibrarySummary {
  count: number;
  savedCount: number;
  folders: string[];
  musicDir: string;
  scanning: boolean;
  savingCount: number;
  ffmpeg: boolean;
  online: boolean;
  saveAfterPlays: number;
}

interface LocalLibraryPanelProps {
  offlineOnly: boolean;
  onToggleOfflineOnly: () => void;
}

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$/i;

/** Every file in a dropped folder (Chrome's entry API), recursively. */
async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([])));
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: File[] = [];
  // readEntries returns at most ~100 entries per call
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    for (const e of batch) all.push(...(await filesFromEntry(e)));
  }
  return all;
}

/**
 * The offline library: songs on this laptop, playable with no internet. Add files or folders
 * (drag-and-drop or pickers copy them into the app's music folder) or scan a folder in place;
 * most-played songs are saved as MP3 by themselves.
 */
export const LocalLibraryPanel: React.FC<LocalLibraryPanelProps> = ({ offlineOnly, onToggleOfflineOnly }) => {
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/local/library');
      if (res.ok) setSummary(await res.json());
    } catch {
      // server unreachable: keep the last summary
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const send = async (path: string, method: string, body?: object) => {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setSummary(data);
    return data;
  };

  const uploadFiles = async (list: File[]) => {
    const files = list.filter((f) => AUDIO_EXT.test(f.name));
    if (!files.length) {
      setMessage('No audio files there (MP3, WAV, FLAC, M4A, AAC, OGG, Opus).');
      return;
    }
    setMessage(null);
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      setUpload({ done: i, total: files.length });
      try {
        const res = await fetch(`/api/local/upload?name=${encodeURIComponent(files[i].name)}`, { method: 'POST', body: files[i] });
        if (!res.ok) failed++;
        else setSummary(await res.json());
      } catch {
        failed++;
      }
    }
    setUpload(null);
    setMessage(`Added ${files.length - failed} song${files.length - failed === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const entries = Array.from(e.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((x): x is FileSystemEntry => !!x);
    const files = entries.length ? (await Promise.all(entries.map(filesFromEntry))).flat() : Array.from(e.dataTransfer.files);
    await uploadFiles(files);
  };

  const addFolder = async () => {
    if (!folderPath.trim()) return;
    try {
      await send('/api/local/folders', 'POST', { path: folderPath });
      setMessage(`Scanning ${folderPath.trim()} (files stay where they are).`);
      setFolderPath('');
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const online = summary?.online ?? true;
  return (
    <div
      id="local-library-panel"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`dj-panel rounded-2xl p-3.5 border shadow-xl flex flex-col gap-2.5 bg-gradient-to-b from-[#0f1a16]/95 to-[#0a120f]/95 transition-colors ${
        dragOver ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-white/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="min-w-0">
          <h3 className="font-extrabold text-xs text-white tracking-wide">📁 LOCAL MUSIC (OFFLINE)</h3>
          <span className="text-[10px] text-slate-400">
            {summary
              ? `${summary.count} song${summary.count === 1 ? '' : 's'} · ${summary.savedCount} saved from Most Played${summary.savingCount ? ` · saving ${summary.savingCount}…` : ''}`
              : 'Loading…'}
          </span>
        </div>
        <span
          className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 shrink-0"
          title={online ? 'Internet reachable' : 'No internet: search and Up Next use the songs on this laptop'}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-500'}`} aria-hidden="true" />
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <button
        id="local-offline-only"
        onClick={onToggleOfflineOnly}
        className={`py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
          offlineOnly ? 'bg-emerald-500/25 border-emerald-400 text-emerald-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
        }`}
        aria-pressed={offlineOnly}
        title="Up Next only from the songs on this laptop, even when the internet works"
      >
        {offlineOnly ? '✓ Offline only: Up Next from this laptop' : 'Use only local music'}
      </button>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => filesInput.current?.click()}
          disabled={!!upload}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 disabled:opacity-50"
        >
          <FilePlus2 className="w-3.5 h-3.5" /> Add files
        </button>
        <button
          onClick={() => folderInput.current?.click()}
          disabled={!!upload}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 disabled:opacity-50"
        >
          <FolderOpen className="w-3.5 h-3.5" /> Add folder
        </button>
      </div>
      <input
        ref={filesInput}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus"
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported by Chrome and Edge but not in React's types
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className="text-[10px] text-slate-500 text-center -mt-1">…or drop songs or a folder here (they're copied into the app's music folder)</div>

      {/* Scan a folder in place */}
      <div className="flex items-center gap-1.5">
        <input
          id="local-folder-path"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addFolder()}
          placeholder="Folder on this laptop, e.g. D:\Music"
          className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500"
        />
        <button onClick={() => void addFolder()} className="px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600/30 border border-emerald-500/50 text-emerald-100">
          Scan
        </button>
        <button
          onClick={() => void send('/api/local/rescan', 'POST').catch((err) => setMessage(err.message))}
          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300"
          title="Look for new or changed files"
          aria-label="Rescan the library"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${summary?.scanning ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {summary && summary.folders.length > 1 && (
        <ul className="flex flex-col gap-0.5 text-[10px] font-mono text-slate-400">
          {summary.folders.slice(1).map((f) => (
            <li key={f} className="flex items-center justify-between gap-2">
              <span className="truncate" title={f}>{f}</span>
              <button onClick={() => void send('/api/local/folders', 'DELETE', { path: f })} aria-label={`Stop scanning ${f}`} className="text-slate-500 hover:text-red-300">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(upload || message) && (
        <div className="text-[10px] font-mono text-emerald-200 bg-black/40 rounded-lg px-2 py-1">
          {upload ? `Adding ${upload.done + 1} of ${upload.total}…` : message}
        </div>
      )}
      {summary && (
        <div className="text-[10px] text-slate-500 leading-snug">
          Songs played {summary.saveAfterPlays}+ times are saved here as {summary.ffmpeg ? 'MP3' : 'their original audio (install ffmpeg for MP3)'} by
          themselves, so they play without internet. Search finds local songs first.
        </div>
      )}
    </div>
  );
};
