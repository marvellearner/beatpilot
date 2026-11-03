import React, { useEffect, useRef, useState } from 'react';
import { Zap, Sparkles } from 'lucide-react';

interface VJFillerTransitionProps {
  isTransitioning: boolean;
  transitionProgress: number; // 0 to 1
  bpm?: number;
  opacity?: number;
  className?: string;
}

type VJStyle = 'hyperspace' | 'lasers' | 'cyberpunk' | 'strobe';

const VJ_STYLES: VJStyle[] = ['hyperspace', 'lasers', 'cyberpunk', 'strobe'];

export const VJFillerTransition: React.FC<VJFillerTransitionProps> = ({
  isTransitioning,
  transitionProgress,
  bpm = 126,
  opacity = 1,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const [styleIndex, setStyleIndex] = useState(0);

  // Cycle to a new visual style on every new transition
  const wasTransitioningRef = useRef(false);
  useEffect(() => {
    if (isTransitioning && !wasTransitioningRef.current) {
      setStyleIndex((prev) => (prev + 1) % VJ_STYLES.length);
    }
    wasTransitioningRef.current = isTransitioning;
  }, [isTransitioning]);

  const activeStyle = VJ_STYLES[styleIndex];

  useEffect(() => {
    if (!isTransitioning) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let startTime = performance.now();
    let width = (canvas.width = canvas.parentElement?.clientWidth || 640);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 360);

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };
    window.addEventListener('resize', handleResize);

    // Stars / particles for hyperspace
    const numStars = 120;
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

    const render = (time: number) => {
      const elapsed = (time - startTime) / 1000;
      const beatFreq = (bpm / 60) * Math.PI * 2;
      const beatPulse = (Math.sin(elapsed * beatFreq) + 1) * 0.5; // 0 to 1 on beat
      // Intensity multiplier: speed up in middle of transition
      const intensity = 1 + Math.sin(transitionProgress * Math.PI) * 1.5;

      ctx.clearRect(0, 0, width, height);

      // 1. HYPERSPACE RAVE TUNNEL
      if (activeStyle === 'hyperspace') {
        ctx.fillStyle = '#050508';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;

        // Speed surges towards transition center
        const speed = (600 + beatPulse * 400) * intensity;

        stars.forEach((star) => {
          star.z -= speed * 0.016;
          if (star.z <= 1) {
            star.z = 1000;
            star.x = (Math.random() - 0.5) * width * 2;
            star.y = (Math.random() - 0.5) * height * 2;
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
            const prevK = 400 / (star.z + speed * 0.05);
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
        const ringRadius = (50 + beatPulse * 80) * (0.8 + transitionProgress * 0.4);
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
        ctx.fillStyle = 'rgba(5, 5, 12, 0.25)'; // slight trail
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

          // Volumetric laser beam
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

        // Horizontal lines moving forward
        for (let y = horizonY + 5; y < height; y += (y - horizonY) * 0.35 + 2) {
          const actualY = y + gridSpeed * ((y - horizonY) / (height - horizonY));
          if (actualY < height) {
            ctx.beginPath();
            ctx.moveTo(0, actualY);
            ctx.lineTo(width, actualY);
            ctx.stroke();
          }
        }

        // Perspective lines radiating from center
        for (let x = -width * 0.5; x <= width * 1.5; x += width / 12) {
          ctx.beginPath();
          ctx.moveTo(width / 2, horizonY);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        // Equalizer bar silhouettes across horizon
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
        // High impact strobe on beat
        const isStrobeFrame = beatPulse > 0.6;
        ctx.fillStyle = isStrobeFrame ? '#1e1b4b' : '#020617';
        ctx.fillRect(0, 0, width, height);

        // Chromatic RGB scan bands
        const numBands = 8;
        for (let i = 0; i < numBands; i++) {
          const bandY = ((elapsed * 200 + i * 60) % height);
          const bandHeight = 15 + Math.random() * 25;

          ctx.fillStyle = ['rgba(244,63,94,0.4)', 'rgba(6,182,212,0.4)', 'rgba(168,85,247,0.4)'][i % 3];
          ctx.fillRect(0, bandY, width, bandHeight);
        }

        // Central visualizer emblem
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

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isTransitioning, activeStyle, bpm, transitionProgress]);

  if (!isTransitioning || opacity <= 0.01) {
    return null;
  }

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
      className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-150 overflow-hidden ${className}`}
      style={{ opacity }}
    >
      {/* 60fps Generative VJ Filler Canvas */}
      <canvas ref={canvasRef} className="w-full h-full object-cover block" />

      {/* Futuristic VJ Blend HUD Indicator */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-cyan-500/30 text-[10px] font-bold tracking-wider text-cyan-300 shadow-lg select-none">
        <Zap className="w-3 h-3 text-amber-400 animate-bounce" />
        <span>VJ FILLER: {styleLabel}</span>
        <span className="text-white/40">•</span>
        <span className="text-rose-400 font-mono">{Math.round(transitionProgress * 100)}% BLEND</span>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[9px] font-semibold text-slate-300 select-none">
        <Sparkles className="w-2.5 h-2.5 text-yellow-300 animate-spin" />
        <span>STAGE TRANSITION</span>
      </div>
    </div>
  );
};

