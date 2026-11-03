import React, { useEffect, useRef, useState, useMemo } from 'react';
import { VideoOff, Maximize2, Minimize2 } from 'lucide-react';
import { TrackMetadata } from '../../types';
import { VJFillerTransition } from './VJFillerTransition';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export function extractYouTubeVideoId(song?: { id?: string; url?: string; thumbnail?: string } | null): string | null {
  if (!song) return null;
  const match =
    song.url?.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ||
    song.id?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ||
    (song.id && /^[A-Za-z0-9_-]{11}$/.test(song.id) ? song.id : null) ||
    song.thumbnail?.match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//)?.[1];
  return match ?? null;
}

export function calculateTransitionOpacities(
  isTransitioning: boolean,
  transitionProgress: number,
  hasActiveVideo: boolean,
  hasIncomingVideo: boolean
): { activeOpacity: number; incomingOpacity: number; fillerOpacity: number } {
  if (!isTransitioning) {
    // When not transitioning, if no active video exists, show filler at 1.0 (never a black screen!)
    return {
      activeOpacity: hasActiveVideo ? 1 : 0,
      incomingOpacity: 0,
      fillerOpacity: hasActiveVideo ? 0 : 1,
    };
  }

  const p = Math.max(0, Math.min(1, transitionProgress));
  let fillerOpacity = 0;
  if (!hasActiveVideo && !hasIncomingVideo) {
    fillerOpacity = 1;
  } else if (!hasActiveVideo) {
    fillerOpacity = Math.max(0, 1 - p * 1.25);
  } else if (!hasIncomingVideo) {
    fillerOpacity = Math.min(1, p * 1.25);
  } else {
    // Both videos exist: burst filler visuals at the mix point (sin curve peaks at 1.0 at 50% blend)
    fillerOpacity = Math.sin(p * Math.PI);
  }

  const activeOpacity = hasActiveVideo ? Math.max(0, 1 - p * 1.3) : 0;
  const incomingOpacity = hasIncomingVideo ? Math.max(0, (p - 0.2) * 1.25) : 0;

  // Mathematical visual guarantee: Total visibility across active video, incoming video, and filler
  // must never drop below 1.0 under any buffer, latency, or transition scenario.
  const videoSum = activeOpacity + incomingOpacity;
  const safeFiller = Math.max(fillerOpacity, Math.max(0, 1.0 - videoSum));

  return { activeOpacity, incomingOpacity, fillerOpacity: safeFiller };
}

interface SyncedVideoPlayerProps {
  track: TrackMetadata | null;
  currentTime: number;
  isPlaying: boolean;
  playbackRate?: number;
  videoEnabled: boolean;
  onToggleVideo: () => void;
  onTogglePlay?: () => void;
  incomingTrack?: TrackMetadata | null;
  isTransitioning?: boolean;
  transitionProgress?: number; // 0 to 1
  className?: string;
}

export const SyncedVideoPlayer: React.FC<SyncedVideoPlayerProps> = ({
  track,
  currentTime,
  isPlaying,
  playbackRate = 1.0,
  videoEnabled,
  onToggleVideo,
  onTogglePlay,
  incomingTrack,
  isTransitioning = false,
  transitionProgress = 0,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const incomingPlayerDivRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const incomingYtPlayerRef = useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [activePlayerReady, setActivePlayerReady] = useState(false);
  const [incomingPlayerReady, setIncomingPlayerReady] = useState(false);
  const lastSeekSentRef = useRef<number>(0);
  const lastSeekTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const activeVideoId = useMemo(() => extractYouTubeVideoId(track), [track?.id, track?.url, track?.thumbnail]);
  const incomingVideoId = useMemo(() => extractYouTubeVideoId(incomingTrack), [incomingTrack?.id, incomingTrack?.url, incomingTrack?.thumbnail]);

  useEffect(() => {
    setActivePlayerReady(false);
  }, [activeVideoId]);

  useEffect(() => {
    setIncomingPlayerReady(false);
  }, [incomingVideoId]);

  // Load YouTube IFrame API script once if not already present
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      setApiReady(true);
      return;
    }

    const existingScript = document.getElementById('yt-iframe-api-script');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevReady) prevReady();
      setApiReady(true);
    };

    // Check periodically in case onYouTubeIframeAPIReady fired earlier
    const timer = window.setInterval(() => {
      if (window.YT && window.YT.Player) {
        setApiReady(true);
        window.clearInterval(timer);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, []);

  // Listen for fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  };

  // Initialize or re-create main active YouTube player
  useEffect(() => {
    if (!videoEnabled || !activeVideoId || !apiReady || !playerDivRef.current) return;

    let destroyed = false;

    // Destroy existing player if videoId changes
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.destroy();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
    }

    const playerContainer = document.createElement('div');
    playerContainer.id = `yt-embed-${activeVideoId}`;
    playerDivRef.current.innerHTML = '';
    playerDivRef.current.appendChild(playerContainer);

    try {
      ytPlayerRef.current = new window.YT.Player(playerContainer.id, {
        videoId: activeVideoId,
        playerVars: {
          autoplay: isPlayingRef.current ? 1 : 0,
          mute: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          start: Math.max(0, Math.floor(currentTime)),
        },
        events: {
          onReady: (event: any) => {
            if (destroyed) return;
            setActivePlayerReady(true);
            try {
              event.target.mute();
              event.target.seekTo(currentTime, true);
              if (isPlayingRef.current) {
                event.target.playVideo();
              } else {
                event.target.pauseVideo();
              }
              if (playbackRate && playbackRate > 0) {
                event.target.setPlaybackRate(playbackRate);
              }
            } catch (err) {
              console.warn('YT onReady error:', err);
            }
          },
          onStateChange: (event: any) => {
            if (destroyed) return;
            try {
              // Strictly enforce audio pause: if video tries to play while audio is paused, pause immediately
              if (!isPlayingRef.current && (event.data === 1 || event.data === 3)) {
                event.target.pauseVideo();
              }
            } catch {
              // ignore
            }
          },
        },
      });
    } catch (err) {
      console.error('Failed to create YouTube player:', err);
    }

    return () => {
      destroyed = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [activeVideoId, apiReady, videoEnabled]);

  // Handle incoming deck player during transition
  useEffect(() => {
    if (!videoEnabled || !isTransitioning || !incomingVideoId || !apiReady || !incomingPlayerDivRef.current) {
      if (incomingYtPlayerRef.current) {
        try {
          incomingYtPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        incomingYtPlayerRef.current = null;
      }
      return;
    }

    const container = document.createElement('div');
    container.id = `yt-embed-incoming-${incomingVideoId}`;
    incomingPlayerDivRef.current.innerHTML = '';
    incomingPlayerDivRef.current.appendChild(container);

    try {
      incomingYtPlayerRef.current = new window.YT.Player(container.id, {
        videoId: incomingVideoId,
        playerVars: {
          autoplay: isPlayingRef.current ? 1 : 0,
          mute: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          start: 0,
        },
        events: {
          onReady: (event: any) => {
            setIncomingPlayerReady(true);
            try {
              event.target.mute();
              if (isPlayingRef.current) {
                event.target.playVideo();
              } else {
                event.target.pauseVideo();
              }
            } catch {
              // ignore
            }
          },
          onStateChange: (event: any) => {
            try {
              // Strictly enforce audio pause on incoming deck as well
              if (!isPlayingRef.current && (event.data === 1 || event.data === 3)) {
                event.target.pauseVideo();
              }
            } catch {
              // ignore
            }
          },
        },
      });
    } catch {
      // ignore
    }

    return () => {
      setIncomingPlayerReady(false);
      if (incomingYtPlayerRef.current) {
        try {
          incomingYtPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        incomingYtPlayerRef.current = null;
      }
    };
  }, [isTransitioning, incomingVideoId, apiReady, videoEnabled]);

  // Continuous Audio-to-Video Synchronization
  useEffect(() => {
    if (!videoEnabled || !ytPlayerRef.current) return;
    const player = ytPlayerRef.current;

    try {
      // Always enforce zero sound from video
      if (typeof player.mute === 'function' && !player.isMuted?.()) {
        player.mute();
      }

      // Sync play/pause state
      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
      if (isPlaying) {
        if (state !== 1 && state !== 3) {
          player.playVideo();
        }
      } else {
        // Paused: enforce pause across any non-paused state
        if (state !== 2) {
          player.pauseVideo();
        }
      }

      // Sync playback rate
      if (playbackRate && typeof player.setPlaybackRate === 'function') {
        player.setPlaybackRate(playbackRate);
      }

      // Sync time: check drift between video time and audio time
      if (typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
        const videoTime = player.getCurrentTime();
        const drift = Math.abs(videoTime - currentTime);
        const now = Date.now();

        // If drift exceeds 0.4 seconds (or large jump like cue/best part), align immediately
        // Throttle rapid seeks to prevent jerky visual stutter
        if (drift > 0.4) {
          const isLargeJump = Math.abs(currentTime - lastSeekTimeRef.current) > 2;
          const timeSinceLastSeek = now - lastSeekSentRef.current;
          if (isLargeJump || timeSinceLastSeek > 300) {
            player.seekTo(currentTime, true);
            lastSeekSentRef.current = now;
            lastSeekTimeRef.current = currentTime;
          }
        }
      }
    } catch (err) {
      console.warn('Video sync tick error:', err);
    }
  }, [currentTime, isPlaying, playbackRate, videoEnabled]);

  // Strict Pause Enforcement Heartbeat:
  // When audio is paused, YouTube might still try to buffer and autoplay asynchronously,
  // or the user could click inside the iframe. This heartbeat guarantees video stays 100% paused.
  useEffect(() => {
    if (!videoEnabled || isPlaying) return;

    const enforcePause = () => {
      try {
        const active = ytPlayerRef.current;
        if (active && typeof active.pauseVideo === 'function') {
          const state = typeof active.getPlayerState === 'function' ? active.getPlayerState() : -1;
          if (state === 1 || state === 3) {
            active.pauseVideo();
          }
        }
        const incoming = incomingYtPlayerRef.current;
        if (incoming && typeof incoming.pauseVideo === 'function') {
          const state = typeof incoming.getPlayerState === 'function' ? incoming.getPlayerState() : -1;
          if (state === 1 || state === 3) {
            incoming.pauseVideo();
          }
        }
      } catch {
        // ignore
      }
    };

    // Run immediately when paused
    enforcePause();

    // Check periodically while paused
    const timer = setInterval(enforcePause, 200);
    return () => clearInterval(timer);
  }, [isPlaying, videoEnabled]);

  // If video is disabled, render nothing (no iframe, no network, no download)
  if (!videoEnabled) {
    return null;
  }

  const isVideoUsable = !!activeVideoId && activePlayerReady;
  const isIncomingUsable = !!incomingVideoId && incomingPlayerReady;

  // Visual crossfade opacities and VJ transition filler curve
  const { activeOpacity, incomingOpacity, fillerOpacity } = calculateTransitionOpacities(
    isTransitioning,
    transitionProgress,
    isVideoUsable,
    isIncomingUsable
  );

  return (
    <div
      ref={containerRef}
      id="synced-video-display-container"
      onClick={() => onTogglePlay?.()}
      title={isPlaying ? 'Click to Pause' : 'Click to Play'}
      className={`relative w-full rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl flex flex-col items-center justify-center aspect-video select-none group cursor-pointer ${className}`}
    >
      {/* Dynamic VJ Filler Video / Visuals: Always active instead of black screen */}
      <VJFillerTransition
        isTransitioning={isTransitioning}
        transitionProgress={transitionProgress}
        isPlaying={isPlaying}
        bpm={track?.bpm || incomingTrack?.bpm || 126}
        opacity={fillerOpacity}
        activeTrack={track}
      />

      {/* Active Deck Video Stream (zero download: streamed via YouTube CDN) */}
      {activeVideoId && (
        <div
          ref={playerDivRef}
          id="yt-active-player-wrapper"
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:object-cover [&>iframe]:pointer-events-none"
          style={{ opacity: isVideoUsable ? activeOpacity : 0 }}
        />
      )}

      {/* Incoming Deck Video Stream (for smooth visual crossfade during DJ transition) */}
      {isTransitioning && incomingVideoId && (
        <div
          ref={incomingPlayerDivRef}
          id="yt-incoming-player-wrapper"
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:object-cover [&>iframe]:pointer-events-none"
          style={{ opacity: incomingOpacity }}
        />
      )}

      {/* Subtle overlay gradient at top & bottom for controls */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

      {/* Top Overlay Controls Bar */}
      <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 pointer-events-auto">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold text-rose-300">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span>SYNCED LIVE VIDEO</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="p-1.5 rounded-lg bg-black/60 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10 backdrop-blur-md transition-all shadow-md"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen / Projector Mode'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Video Toggle Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVideo();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-[10px] font-bold backdrop-blur-md transition-all shadow-md"
            title="Turn video off (saves bandwidth)"
          >
            <VideoOff className="w-3 h-3" />
            <span>Hide Video</span>
          </button>
        </div>
      </div>

      {/* Bottom Track Title Overlay (visible in fullscreen) */}
      {isFullscreen && track && (
        <div className="absolute bottom-4 left-4 right-4 p-3 rounded-xl bg-black/70 backdrop-blur-md border border-white/15 text-white flex items-center justify-between z-10">
          <div className="truncate">
            <h3 className="text-base font-extrabold truncate">{track.title}</h3>
            <p className="text-xs text-slate-300 truncate">{track.artist}</p>
          </div>
          <div className="text-xs font-mono font-bold text-cyan-300 shrink-0 ml-4">
            {Math.round(track.bpm)} BPM
          </div>
        </div>
      )}
    </div>
  );
};
