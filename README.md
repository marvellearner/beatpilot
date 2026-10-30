# AI DJ — Intelligent Dual-Deck Mixing & Continuous Live Percussion System

> **An autonomous, local-first AI DJ workstation with wireless iPhone remote control, continuous Punjabi dhol grooves, local LLM intelligence (Qwen 2.5 3B), and background YouTube/YouTube Music streaming.**

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node](https://img.shields.io/badge/Node.js-v24.22.1-green.svg)
![React](https://img.shields.io/badge/React-19.3.1-61dafb.svg)
![Ollama](https://img.shields.io/badge/AI%20Brain-Qwen%202.5%203B-purple.svg)
![Audio Engine](https://img.shields.io/badge/Audio-Web%20Audio%20API%20%2848kHz%29-rose.svg)

---

## 🎧 Overview

**AI DJ** transforms your Windows laptop into a pro-grade, autonomous DJ system that can be remotely operated from an iPhone across the room. It solves the biggest limitation of amateur and traditional DJ software: **awkward transitions, clashing basslines, and silence between tracks**.

### Core Differentiating Features:
1. **Deck P — Live Rhythm Enhancer (real dhol & percussion):**
   * Real recorded dhol, dholak, tambourine, shaker, conga and more (CC0 samples), in 7 styles from *Dhol Dhamaal* and *Dholak Keherwa* to *Club Tops* and *Afro Groove*.
   * Decides per song by itself: the AI DJ identifies the song, and the style and level follow from it, the mood and the song's own sound (lighter on songs with heavy drums or vocals, none on devotional songs).
   * Every hit is scheduled on the playing song's own beat grid, so it can't drift and follows tempo changes without changing pitch.
2. **Plays like a drummer, not a loop:**
   * Rests in intros and breakdowns, plays a light groove in verses and the full groove in choruses, with fills into big moments, all worked out from the song's audio.
   * Steps back during mixes, and rests when the beat isn't clear enough to lock on (below 50% confidence).
3. **50-Song Autonomous Queue & Multi-Tier Curation:**
   * Proactively maintains up to **50 songs** in the Up Next queue, auto-seeded from your Favorites, Most Played Bangers, `my_songs.txt`, and context-aware AI recommendations.
   * **5-Minute Duration Limit:** Never auto-adds songs longer than 5 minutes to the queue. (Explicit user searches can be any length).
   * **AI Mood Reading:** On search & play, AI reads current vibe/genre and pushes the top 5 compatible tracks to index 0 (`unshift`) so they play next.
   * **Top Queue 7-Skip Avoidance:** If song #1 is avoided 7 times in a row, it is automatically dropped from the queue with visual feedback.
   * **Thumbs Down ("Don't Play Again Ever"):** Permanently bans unwanted songs locally and on server (`/api/banned`), removing them immediately.
   * **Previously Played Strict Integrity:** Songs in Previously Played are strictly excluded from Up Next, and **no 2 consecutive songs in previously played can ever be the same**.
   * **Outro Auto-Mix:** About 22 seconds before the end, it mixes into the next song. It ramps the tempo to meet, starts the new song exactly on the beat, and does a bass swap. Songs too far apart in tempo get a clean cut on the beat.
4. **Wireless iPhone Remote Control & Expanded Tempo Controls:**
   * Touch-optimized web app running in Safari on your iPhone over local Wi-Fi (`ws://` duplex WebSocket synchronization).
   * Play, Pause, Rewind 10s, Forward 10s, Previous, Next/Mix, live timeline scrubber, Thumbs Down, and Dhol intensity controls.
   * Playback rate presets: **0.5x, 0.9x, 1.0x, 1.1x, 1.2x, 1.5x**, with key lock (preserving pitch) or vinyl mode.
5. **Instant Song Acquisition by Name or YouTube Link:**
   * Type any song name (e.g., *"Sidhu Moose Wala 295"*, *"Diljit Dosanjh Lover"*) or paste any YouTube / YouTube Music URL.
   * Tap **MIX NOW** to stream, decode, and mix into the current set with an automated bass-swap transition!
6. **Local AI Brain (Ollama + Qwen 2.5 3B):**
   * Translates natural language requests (*"Mix into Deck B with heavy dhol and kill Deck A bass"*) into strict, validated Zod mixing schemas with sub-second execution.
7. **Play the World's Most Liked Part (Viral Hook Detection & Auto-Cue):**
   * Extracts real-time audience replay heatmaps from YouTube combined with local RMS spectral energy analysis to locate the exact hook, drop, or chorus most loved by listeners worldwide.
   * Automatically cues incoming tracks to the 16-beat phrase leading into the drop, eliminating dull 45-second ambient intros.
   * Prominent `🔥 PLAY BEST PART` button on the iPhone Safari mobile remote and desktop console.
8. **Always Remembers Most Played Songs (Starter Bangers):**
   * Locally records play count and timestamps in [`data/play_history.json`](file:///c:/Users/sarth/Personal_projects/Ai-DJ/data/play_history.json).
   * Prominently presents your top most-played anthems with a one-click **"Start With This"** button in both the Party Master Console and the iPhone Mobile Remote.
9. **Custom Song List via Plain Text File ([`my_songs.txt`](file:///c:/Users/sarth/Personal_projects/Ai-DJ/my_songs.txt)):**
   * A clean, accessible text file located right in the project root. Paste any song titles or YouTube/YouTube Music links (one per line), with `#` comment support.
   * Batch-queue or immediately launch your set via the **"Load my_songs.txt"** button or edit directly inside the web application with the built-in modal editor.
   * 100% local-first storage with **zero SQL server or database maintenance**.

---

## 🚀 Quick Start Guide

### Prerequisites
* Windows 10/11 laptop (Audited on Dell Inspiron 7591: i7-9750H, 24 GB RAM).
* [Node.js](https://nodejs.org/) v20+ (Verified on Node `v24.22.1` & npm `11.19.1`).
* [Ollama](https://ollama.com/) with `qwen2.5:3b` model downloaded:
  ```powershell
  ollama pull qwen2.5:3b
  ```

### Installation & Launch
1. Clone or open the project directory:
   ```powershell
   cd c:\Users\sarth\Personal_projects\Ai-DJ
   ```
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Start the development server and API hub:
   ```powershell
   npm run dev
   ```

### Accessing the Interface
* **Laptop Desktop Console:** Open [**`http://localhost:5173/`**](http://localhost:5173/)
* **iPhone Mobile Remote:** Connect your phone to the same Wi-Fi network and open Safari to:
  ```
  http://192.168.29.190:5173/?remote=true
  ```

---

## 📁 Repository Documentation Index

| Document | Purpose & Contents |
| :--- | :--- |
| [**`USER_GUIDE.md`**](USER_GUIDE.md) | **Start here:** step-by-step guide to running a party, the controls, iPhone remote, and troubleshooting. |
| [**`MIXING_RULES.md`**](MIXING_RULES.md) | Core rules for mixing, Deck P rhythm engine, 50-song queue, previously played exclusion & consecutive deduplication, AI mood top-5 insertion, and 7-skip avoidance. |
| [**`context.md`**](context.md) | Original project brief: requirements, roadmap, and definition of success. |
| [**`ARCHITECTURE.md`**](ARCHITECTURE.md) | System topology, 3-deck audio engine, BPM detection, Live Rhythm Enhancer (Deck P), transitions, auto-curation, viral-hook detection, UI, and WebSocket protocol. |
| [**`DJ_KNOWLEDGE_AND_MIXING_RULES.md`**](DJ_KNOWLEDGE_AND_MIXING_RULES.md) | Musical judgement: set flow, beatmatching, phrasing, harmonic mixing, transitions, percussion and vocal rules. |
| [**`SETUP_AND_OPERATIONS.md`**](SETUP_AND_OPERATIONS.md) | Hardware audit, CPU-only Ollama decision, memory budget, iPhone/LAN setup & troubleshooting, storage policy, dependencies & licenses. |

---

## 🎛️ Project Structure

```
Ai-DJ/
├── README.md                              # This master documentation
├── USER_GUIDE.md                          # Step-by-step guide for party hosts
├── MIXING_RULES.md                        # Master DJ mixing rules, Deck P & queue algorithms
├── context.md                             # Original project brief & requirements
├── ARCHITECTURE.md                        # Architecture & engine specification
├── DJ_KNOWLEDGE_AND_MIXING_RULES.md       # Musical rules and mixing principles
├── SETUP_AND_OPERATIONS.md                # Hardware, network setup, storage & licenses
├── my_songs.txt                           # Custom plain text song list & playlist
├── package.json                           # Workspace configuration and dependencies
├── vite.config.ts                         # Vite dev server and API plugin integration
│
├── data/
│   └── play_history.json                  # Persistent play counts and remembered starter bangers
│
├── server/
│   └── apiPlugin.ts                       # REST API (/api/search, /api/stream, /api/history, /api/my-songs) & WebSockets
│
├── src/
│   ├── types.ts                           # Global TypeScript interfaces and Zod types
│   ├── ai/
│   │   ├── schema.ts                      # Zod validation schema for mixing commands
│   │   ├── DJAgent.ts                     # AI DJ client: Ollama (Qwen 2.5 3B), then Gemini, then rules
│   │
│   ├── audio/
│   │   ├── AudioEngine.ts                 # Master 3-deck coordinator and auto-DJ scheduler
│   │   ├── VirtualDeck.ts                 # Virtual Deck A & B (3-band EQ, pitch fader, waveform)
│   │   ├── rhythm/                        # Live Rhythm Enhancer (Deck P): sample kit, styles, arrangement, scheduler
│   │   ├── BpmDetector.ts                 # Web Audio PCM tempo & sync confidence analyzer
│   │   ├── HighlightDetector.ts           # World's favorite viral hook & pre-roll cue detector
│   │
│   ├── renderer/
│   │   ├── App.tsx                        # Main desktop DJ console and state hub
│   │   ├── components/
│   │   │   ├── PartyConsoleView.tsx       # User-friendly Party Master console (Default)
│   │   │   ├── DeckView.tsx               # Dual deck UI with waveforms and 3-band EQ kills
│   │   │   ├── RhythmPanel.tsx            # Live Rhythm Enhancer controls (laptop and phone)
│   │   │   ├── MixerSection.tsx           # Equal-power crossfader and smart transition buttons
│   │   │   └── WaveformCanvas.tsx         # 60fps real-time spectrum and waveform scrubber
│   │   └── styles/
│   │       └── index.css                  # High-contrast glassmorphic dark theme
│   │
│   └── remote/
│       └── MobileRemoteView.tsx           # Touch-optimized iPhone Safari remote controller
```

---

## 🛡️ License

This project is licensed under the MIT License (see [dependencies & licenses](SETUP_AND_OPERATIONS.md#6-dependencies--licenses)). All procedural audio samples and synthesis routines are original and royalty-free.
