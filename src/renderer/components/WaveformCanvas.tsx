import React, { useRef, useEffect } from 'react';

interface WaveformCanvasProps {
  analyser: AnalyserNode;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  peaks?: number[];
  color: string;
  highlightTime?: number;
  hookTimes?: number[]; // every hook (each chorus, a drop); drawn instead of highlightTime when given
  cueInTime?: number;
  loop?: { start: number; end: number } | null;
  loopInTime?: number | null;
  onSeek: (time: number) => void;
  id?: string; // DOM id of the waveform container (unique per deck)
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  id,
  analyser,
  isPlaying,
  currentTime,
  duration,
  peaks = [],
  color,
  highlightTime,
  hookTimes,
  cueInTime,
  loop,
  loopInTime,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Dark background with subtle grid
      ctx.fillStyle = '#0b0e17';
      ctx.fillRect(0, 0, width, height);

      // Draw Static Waveform Peaks
      if (peaks.length > 0) {
        const barWidth = width / peaks.length;
        const halfHeight = height / 2;

        for (let i = 0; i < peaks.length; i++) {
          const peak = peaks[i];
          const x = i * barWidth;
          const barHeight = peak * (halfHeight - 4);

          const progress = duration > 0 ? currentTime / duration : 0;
          const isPassed = i / peaks.length <= progress;

          ctx.fillStyle = isPassed ? color : 'rgba(100, 116, 139, 0.35)';
          ctx.fillRect(x, halfHeight - barHeight, Math.max(1, barWidth - 1), barHeight * 2);
        }
      }

      // Draw Live Real-Time Spectrum Overlay if playing
      if (isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;

        const sliceWidth = width / 40;
        for (let i = 0; i < 40; i++) {
          const val = dataArray[i * 2] / 255.0;
          const barH = val * (height * 0.7);
          ctx.fillRect(i * sliceWidth, height - barH, sliceWidth - 2, barH);
        }
        ctx.globalAlpha = 1.0;
      }

      // Hook markers: each chorus and the drop (or the single hook)
      for (const hookTime of hookTimes?.length ? hookTimes : highlightTime ? [highlightTime] : []) {
        if (!(duration > 0 && hookTime > 0 && hookTime < duration)) continue;
        const hookX = (hookTime / duration) * width;

        // Glowing dashed vertical line
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(hookX, 0);
        ctx.lineTo(hookX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Flame badge on top
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(hookX - 16, 2, 32, 12);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HOOK', hookX, 11);
      }

      // Draw Pre-Roll Cue In Point (16 beats before the hook)
      if (duration > 0 && cueInTime && cueInTime > 0 && cueInTime < duration) {
        const cueX = (cueInTime / duration) * width;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cueX, 0);
        ctx.lineTo(cueX, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Loop Region (Virtual DJ style)
      if (duration > 0 && loop && loop.end > loop.start) {
        const loopStartX = (loop.start / duration) * width;
        const loopEndX = (loop.end / duration) * width;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.fillRect(loopStartX, 0, Math.max(2, loopEndX - loopStartX), height);

        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(loopStartX, 0);
        ctx.lineTo(loopStartX, height);
        ctx.moveTo(loopEndX, 0);
        ctx.lineTo(loopEndX, height);
        ctx.stroke();

        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('IN', loopStartX + 3, 10);
        ctx.textAlign = 'right';
        ctx.fillText('OUT', loopEndX - 3, 10);
      } else if (duration > 0 && loopInTime !== undefined && loopInTime !== null && loopInTime > 0) {
        const inX = (loopInTime / duration) * width;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(inX, 0);
        ctx.lineTo(inX, height);
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('IN', inX + 3, 10);
      }

      // Draw Playhead Marker
      if (duration > 0) {
        const playheadX = (currentTime / duration) * width;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();

        // Playhead glow
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(playheadX, height - 6, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [analyser, isPlaying, currentTime, duration, peaks, color, highlightTime, hookTimes, cueInTime]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div id={id} className="relative w-full h-24 rounded-lg overflow-hidden border border-white/10 shadow-inner cursor-pointer group">
      <canvas
        ref={canvasRef}
        width={600}
        height={96}
        onClick={handleClick}
        className="w-full h-full block"
      />
      <div className="absolute top-1 right-2 text-[10px] font-mono text-slate-400 bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
        SCRUB TIMELINE
      </div>
    </div>
  );
};
