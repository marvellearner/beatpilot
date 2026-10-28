# AI DJ — Setup, Hardware & Operations

This guide covers the host hardware, how to run the local LLM, the audio memory budget, iPhone/LAN setup and troubleshooting, party-night system settings, dependencies and licenses, and the storage policy.

---

## 1. Host Hardware (audited 2026-10-28)

**Dell Inspiron 7591**, Windows 10/11 x64

| Subsystem | Spec | Role |
| :--- | :--- | :--- |
| CPU | Intel i7-9750H, 6C/12T, 2.6–4.5 GHz, AVX2 | Audio rendering, DSP, Ollama CPU inference |
| RAM | 24 GB DDR4-2666 (~8.6 GB free under typical load) | PCM buffers plus about 2 GB of model weights |
| dGPU | GTX 1050 Mobile, 3 GB GDDR5 | **Not used for the LLM** (see §2). Used for UI/DWM only. |
| iGPU | Intel UHD 630 | Basic display |
| Storage | NVMe PCIe 3.0, 883 GB free | Audio cache and waveform data |
| Audio | Realtek HD via WASAPI, 44.1/48 kHz | 3.5 mm line out or a USB DAC to the PA |
| Network | Intel AC 9560 (Wi-Fi 5, 2×2) | LAN link to the iPhone remote |
| Runtime | Node `v24.22.1`, npm `11.19.1` | |

---

## 2. Local LLM: CPU-Only Ollama

### 2.1 Why not the GPU
Loading `qwen2.5:3b` on the GTX 1050 crashed with `0xe06d7363` (CUDA out of memory). The VRAM needed did not fit:

| VRAM consumer | Size |
| :--- | :--- |
| Q4_K_M weights | ~1.98 GB |
| 4k-token KV cache | ~0.45–0.65 GB |
| Windows DWM reservation | ~0.8–1.2 GB |
| **Total** | **~3.6 GB**, more than the card's 3 GB |

### 2.2 Decision: force CPU inference
```json
{ "options": { "num_gpu": 0, "num_thread": 8, "temperature": 0.2 } }
```
**Measured on this laptop (2026-10-28), `qwen2.5:3b` Q4_K_M, CPU only:**

| | Time |
| :--- | :--- |
| Cold start (model not yet in RAM) | ~12.6 s total, ~3.4 s of it loading the model |
| Warm answer, ~340-token prompt | ~4.2 s (prompt read 0.15 s, generation ~7 tokens/s) |
| AI DJ mix decision (~50 output tokens) | ~7 s |
| AI DJ next-song pick | ~3 s |

> The previous version of this section claimed 28 tokens/s and about 1 s per plan. That was not reproducible; the measured generation speed is about 7 tokens/s.

How the app copes with this speed:

- **Warm model:** the dev server keeps the model in RAM (`keep_alive: 30m`) and loads it as soon as the app checks AI status, so the 12 s cold start doesn't hit a mix.
- **AI never blocks the music:** the AI DJ refines decisions in the background. The analysis-based plan stands if the AI is slow or offline.
- **Background curation:** song recommendations have 20 s. They used to time out after 2.5 s, so the AI was never actually used for them.

---

## 3. Audio Latency & Memory Budget

- **Render quantum:** 128 samples, which is 2.9 ms at 44.1 kHz or 2.67 ms at 48 kHz. Audio runs on a high-priority WASAPI thread. UI and WebSocket work on the main thread cannot cause dropouts as long as audio uses native nodes and `AudioParam` automation.
- **Decoded PCM:** 44,100 × 2 channels × 4 bytes = 344.5 KB/s, so a 3.5-minute song takes about 71 MB.

| Buffer | Memory |
| :--- | :--- |
| Deck A + Deck B | ~142 MB |
| Deck P (procedural loops) | ~1.4 MB |
| 5-song pre-decoded queue | ~355 MB |
| **Total** | **~498 MB** (under 6% of free RAM) |

---

## 4. iPhone Remote & Network

### 4.1 Connect
1. Put the laptop and the iPhone on the **same, non-guest Wi-Fi network**.
2. Run `npm run dev` on the laptop.
3. In Safari on the iPhone, open `http://<laptop-LAN-IP>:5173/?remote=true`. Currently that is `http://192.168.29.190:5173/?remote=true`.
4. Optional: tap Share → **Add to Home Screen** to get a full-screen remote.

```
iPhone Safari (192.168.29.x)  ── HTTP / WS ──>  Laptop 192.168.29.190:5173 (Vite + WS + Web Audio)
                                                 └─ Ollama :11434
                                                 └─ 3.5 mm line out → PA
```

### 4.2 Firewall (run once, as Administrator)
```powershell
New-NetFirewallRule -DisplayName "AI-DJ-DevServer" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```

### 4.3 Troubleshooting
| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Safari says "server stopped responding" | Firewall is blocking port 5173 | Add the firewall rule above. |
| The devices can't see each other on the same router | Guest network or AP/client isolation | Put both devices on the main (5 GHz) network. |
| The remote disconnects when the screen locks | iOS suspends Safari after about 30 s | No action needed. The music keeps playing and the remote reconnects and resyncs when unlocked. |
| The phone's Private Wi-Fi Address rotates | iOS MAC randomisation | No effect, because the phone connects to the laptop's IP. |

### 4.4 Party-night system settings
- Set the Windows power plan to **High** or **Ultimate Performance**.
- Disable USB and Wi-Fi selective suspend.
- Set lid close (on AC power) to **Do Nothing**.

---

## 5. Storage Policy

> *"Start with local files, JSON settings and in-memory playback state. Add SQLite when track search, analysis caching and playlist management become substantial. Don't install or maintain a separate SQL server unless a future requirement genuinely needs one."*

- **Current:** in-memory playback state and queue, `data/play_history.json`, `my_songs.txt`, and decoded PCM held in RAM.
- **Future:** embedded file-based SQLite (`better-sqlite3`, `library.db`), added only if the library grows large (around 5,000+ tracks), for search and analysis caching.
- **Never:** a separate database server such as PostgreSQL, MySQL or Redis. The app must stay runnable with a single `npm run dev`.

---

## 6. Dependencies & Licenses

All dependencies use permissive licenses (MIT, ISC, Apache 2.0). Avoid adding GPL/AGPL dependencies.

| Package | Version | License | Purpose |
| :--- | :--- | :--- | :--- |
| `react`, `react-dom` | ^19.3.1 | MIT | UI |
| `ws` | ^8.22.0 | MIT | WebSocket server for the remote |
| `zod` | ^4.6.7 | MIT | LLM command validation |
| `lucide-react` | ^1.63.0 | ISC | Icons |
| `yt-search` | ^2.13.1 | MIT | YouTube metadata search (no API key) |
| `@distube/ytdl-core` | ^5.1.3 | MIT | YouTube audio stream |
| `typescript` | ^7.0.2 | Apache 2.0 | Dev: typing |
| `vite`, `@vitejs/plugin-react` | ^8.3.5 / ^6.1.2 | MIT | Dev: server and bundler |
| `tailwindcss`, `@tailwindcss/vite` | ^4.3.3 | MIT | Dev: styling |
| `@types/ws`, `@types/react`, `@types/react-dom` | — | MIT | Dev: type definitions |

### 6.1 Audio rights
- **Percussion:** all dhol and drum sounds are procedurally synthesised (`SynthesizedSamples.ts`). They are original and royalty-free, and no stems are extracted from commercial recordings.
- **Streamed tracks:** for personal use and private gatherings only. Audio is held temporarily in memory for the session and is never redistributed.
- **Provider isolation:** YouTube scraping lives only in `server/apiPlugin.ts`. If the terms change, it can be swapped for local files or a licensed API without touching the mixer or the AI. Re-check provider terms before relying on any source (see `context.md` §4.6).
