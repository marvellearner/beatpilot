import React, { useState } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Vibe } from '../../../shared/songFilter';
import {
  PartyPopper,
  Sparkles,
  Zap,
  Flame,
  Music,
  Trash2,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';

interface StartPartyModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: AudioEngine;
  onPartyStarted?: (starterSong: string, vibe: string) => void;
}

export const StartPartyModal: React.FC<StartPartyModalProps> = ({
  isOpen,
  onClose,
  engine,
  onPartyStarted,
}) => {
  const [selectedVibe, setSelectedVibe] = useState<Vibe | 'auto'>('auto');
  const [customSong, setCustomSong] = useState('');
  const [clearHistory, setClearHistory] = useState(true);
  const [clearQueue, setClearQueue] = useState(true);
  const [clearTransitions, setClearTransitions] = useState(true);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStep, setLaunchStep] = useState<string>('');

  if (!isOpen) return null;

  const handleLaunch = async () => {
    setIsLaunching(true);
    setLaunchStep('Wiping test history and prepping clean decks...');

    try {
      setLaunchStep('AI DJ selecting the ultimate opening party banger...');
      const res = await engine.startParty({
        clearHistory,
        clearQueue,
        clearTransitions,
        vibe: selectedVibe,
        customQuery: customSong.trim() || undefined,
      });

      setLaunchStep(`Dropping the beat: "${res.starterSong || 'Opening Track'}"!`);
      setTimeout(() => {
        setIsLaunching(false);
        if (res.starterSong) {
          onPartyStarted?.(res.starterSong, res.vibe || 'dance');
        }
        onClose();
      }, 900);
    } catch (err) {
      console.error('Failed to launch party:', err);
      setIsLaunching(false);
    }
  };

  const vibeOptions: Array<{
    id: Vibe | 'auto';
    title: string;
    subtitle: string;
    icon: typeof Zap;
    gradient: string;
    border: string;
    examples: string;
  }> = [
    {
      id: 'auto',
      title: 'AI Smart Pick',
      subtitle: 'Auto-detect peak energy opener',
      icon: Sparkles,
      gradient: 'from-amber-500/20 via-pink-500/20 to-purple-500/20',
      border: 'border-pink-500/40',
      examples: 'Avicii, Gallan Goodiyaan, Panjabi MC',
    },
    {
      id: 'dance',
      title: 'Club Dance & EDM',
      subtitle: 'High-energy floor bangers',
      icon: Flame,
      gradient: 'from-cyan-500/20 to-blue-500/20',
      border: 'border-cyan-500/40',
      examples: 'Levels, Titanium, Pepas, Calvin Harris',
    },
    {
      id: 'bhangra',
      title: 'Bollywood & Punjabi',
      subtitle: 'High-octane dhol & dance hits',
      icon: Zap,
      gradient: 'from-amber-500/20 to-orange-500/20',
      border: 'border-amber-500/40',
      examples: 'Mundian To Bach Ke, Diljit, Kar Gayi Chull',
    },
    {
      id: 'chill',
      title: 'Sunset & Deep House',
      subtitle: 'Warmup & sophisticated grooves',
      icon: Music,
      gradient: 'from-emerald-500/20 to-teal-500/20',
      border: 'border-emerald-500/40',
      examples: 'Daft Punk, Sofi Tukker, Disclosure',
    },
  ];

  return (
    <div
      id="start-party-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLaunching) onClose();
      }}
    >
      <div
        id="start-party-modal"
        className="relative w-full max-w-xl rounded-3xl bg-gradient-to-b from-[#181b2a] via-[#10131f] to-[#0a0c14] border border-amber-500/30 p-6 shadow-2xl shadow-amber-500/10 flex flex-col gap-5 text-white"
      >
        {/* Close Button */}
        {!isLaunching && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Modal Header */}
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 via-rose-500 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30 shrink-0">
            <PartyPopper className="w-6 h-6 text-black fill-current" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-white">Start Party Mode</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Fresh DJ Set
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
              Done testing? Wipe previous test plays, remove 3-hour replay blocks, and let the AI kick off
              your party with the ultimate crowd-igniting opening banger!
            </p>
          </div>
        </div>

        {/* Section 1: Choose Vibe */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Select Party Vibe (AI Curated)</span>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            {vibeOptions.map((v) => {
              const isSelected = selectedVibe === v.id;
              const IconComp = v.icon;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={isLaunching}
                  onClick={() => setSelectedVibe(v.id)}
                  className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-1.5 cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? `bg-gradient-to-br ${v.gradient} ${v.border} ring-2 ring-amber-400/50 shadow-md`
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                      <IconComp className={`w-3.5 h-3.5 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                      <span>{v.title}</span>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-slate-300 leading-tight">{v.subtitle}</div>
                  <div className="text-[9px] font-mono text-slate-400 truncate mt-0.5">e.g. {v.examples}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional Custom Opener */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Or specify an opening song (optional):</span>
            <span className="text-[10px] text-slate-400">Leave empty for AI choice</span>
          </label>
          <input
            type="text"
            disabled={isLaunching}
            value={customSong}
            onChange={(e) => setCustomSong(e.target.value)}
            placeholder="e.g. Levels Avicii, Gallan Goodiyaan, or 295..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 focus:border-amber-400 focus:outline-none text-xs text-white placeholder-slate-500 font-medium transition-colors"
          />
        </div>

        {/* Section 2: Reset & Clean Slate Options */}
        <div className="bg-black/30 border border-white/10 rounded-2xl p-3.5 flex flex-col gap-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Reset Test Data & Start Fresh</span>
          </div>

          <div className="flex flex-col gap-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
              <input
                type="checkbox"
                disabled={isLaunching}
                checked={clearHistory}
                onChange={(e) => setClearHistory(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 border-white/20 bg-black/40"
              />
              <span>
                <strong>Wipe test play history:</strong> Removes Previously Played & resets 3-hr repeat prevention
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
              <input
                type="checkbox"
                disabled={isLaunching}
                checked={clearQueue}
                onChange={(e) => setClearQueue(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 border-white/20 bg-black/40"
              />
              <span>
                <strong>Clear test queue:</strong> Empties Up Next so AI auto-populates 50 fresh vibe bangers
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200 hover:text-white">
              <input
                type="checkbox"
                disabled={isLaunching}
                checked={clearTransitions}
                onChange={(e) => setClearTransitions(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 border-white/20 bg-black/40"
              />
              <span>
                <strong>Reset transition logs:</strong> Clears previous test transitions for a fresh party log
              </span>
            </label>
          </div>
        </div>

        {/* Action Button & Launch State */}
        <div className="flex items-center justify-end gap-3 pt-1">
          {!isLaunching ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLaunch}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-rose-500 to-pink-500 hover:from-amber-300 hover:via-rose-400 hover:to-pink-400 text-slate-950 font-black text-xs shadow-xl shadow-rose-500/25 flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <PartyPopper className="w-4 h-4 fill-current" />
                <span>🚀 Launch Party Now</span>
              </button>
            </>
          ) : (
            <div className="w-full flex items-center justify-center gap-3 py-2 text-amber-300 text-xs font-bold bg-amber-500/10 border border-amber-500/30 rounded-xl animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>{launchStep}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
