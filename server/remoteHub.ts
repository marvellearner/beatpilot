/**
 * The phone-remote hub on /ws.
 *
 * One laptop tab is the host: it owns the audio, publishes SYNC_STATE / SYNC_LIVE and runs
 * commands. Phones are remotes. Any other full-app tab waits as a standby host, so a second tab
 * can't flood the phones with its own empty state or run every command twice.
 */
import type { Server as HttpServer } from 'http';
import { ServerResponse } from 'http';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { getLaptopVolume, setLaptopVolume, toggleLaptopMute, setLaptopMute } from './laptopAudio';

export function attachRemoteHub(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });
  let host: WebSocket | null = null;
  const standbyHosts: WebSocket[] = [];
  const remotes = new Set<WebSocket>();
  let lastHostState: Record<string, unknown> | null = null; // sent to a phone as soon as it connects
  const alive = new WeakMap<WebSocket, boolean>();
  // The laptop's Windows volume, owned here (not by the laptop tab). Added to every full state a
  // phone receives: the tab's own full states don't carry it, and would blank the phone's slider.
  let laptop: { laptopVolume?: number; laptopMuted?: boolean } = {};
  const laptopUpdate = (res: { volume: number; muted: boolean }) => {
    laptop = { laptopVolume: res.volume, laptopMuted: res.muted };
    const update = { type: 'SYNC_LIVE', ...laptop };
    if (lastHostState) Object.assign(lastHostState, laptop);
    sendToRemotes(update);
  };

  const send = (ws: WebSocket, msg: string | object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  };
  const sendToRemotes = (msg: string | object) => {
    for (const r of remotes) send(r, msg);
  };
  const hostGone = () => {
    host = null;
    lastHostState = null;
    // Hand over to the oldest waiting tab; the phones get its state once it starts publishing
    let next = standbyHosts.shift();
    while (next && next.readyState !== WebSocket.OPEN) next = standbyHosts.shift();
    if (next) {
      host = next;
      send(next, { type: 'ROLE', role: 'host' });
    } else {
      sendToRemotes({ type: 'HOST_GONE' });
    }
  };

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (message) => {
      const text = message.toString();
      let data: { type?: string; role?: string };
      try {
        data = JSON.parse(text);
      } catch {
        return;
      }

      if (data.type === 'HELLO') {
        if (data.role === 'host') {
          if (!host || host.readyState !== WebSocket.OPEN) {
            host = ws;
            send(ws, { type: 'ROLE', role: 'host' });
          } else {
            standbyHosts.push(ws);
            send(ws, { type: 'ROLE', role: 'standby' });
          }
        } else {
          remotes.add(ws);
          void getLaptopVolume().then((volState) => {
            laptop = { laptopVolume: volState.volume, laptopMuted: volState.muted };
            if (lastHostState) Object.assign(lastHostState, laptop);
            send(ws, lastHostState ?? { type: 'HOST_GONE', ...laptop });
          });
        }
      } else if (data.type === 'SYNC_STATE') {
        if (ws === host) {
          lastHostState = { ...(data as Record<string, unknown>), ...laptop };
          sendToRemotes(lastHostState);
        }
      } else if (data.type === 'SYNC_LIVE') {
        // The small, frequent part: merge it so a phone that connects now gets a complete, current state
        if (ws === host) {
          if (lastHostState) Object.assign(lastHostState, data, { type: 'SYNC_STATE' });
          sendToRemotes(text);
        }
      } else if (data.type?.startsWith('CMD_')) {
        if (data.type === 'CMD_SET_LAPTOP_VOLUME') {
          const vol = (data as { volume?: number }).volume;
          if (typeof vol === 'number') {
            void setLaptopVolume(vol).then(laptopUpdate);
          }
        } else if (data.type === 'CMD_TOGGLE_LAPTOP_MUTE') {
          void toggleLaptopMute().then(laptopUpdate);
        } else if (data.type === 'CMD_MUTE_LAPTOP') {
          const muted = (data as { muted?: boolean }).muted ?? true;
          void setLaptopMute(muted).then(laptopUpdate);
        }
        if (host && ws !== host) send(host, text);
      }
    });

    ws.on('close', () => {
      remotes.delete(ws);
      const i = standbyHosts.indexOf(ws);
      if (i >= 0) standbyHosts.splice(i, 1);
      if (ws === host) hostGone();
    });
  });

  // A sleeping laptop or a phone that left the Wi-Fi never sends a close; ping to notice
  let lastCheckedVol = -1;
  let lastCheckedMute = false;

  const heartbeat = setInterval(async () => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }

    if (remotes.size > 0) {
      try {
        const cur = await getLaptopVolume();
        if (Math.abs(cur.volume - lastCheckedVol) > 0.015 || cur.muted !== lastCheckedMute) {
          lastCheckedVol = cur.volume;
          lastCheckedMute = cur.muted;
          laptopUpdate(cur);
        }
      } catch {
        // ignore background poll errors
      }
    }
  }, 4_000);
  httpServer.on('close', () => clearInterval(heartbeat));
}

// Phone remote links: the laptop's Wi-Fi addresses, since "localhost" in its address bar means nothing to a phone
export function handleRemoteInfo(res: ServerResponse, httpServer: HttpServer | null) {
  const address = httpServer?.address();
  const port = address && typeof address === 'object' ? address.port : 5173;
  // Home Wi-Fi ranges first; 172.x is usually a WSL/Hyper-V/Docker adapter
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i!.address)
    .sort((a, b) => rank(a) - rank(b));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ urls: ips.map((ip) => `http://${ip}:${port}/?remote=true`) }));
}
