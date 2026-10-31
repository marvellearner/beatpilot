import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HostSyncState, LiveSyncState, MobileAction } from '../types';
import { MobileRemoteView } from './MobileRemoteView';

/**
 * The phone remote (?remote=true). It has no audio engine of its own: it shows the
 * laptop's SYNC_STATE and sends commands, so all audio stays on the laptop.
 */
export const RemoteClient: React.FC = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const [hostState, setHostState] = useState<HostSyncState | null>(null);
  const [connected, setConnected] = useState(false);
  const [hostGone, setHostGone] = useState(false);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // The server answers with the laptop's latest state (or HOST_GONE) straight away
        ws.send(JSON.stringify({ type: 'HELLO', role: 'remote' }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'SYNC_STATE') {
            // (keep the laptop volume if this state doesn't carry it, so the slider never blanks)
            const next = data as HostSyncState;
            setHostState((prev) =>
              next.laptopVolume === undefined && prev?.laptopVolume !== undefined
                ? { ...next, laptopVolume: prev.laptopVolume, laptopMuted: prev.laptopMuted }
                : next
            );
            setHostGone(false);
          } else if (data.type === 'SYNC_LIVE') {
            // The frequent small update: merged into the last full state (queue, history… stay as they were)
            const live = data as LiveSyncState;
            setHostState((prev) => (prev ? { ...prev, ...live, type: 'SYNC_STATE' } : prev));
          } else if (data.type === 'HOST_GONE') {
            // Don't keep showing the last song as if it were still playing
            setHostState(null);
            setHostGone(true);
          }
        } catch {
          // Ignore invalid message
        }
      };
      ws.onclose = () => {
        setConnected(false);
        // Phones drop the socket when the screen locks; reconnect when it comes back
        if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const sendAction = useCallback((action: MobileAction) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action));
    }
  }, []);

  if (!hostState) {
    return (
      <div id="remote-connecting" className="min-h-screen bg-[#07090e] text-slate-300 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="w-10 h-10 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        {hostGone ? (
          <>
            <h1 className="text-base font-extrabold text-white">AI DJ isn't open on the laptop</h1>
            <p className="text-xs text-slate-400 max-w-xs">
              Open AI DJ in a browser tab on the laptop. This remote connects to it automatically.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-extrabold text-white">Connecting to the laptop…</h1>
            <p className="text-xs text-slate-400 max-w-xs">
              Make sure AI DJ is open on the laptop and both devices are on the same Wi-Fi.
            </p>
          </>
        )}
      </div>
    );
  }

  return <MobileRemoteView syncState={hostState} connected={connected} onSendAction={sendAction} />;
};
