import React, { useEffect, useRef, useState } from 'react';
import { Zap, Sparkles, Disc3, Pause } from 'lucide-react';
import { TrackMetadata } from '../../types';

interface VJFillerTransitionProps {
  isTransitioning?: boolean;
  transitionProgress?: number; // 0 to 1
  isPlaying?: boolean;
  bpm?: number;
  opacity?: number;
  activeTrack?: TrackMetadata | null;
  className?: string;
}

type VJStyle = 'hyperspace' | 'lasers' | 'cyberpunk' | 'strobe';

const VJ_STYLES: VJStyle[] = ['hyperspace', 'lasers', 'cyberpunk', 'strobe'];

export const VJFillerTransition: React.FC<VJFillerTransitionProps> = ({
  isTransitioning = false,
  transitionProgress = 0,
  isPlaying = true,
  bpm = 126,
  opacity = 1,
  activeTrack = null,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const virtualTimeRef = useRef<number>(0);
  const lastRealTimeRef = useRef<number | null>(null);
  const [styleIndex, setStyleIndex] = useState(0);

  // Cycle to a new visual style on every new track or transition
  const lastTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTrack?.id && activeTrack.id !== lastTrackIdRef.current) {
      lastTrackIdRef.current = activeTrack.id;
      setStyleIndex((prev) => (prev + 1) % VJ_STYLES.length);
    }
  }, [activeTrack?.id]);

  const wasTransitioningRef = useRef(false);
  useEffect(() => {
    if (isTransitioning && !wasTransitioningRef.current) {
      setStyleIndex((prev) => (prev + 1) % VJ_STYLES.length);
    }
    wasTransitioningRef.current = isTransitioning;
  }, [isTransitioning]);

  const activeStyle = VJ_STYLES[styleIndex];

  // Store continuously changing animation parameters in a ref so the render loop
  // never tears down or clears the canvas on tick updates
  const propsRef = useRef({
    isTransitioning,
    transitionProgress,
    isPlaying,
    bpm,
    activeStyle,
  });
  propsRef.current = {
    isTransitioning,
    transitionProgress,
    isPlaying,
    bpm,
    activeStyle,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.parentElement?.clientWidth || 640);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 360);

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
      drawFrame(virtualTimeRef.current);
    };
    window.addEventListener('resize', handleResize);

    // Stars / particles for hyperspace
    const numStars = 140;
    const stars = Array.from({ length: numStars }, () => ({
      x: (Math.random() - 0.5) * width * 2,
      y: (Math.random() - 0.5) * height * 2,
      z: Math.random() * 1000 + 1,
      color: ['#06b6d4', '#ec4899', '#8b5cf6', '#3b82f6', '#f59e0b'][Math.floor(Math.random() * 5)],
    }));

    // Lasers
    const numLasers = 8;
    const lasers = Array.from({ length: numLasers }, (_, i) => ({
      angle: (i / numLasers) * Math.PI * 2,
      speed: 0.8 + Math.random() * 0.8,
      color: ['#f43f5e', '#06b6d4', '#10b981', '#a855f7', '#eab308'][i % 5],
      spread: 0.3 + Math.random() * 0.4,
    }));

    const drawFrame = (elapsed: number) => {
      const currentProps = propsRef.current;
      const beatFreq = (currentProps.bpm / 60) * Math.PI * 2;
      const beatPulse = (Math.sin(elapsed * beatFreq) + 1) * 0.5; // 0 to 1 on beat
      // Intensity multiplier: speed up during transitions
      const intensity = 1 + (currentProps.isTransitioning ? Math.sin(currentProps.transitionProgress * Math.PI) * 1.5 : 0.2);

      // Always paint a solid background base before visuals to prevent any blank transparent flash
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, width, height);

      // 1. HYPERSPACE RAVE TUNNEL
      if (currentProps.activeStyle === 'hyperspace') {

        const cx = width / 2;
        const cy = height / 2;
        const speed = (500 + beatPulse * 350) * intensity;

        stars.forEach((star) => {
          if (isPlaying) {
            star.z -= speed * 0.016;
            if (star.z <= 1) {
              star.z = 1000;
              star.x = (Math.random() - 0.5) * width * 2;
              star.y = (Math.random() - 0.5) * height * 2;
            }
          }

          const k = 400 / star.z;
          const px = star.x * k + cx;
          const py = star.y * k + cy;

          if (px >= 0 && px < width && py >= 0 && py < height) {
            const size = Math.max(1, (1 - star.z / 1000) * 4 * (1 + beatPulse * 0.5));
            ctx.fillStyle = star.color;
            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);
            ctx.fill();

            // Warp speed streak lines
            const prevK = 400 / (star.z + speed * 0.04);
            const prevPx = star.x * prevK + cx;
            const prevPy = star.y * prevK + cy;

            ctx.strokeStyle = star.color;
            ctx.lineWidth = size * 0.8;
            ctx.beginPath();
            ctx.moveTo(prevPx, prevPy);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
        });

        // Pulsing center warp ring
        const ringRadius = (50 + beatPulse * 80) * (0.8 + (isTransitioning ? transitionProgress * 0.4 : 0.2));
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.4 + beatPulse * 0.5})`;
        ctx.lineWidth = 3 + beatPulse * 4;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(6, 182, 212, ${0.3 + beatPulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. FESTIVAL LASERS
      else if (activeStyle === 'lasers') {
        ctx.fillStyle = 'rgba(5, 5, 12, 0.25)';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const originY = height * 0.95;

        // Stage baseline glow
        const gradient = ctx.createLinearGradient(0, height, 0, height * 0.6);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, height * 0.6, width, height * 0.4);

        lasers.forEach((laser, idx) => {
          const osc = Math.sin(elapsed * laser.speed * intensity + idx) * laser.spread;
          const targetX = cx + Math.sin(laser.angle + osc) * width * 0.9;
          const targetY = height * 0.1 + (Math.cos(laser.angle * 2 + osc) + 1) * 0.5 * height * 0.4;

          ctx.save();
          ctx.strokeStyle = laser.color;
          ctx.lineWidth = (2 + beatPulse * 3) * intensity;
          ctx.shadowColor = laser.color;
          ctx.shadowBlur = 15 + beatPulse * 20;

          ctx.beginPath();
          ctx.moveTo(cx + (idx - numLasers / 2) * 20, originY);
          ctx.lineTo(targetX, targetY);
          ctx.stroke();
          ctx.restore();
        });

        // Crowd silhouette strobe
        if (beatPulse > 0.75) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(beatPulse - 0.75) * 0.4})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // 3. CYBERPUNK GRID HORIZON
      else if (activeStyle === 'cyberpunk') {
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, width, height);

        const horizonY = height * 0.55;

        // Neon sun
        const sunRadius = 60 + beatPulse * 15;
        const sunGrad = ctx.createRadialGradient(width / 2, horizonY, 0, width / 2, horizonY, sunRadius);
        sunGrad.addColorStop(0, '#f43f5e');
        sunGrad.addColorStop(0.7, '#ec4899');
        sunGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(width / 2, horizonY, sunRadius, Math.PI, 0);
        ctx.fill();

        // 3D Perspective Grid
        const gridSpeed = (elapsed * 120 * intensity) % 40;
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
        ctx.lineWidth = 1.5;

        for (let y = horizonY + 5; y < height; y += (y - horizonY) * 0.35 + 2) {
          const actualY = y + gridSpeed * ((y - horizonY) / (height - horizonY));
          if (actualY < height) {
            ctx.beginPath();
            ctx.moveTo(0, actualY);
            ctx.lineTo(width, actualY);
            ctx.stroke();
          }
        }

        for (let x = -width * 0.5; x <= width * 1.5; x += width / 12) {
          ctx.beginPath();
          ctx.moveTo(width / 2, horizonY);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        const numBars = 32;
        const barWidth = width / numBars;
        for (let i = 0; i < numBars; i++) {
          const barHeight = Math.abs(Math.sin(elapsed * 4 + i * 0.3)) * (horizonY * 0.6) * (0.4 + beatPulse * 0.6);
          ctx.fillStyle = i % 2 === 0 ? '#f43f5e' : '#06b6d4';
          ctx.fillRect(i * barWidth, horizonY - barHeight, barWidth - 2, barHeight);
        }
      }

      // 4. CLUB STROBE & CHROMATIC GLITCH
      else {
        const isStrobeFrame = beatPulse > 0.6;
        ctx.fillStyle = isStrobeFrame ? '#1e1b4b' : '#020617';
        ctx.fillRect(0, 0, width, height);

        const numBands = 8;
        for (let i = 0; i < numBands; i++) {
          const bandY = (elapsed * 200 + i * 60) % height;
          const bandHeight = 15 + Math.random() * 25;

          ctx.fillStyle = ['rgba(244,63,94,0.4)', 'rgba(6,182,212,0.4)', 'rgba(168,85,247,0.4)'][i % 3];
          ctx.fillRect(0, bandY, width, bandHeight);
        }

        const cx = width / 2;
        const cy = height / 2;
        const sides = 6;
        const polyRadius = (80 + beatPulse * 60) * intensity;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(elapsed * 2 * intensity);
        ctx.strokeStyle = beatPulse > 0.5 ? '#f43f5e' : '#06b6d4';
        ctx.lineWidth = 4 + beatPulse * 6;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 20;

        ctx.beginPath();
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const sx = Math.cos(a) * polyRadius;
          const sy = Math.sin(a) * polyRadius;
          if (s === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    };

    const loop = (time: number) => {
      if (lastRealTimeRef.current === null) {
        lastRealTimeRef.current = time;
      }
      const delta = Math.min(0.1, (time - lastRealTimeRef.current) / 1000);
      lastRealTimeRef.current = time;

      if (propsRef.current.isPlaying) {
        virtualTimeRef.current += delta;
      }

      drawFrame(virtualTimeRef.current);
      animFrameRef.current = requestAnimationFrame(loop);
    };

    // Render immediately (draws frame even if paused)
    drawFrame(virtualTimeRef.current);

    lastRealTimeRef.current = null;
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []); // Run continuously on canvas mount; animation loop reads latest values from propsRef

  const styleLabel =
    activeStyle === 'hyperspace'
      ? 'HYPERSPACE WARP'
      : activeStyle === 'lasers'
      ? 'FESTIVAL LASERS'
      : activeStyle === 'cyberpunk'
      ? 'CYBERPUNK MATRIX'
      : 'CLUB BASS STROBE';

  return (
    <div
      className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300 overflow-hidden ${className}`}
      style={{
        opacity,
        visibility: opacity <= 0.005 ? 'hidden' : 'visible',
      }}
    >
      {/* 60fps Generative VJ Filler Canvas (Always active instead of black screen) */}
      <canvas ref={canvasRef} className="w-full h-full object-cover block" />

      {/* Track Overlay when playing without a music video */}
      {activeTrack && !isTransitioning && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 pointer-events-none bg-black/25 backdrop-blur-[1px]">
          <div className="w-16 h-16 rounded-full bg-black/50 border border-white/20 flex items-center justify-center mb-3 shadow-2xl backdrop-blur-md">
            <Disc3 className={`w-8 h-8 text-cyan-400 ${isPlaying ? 'animate-spin [animation-duration:4s]' : ''}`} />
          </div>
          <h2 className="text-xl font-extrabold text-white drop-shadow-md tracking-tight max-w-[85%] truncate">
            {activeTrack.title}
          </h2>
          <p className="text-sm font-semibold text-slate-300 drop-shadow-sm mt-0.5 max-w-[80%] truncate">
            {activeTrack.artist}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-[10px] font-mono font-bold text-cyan-300">
              {Math.round(activeTrack.bpm)} BPM
            </span>
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-[10px] font-bold text-rose-300">
              LIVE VJ VISUALS
            </span>
          </div>
        </div>
      )}

      {/* VJ HUD Indicator */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-cyan-500/30 text-[10px] font-bold tracking-wider text-cyan-300 shadow-lg select-none z-10">
        <Zap className={`w-3 h-3 text-amber-400 ${isPlaying ? 'animate-bounce' : ''}`} />
        <span>VJ FILLER: {styleLabel}</span>
        {isTransitioning ? (
          <>
            <span className="text-white/40">•</span>
            <span className="text-rose-400 font-mono">{Math.round(transitionProgress * 100)}% BLEND</span>
          </>
        ) : (
          !isPlaying && (
            <>
              <span className="text-white/40">•</span>
              <span className="text-amber-300 flex items-center gap-1 font-mono">
                <Pause className="w-2.5 h-2.5" /> PAUSED
              </span>
            </>
          )
        )}
      </div>

      {isTransitioning && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[9px] font-semibold text-slate-300 select-none z-10">
          <Sparkles className="w-2.5 h-2.5 text-yellow-300 animate-spin" />
          <span>STAGE TRANSITION</span>
        </div>
      )}
    </div>
  );
};


