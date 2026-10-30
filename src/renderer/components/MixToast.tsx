/**
 * A short message after a Mix click ("Mix planned in 23 s…", "Loading…", "Playing…"), so a click
 * never looks like it did nothing. Shows for a few seconds whenever `notice.at` changes.
 */
import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

const SHOW_MS = 4000;

export const MixToast: React.FC<{ notice: { text: string; at: number } | null }> = ({ notice }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [notice?.at]);

  if (!visible || !notice) return null;
  return (
    <div
      id="mix-toast"
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[min(92vw,520px)] bg-black/90 border border-cyan-500/50 text-cyan-100 px-4 py-2.5 rounded-2xl shadow-2xl shadow-cyan-950/50 text-xs font-bold flex items-center gap-2"
    >
      <Zap className="w-4 h-4 text-cyan-300 fill-current shrink-0" />
      <span>{notice.text}</span>
    </div>
  );
};
