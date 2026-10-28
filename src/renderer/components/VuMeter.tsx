import React, { useEffect, useRef, useState } from 'react';

export interface VuMeterProps {
  analyserL?: AnalyserNode | null;
  analyserR?: AnalyserNode | null;
  analyser?: AnalyserNode | null; // fallback single analyser node
  isPlaying?: boolean;
  height?: number; // total height in px
  barWidth?: number; // width of each vertical channel bar
  barGap?: number; // gap between L and R bars
  segments?: number; // number of discrete LED segments per bar
  showLabels?: boolean;
  showPeakText?: boolean;
  title?: string;
  className?: string;
}

export const VuMeter: React.FC<VuMeterProps> = ({
  analyserL,
  analyserR,
  analyser,
  isPlaying = false,
  height = 150,
  barWidth = 9,
  barGap = 5,
  segments = 16,
  showLabels = true,
  showPeakText = true,
  title = 'LEVEL',
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Ballistics & Peak hold state (in refs to prevent re-renders at 60fps)
  const currentLevelL = useRef<number>(0);
  const currentLevelR = useRef<number>(0);
  const peakHoldL = useRef<number>(0);
  const peakHoldR = useRef<number>(0);
  const peakTimerL = useRef<number>(0);
  const peakTimerR = useRef<number>(0);

  // Cached data arrays to avoid GC pressure
  const timeDataL = useRef<Uint8Array | null>(null);
  const timeDataR = useRef<Uint8Array | null>(null);
  const freqDataL = useRef<Uint8Array | null>(null);
  const freqDataR = useRef<Uint8Array | null>(null);

  // Numerical dB display for UI readout (throttled)
  const [displayDb, setDisplayDb] = useState<{ l: string; r: string; isClipping: boolean }>({
    l: '-∞',
    r: '-∞',
    isClipping: false,
  });
  const lastDbUpdate = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Device Pixel Ratio scaling for ultra-sharp Retina/4K rendering
    const dpr = window.devicePixelRatio || 1;
    const meterWidth = barWidth * 2 + barGap;
    const labelWidth = showLabels ? 28 : 0;
    const totalCssWidth = meterWidth + labelWidth + 12;
    const totalCssHeight = height;

    canvas.width = totalCssWidth * dpr;
    canvas.height = totalCssHeight * dpr;
    canvas.style.width = `${totalCssWidth}px`;
    canvas.style.height = `${totalCssHeight}px`;
    ctx.scale(dpr, dpr);

    // Initialize typed arrays
    const targetL = analyserL || analyser;
    const targetR = analyserR || analyser;

    if (targetL) {
      timeDataL.current = new Uint8Array(targetL.fftSize);
      freqDataL.current = new Uint8Array(targetL.frequencyBinCount);
    }
    if (targetR) {
      timeDataR.current = new Uint8Array(targetR.fftSize);
      freqDataR.current = new Uint8Array(targetR.frequencyBinCount);
    }

    // Ballistics constants
    const attack = 0.92; // instantaneous responsive attack
    const decay = 0.88; // smooth, realistic ~250-300ms decay

    const render = () => {
      let targetValL = 0;
      let targetValR = 0;

      if (isPlaying) {
        // Measure Left channel
        if (targetL && timeDataL.current && freqDataL.current) {
          targetL.getByteTimeDomainData(timeDataL.current as any);
          targetL.getByteFrequencyData(freqDataL.current as any);

          // Calculate RMS and Peak from time domain
          let sumSquares = 0;
          let peak = 0;
          const len = timeDataL.current.length;
          for (let i = 0; i < len; i++) {
            const sample = (timeDataL.current[i] - 128) / 128;
            sumSquares += sample * sample;
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
          }
          const rms = Math.sqrt(sumSquares / len);

          // Rhythmic bass/transient energy from low-frequency bins
          let bassEnergy = 0;
          const bassBins = Math.min(16, freqDataL.current.length);
          for (let i = 0; i < bassBins; i++) {
            bassEnergy += freqDataL.current[i] / 255;
          }
          bassEnergy = bassEnergy / bassBins;

          // Combine RMS, peak and punchy bass
          targetValL = Math.min(1.0, rms * 1.5 + peak * 0.35 + bassEnergy * 0.25);
        }

        // Measure Right channel
        if (targetR && timeDataR.current && freqDataR.current) {
          targetR.getByteTimeDomainData(timeDataR.current as any);
          targetR.getByteFrequencyData(freqDataR.current as any);

          let sumSquares = 0;
          let peak = 0;
          const len = timeDataR.current.length;
          for (let i = 0; i < len; i++) {
            const sample = (timeDataR.current[i] - 128) / 128;
            sumSquares += sample * sample;
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
          }
          const rms = Math.sqrt(sumSquares / len);

          let midHighEnergy = 0;
          const startBin = 16;
          const endBin = Math.min(64, freqDataR.current.length);
          const count = endBin - startBin;
          for (let i = startBin; i < endBin; i++) {
            midHighEnergy += freqDataR.current[i] / 255;
          }
          midHighEnergy = count > 0 ? midHighEnergy / count : 0;

          // If mono analyser shared, add organic stereo variation
          if (targetL === targetR) {
            targetValR = Math.min(1.0, rms * 1.45 + peak * 0.38 + midHighEnergy * 0.28);
          } else {
            targetValR = Math.min(1.0, rms * 1.5 + peak * 0.35 + midHighEnergy * 0.25);
          }
        }
      }

      // Ballistics smoothing
      currentLevelL.current =
        targetValL > currentLevelL.current
          ? currentLevelL.current * (1 - attack) + targetValL * attack
          : Math.max(0, currentLevelL.current * decay);

      currentLevelR.current =
        targetValR > currentLevelR.current
          ? currentLevelR.current * (1 - attack) + targetValR * attack
          : Math.max(0, currentLevelR.current * decay);

      // Peak Hold Logic (Channel L)
      const activeSegsL = Math.round(currentLevelL.current * segments);
      if (activeSegsL >= peakHoldL.current) {
        peakHoldL.current = activeSegsL;
        peakTimerL.current = 45; // ~750ms hold at 60fps
      } else {
        if (peakTimerL.current > 0) {
          peakTimerL.current--;
        } else {
          peakHoldL.current = Math.max(0, peakHoldL.current - 0.25);
        }
      }

      // Peak Hold Logic (Channel R)
      const activeSegsR = Math.round(currentLevelR.current * segments);
      if (activeSegsR >= peakHoldR.current) {
        peakHoldR.current = activeSegsR;
        peakTimerR.current = 45;
      } else {
        if (peakTimerR.current > 0) {
          peakTimerR.current--;
        } else {
          peakHoldR.current = Math.max(0, peakHoldR.current - 0.25);
        }
      }

      // -------------------------------------------------------------
      // DRAW CANVAS VU METER
      // -------------------------------------------------------------
      ctx.clearRect(0, 0, totalCssWidth, totalCssHeight);

      const meterX = 6;
      const meterY = 6;
      const meterHeight = totalCssHeight - 12;
      const segGap = 2;
      const segHeight = (meterHeight - (segments - 1) * segGap) / segments;

      // Color scheme for segments from index 0 (bottom) to segments-1 (top)
      const getSegmentColor = (idx: number, isActive: boolean) => {
        const ratio = idx / (segments - 1);
        if (ratio >= 0.88) {
          // Top ~12%: +3 dB CLIP (Neon Red)
          return isActive ? '#ef4444' : 'rgba(239, 68, 68, 0.15)';
        }
        if (ratio >= 0.74) {
          // 0 dB to +1 dB: Neon Orange / Warm Amber
          return isActive ? '#f97316' : 'rgba(249, 115, 22, 0.16)';
        }
        if (ratio >= 0.58) {
          // -3 dB to -6 dB: Electric Amber / Yellow
          return isActive ? '#f59e0b' : 'rgba(245, 158, 11, 0.16)';
        }
        if (ratio >= 0.42) {
          // -6 dB to -12 dB: Bright Lime & Cyan
          return isActive ? '#84cc16' : 'rgba(132, 204, 22, 0.16)';
        }
        // -∞ to -12 dB: Luminous Emerald Green
        return isActive ? '#10b981' : 'rgba(16, 185, 129, 0.15)';
      };

      const getSegmentGlow = (idx: number) => {
        const ratio = idx / (segments - 1);
        if (ratio >= 0.88) return 'rgba(239, 68, 68, 0.8)';
        if (ratio >= 0.74) return 'rgba(249, 115, 22, 0.7)';
        if (ratio >= 0.58) return 'rgba(245, 158, 11, 0.6)';
        if (ratio >= 0.42) return 'rgba(132, 204, 22, 0.6)';
        return 'rgba(16, 185, 129, 0.6)';
      };

      // Draw Channel L and Channel R segments
      for (let s = 0; s < segments; s++) {
        // Bottom-up: s=0 is bottom, s=segments-1 is top
        const segY = meterY + meterHeight - (s + 1) * (segHeight + segGap);

        // --- Left Channel Bar ---
        const isActL = s < activeSegsL;
        const isPeakL = Math.round(peakHoldL.current) === s && s > 0;
        ctx.fillStyle = getSegmentColor(s, isActL || isPeakL);

        // Glow for active peak or upper segments
        if (isActL && s >= segments * 0.6) {
          ctx.shadowColor = getSegmentGlow(s);
          ctx.shadowBlur = 4;
        } else {
          ctx.shadowBlur = 0;
        }

        // Rounded discrete segment
        drawRoundedRect(ctx, meterX, segY, barWidth, segHeight, 1.5);

        // --- Right Channel Bar ---
        const isActR = s < activeSegsR;
        const isPeakR = Math.round(peakHoldR.current) === s && s > 0;
        ctx.fillStyle = getSegmentColor(s, isActR || isPeakR);

        if (isActR && s >= segments * 0.6) {
          ctx.shadowColor = getSegmentGlow(s);
          ctx.shadowBlur = 4;
        } else {
          ctx.shadowBlur = 0;
        }

        drawRoundedRect(ctx, meterX + barWidth + barGap, segY, barWidth, segHeight, 1.5);
      }
      ctx.shadowBlur = 0; // reset glow

      // Draw dB scale text labels along the side
      if (showLabels) {
        ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const markings = [
          { label: '+3', ratio: 1.0, color: '#ef4444' },
          { label: ' 0', ratio: 0.85, color: '#f97316' },
          { label: '-3', ratio: 0.72, color: '#f59e0b' },
          { label: '-6', ratio: 0.58, color: '#84cc16' },
          { label: '-12', ratio: 0.42, color: '#10b981' },
          { label: '-24', ratio: 0.22, color: '#059669' },
          { label: '-∞', ratio: 0.04, color: '#64748b' },
        ];

        const labelX = meterX + barWidth * 2 + barGap + 4;
        for (const m of markings) {
          const markY = meterY + meterHeight - m.ratio * meterHeight;
          ctx.fillStyle = m.color;
          ctx.fillText(m.label, labelX, markY);

          // Subtle tick mark
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fillRect(meterX + barWidth * 2 + barGap + 1, markY, 2, 1);
        }
      }

      // Throttled UI state update for numerical readouts
      const now = performance.now();
      if (now - lastDbUpdate.current > 120) {
        lastDbUpdate.current = now;
        const toDb = (val: number) => {
          if (val <= 0.005) return '-∞';
          const db = 20 * Math.log10(val);
          return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
        };
        const isClipping = activeSegsL >= segments - 1 || activeSegsR >= segments - 1;
        setDisplayDb({
          l: toDb(currentLevelL.current),
          r: toDb(currentLevelR.current),
          isClipping,
        });
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [analyserL, analyserR, analyser, isPlaying, height, barWidth, barGap, segments, showLabels]);

  return (
    <div
      className={`relative flex flex-col items-center bg-[#07090f]/90 border border-white/10 rounded-2xl p-2.5 shadow-xl backdrop-blur-md select-none ${className}`}
    >
      {/* Top Header: Title & Clip LED indicator */}
      <div className="w-full flex items-center justify-between gap-1 pb-1.5 mb-1 border-b border-white/5">
        <div className="flex items-center gap-1">
          <div
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              isPlaying
                ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                : 'bg-slate-700'
            }`}
          />
          <span className="text-[9px] font-mono font-black text-slate-300 tracking-wider">
            {title}
          </span>
        </div>

        {/* Clip Alert LED */}
        <div
          className={`flex items-center gap-0.5 text-[8px] font-mono font-bold px-1 rounded transition-all ${
            displayDb.isClipping
              ? 'bg-rose-500 text-white shadow-[0_0_8px_#f43f5e] animate-pulse'
              : 'text-slate-600 bg-white/5'
          }`}
          title="Clip indicator: lights up if signal exceeds 0 dB"
        >
          <span>CLIP</span>
        </div>
      </div>

      {/* Main Canvas rendering the colourful vertical LED bars */}
      <div className="relative flex items-center justify-center">
        <canvas ref={canvasRef} className="block" />
      </div>

      {/* Bottom Channel Labels & Numerical Peak Readout */}
      {showPeakText && (
        <div className="w-full flex items-center justify-between pt-1.5 mt-1 border-t border-white/5 font-mono text-[9px]">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="font-bold text-cyan-400">L</span>
            <span className="font-bold text-amber-400">R</span>
          </div>
          <span className="text-[8px] text-slate-500 font-bold">
            {isPlaying ? displayDb.l : 'OFF'}
          </span>
        </div>
      )}
    </div>
  );
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}
