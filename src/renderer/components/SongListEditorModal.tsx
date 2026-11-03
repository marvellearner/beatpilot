import React, { useState, useEffect } from 'react';
import { FileText, X, Check } from 'lucide-react';

interface SongListEditorModalProps {
  isOpen: boolean;
  initialContent: string;
  onClose: () => void;
  onSave: (content: string) => Promise<boolean>;
}

export const SongListEditorModal: React.FC<SongListEditorModalProps> = ({
  isOpen,
  initialContent,
  onClose,
  onSave,
}) => {
  const [fileContent, setFileContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setFileContent(initialContent);
  }, [initialContent]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const ok = await onSave(fileContent);
      if (ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="party-console-song-list-editor"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#101422] border border-white/20 rounded-3xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Edit Custom Song List (my_songs.txt)</h3>
              <p className="text-xs text-slate-400">
                Write one song name or YouTube link per line. Lines starting with # are comments.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          rows={12}
          className="w-full p-3.5 bg-black/60 border border-white/15 rounded-2xl text-xs font-mono text-emerald-300 placeholder-slate-600 focus:outline-none focus:border-cyan-400 resize-none"
          placeholder="# Add songs below:&#10;Sidhu Moose Wala - 295&#10;Diljit Dosanjh - Lover&#10;https://www.youtube.com/watch?v=kJQP7kiw5Fk"
        />

        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-slate-400">
            Saves directly to <code className="text-amber-400 font-mono">my_songs.txt</code> in project root
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:opacity-95 shadow-md flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-4 h-4 text-black" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>{isSaving ? 'Saving...' : 'Save File'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

