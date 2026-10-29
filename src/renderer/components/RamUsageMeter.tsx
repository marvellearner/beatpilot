import React, { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, HardDrive, ShieldCheck, Zap } from 'lucide-react';

interface MemoryTelemetry {
  system: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    totalGb: string;
    usedGb: string;
    freeGb: string;
  };
  process: {
    rssBytes: number;
    rssMb: string;
    heapUsedMb: string;
    heapTotalMb: string;
  };
  timestamp: number;
}

export const RamUsageMeter: React.FC = () => {
  const [data, setData] = useState<MemoryTelemetry | null>(null);
  const [browserHeapMb, setBrowserHeapMb] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Poll server memory telemetry every 2.5 seconds
  useEffect(() => {
    let isMounted = true;
    const abortCtrl = new AbortController();

    const fetchMemory = async () => {
      try {
        const res = await fetch('/api/system/memory', { signal: abortCtrl.signal });
        if (res.ok && isMounted) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // Silent catch for network drops
      }

      // Check client browser heap if available
      try {
        const perfMem = (window.performance as unknown as { memory?: { usedJSHeapSize: number } })?.memory;
        if (perfMem?.usedJSHeapSize) {
          setBrowserHeapMb(Math.round(perfMem.usedJSHeapSize / (1024 * 1024)));
        }
      } catch {
        // performance.memory not available in this browser
      }
    };

    fetchMemory();
    const interval = setInterval(fetchMemory, 2500);

    return () => {
      isMounted = false;
      abortCtrl.abort();
      clearInterval(interval);
    };
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isOpen]);

  const percent = data?.system.usedPercent ?? 0;
  const usedGb = data?.system.usedGb ?? '--';
  const totalGb = data?.system.totalGb ?? '24.0';

  const isHigh = percent >= 85;
  const isMedium = percent >= 70 && percent < 85;

  const barColor = isHigh
    ? 'bg-gradient-to-r from-rose-500 to-red-500'
    : isMedium
      ? 'bg-gradient-to-r from-amber-500 to-orange-400'
      : 'bg-gradient-to-r from-emerald-400 to-cyan-400';

  const badgeBg = isHigh
    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
    : isMedium
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';

  const glowClass = isHigh
    ? 'shadow-[0_0_12px_rgba(244,63,94,0.35)]'
    : isMedium
      ? 'shadow-[0_0_8px_rgba(245,158,11,0.25)]'
      : 'shadow-[0_0_8px_rgba(16,185,129,0.2)]';

  return (
    <div
      ref={containerRef}
      id="ui-ram-usage-meter"
      className="relative select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pill Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all duration-200 cursor-pointer ${badgeBg} ${glowClass} hover:brightness-110`}
        title="Click for full RAM telemetry breakdown"
      >
        <div className="flex items-center gap-1.5">
          <Activity className={`w-3.5 h-3.5 ${isHigh ? 'animate-pulse text-rose-400' : isMedium ? 'text-amber-400' : 'text-emerald-400'}`} />
          <span className="font-bold tracking-tight">RAM</span>
        </div>

        {/* Micro progress gauge bar */}
        <div className="w-10 sm:w-12 h-1.5 rounded-full bg-white/10 overflow-hidden relative border border-white/5">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
            style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
          />
        </div>

        {/* Stats text */}
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-[11px]">{percent ? `${percent}%` : '...'}</span>
          <span className="hidden md:inline text-[10px] text-slate-400">
            ({usedGb}/{totalGb} GB)
          </span>
        </div>

        {/* Realtime live heartbeat pulse */}
        <span className="relative flex h-2 w-2">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isHigh ? 'bg-rose-400' : isMedium ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isHigh ? 'bg-rose-500' : isMedium ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
          />
        </span>
      </button>

      {/* Expandable Telemetry Breakdown Popover */}
      {(isOpen || isHovered) && (
        <div
          id="ui-ram-popover"
          className="absolute right-0 top-full mt-2 w-72 sm:w-80 dj-panel rounded-2xl p-3.5 border border-white/15 bg-gradient-to-b from-[#141724]/98 to-[#0a0c14]/98 shadow-2xl backdrop-blur-xl z-50 flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h4 className="font-extrabold text-xs text-white uppercase tracking-wider">RAM & Memory Health</h4>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${badgeBg}`}
              title="System memory load status"
            >
              {isHigh ? 'Heavy Load' : isMedium ? 'Moderate' : 'Optimal'}
            </span>
          </div>

          {/* System Memory Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-slate-300 font-bold">Physical System RAM</span>
              <span className="text-white font-black">{percent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-black/60 border border-white/10 overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>Used: {usedGb} GB</span>
              <span>Free: {data?.system.freeGb ?? '--'} GB</span>
              <span>Total: {totalGb} GB</span>
            </div>
          </div>

          {/* Memory consumers breakdown */}
          <div className="flex flex-col gap-1.5 bg-black/40 p-2.5 rounded-xl border border-white/5 font-mono text-[11px]">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
              Process Allocations
            </div>

            <div className="flex justify-between items-center text-slate-300 py-0.5">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-cyan-400" />
                <span>AI DJ Server (RSS):</span>
              </span>
              <span className="font-bold text-white">{data?.process.rssMb ? `${data.process.rssMb} MB` : '--'}</span>
            </div>

            <div className="flex justify-between items-center text-slate-300 py-0.5">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-purple-400" />
                <span>V8 Node Heap:</span>
              </span>
              <span className="font-bold text-white">
                {data?.process.heapUsedMb ? `${data.process.heapUsedMb} / ${data.process.heapTotalMb} MB` : '--'}
              </span>
            </div>

            {browserHeapMb !== null && (
              <div className="flex justify-between items-center text-slate-300 py-0.5">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-amber-400" />
                  <span>Browser JS & Audio:</span>
                </span>
                <span className="font-bold text-white">{browserHeapMb} MB</span>
              </div>
            )}
          </div>

          {/* Footer Status */}
          <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[10px] text-slate-400 font-mono">
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3 h-3" />
              <span>Real-time Audio Protected</span>
            </span>
            <span>Live (2.5s poll)</span>
          </div>
        </div>
      )}
    </div>
  );
};