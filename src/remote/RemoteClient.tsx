import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HostSyncState, MobileAction } from '../types';
import { MobileRemoteView } from './MobileRemoteView';

/**
 * The phone remote (?remote=true). It has no audio engine of its own: it shows the
 * laptop's SYNC_STATE and sends commands, so all audio stays on the laptop.
 */
export const RemoteClient: React.FC = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const [hostState, setHostState] = useState<HostSyncState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'SYNC_STATE') setHostState(data as HostSyncState);
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
        <h1 className="text-base font-extrabold text-white">Connecting to the laptop…</h1>
        <p className="text-xs text-slate-400 max-w-xs">
          Make sure AI DJ is open on the laptop and both devices are on the same Wi-Fi.
        </p>
      </div>
    );
  }

  return <MobileRemoteView syncState={hostState} connected={connected} onSendAction={sendAction} />;
};
