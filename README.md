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
1. **Deck P — The Continuous Percussion & Live Dhol Layer:**
   * Runs on an independent timeline that **never stops, restarts, or glitches** across song transitions.
   * Bundles authentic procedural loops: *Punjabi Dhol Live (Chaap & Dagga)*, *Bhangra Dholak & Chimta*, *Club 4-on-the-Floor (909/808)*, and *Afrobeat Congas & Shakers*.
2. **Autonomous Drum Decision & Beat-Sync Advisor:**
   * Analyzes raw audio PCM samples using an IIR low-pass filter (40Hz–180Hz) to detect real BPM and beat confidence.
   * **Strict Sync Invariant:** If rhythmic sync confidence is below 60% or the track is an acoustic ballad, percussion is automatically held/muted to prevent clashing.
   * Automatically locks Dhol tempo precisely to the detected song tempo.
3. **5-Song Autonomous Internet Auto-Queue:**
   * Never runs out of music. If the queue has fewer than 5 songs, the AI autonomously queries the internet for culturally and energetically compatible bangers.
   * Pre-downloads and decodes the audio stream of the next song in the background before the current song finishes.
   * **Outro Auto-Mix:** When the song reaches its final 14 seconds, automatically executes a phrase-aligned bass-swap mix into the next song!
4. **Wireless iPhone Remote Control:**
   * Touch-optimized web app running in Safari on your iPhone over local Wi-Fi (`ws://` duplex WebSocket synchronization).
   * Play, Pause, Rewind 10s, Forward 10s, Previous, Next/Mix, live timeline scrubber, and Dhol intensity controls.
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
| [**`context.md`**](context.md) | Original project brief: requirements, roadmap, and definition of success. |
| [**`ARCHITECTURE.md`**](ARCHITECTURE.md) | System topology, 3-deck audio engine, BPM detection, Dhol synthesis & sync, transitions, auto-curation, viral-hook detection, UI, and WebSocket protocol. |
| [**`DJ_KNOWLEDGE_AND_MIXING_RULES.md`**](DJ_KNOWLEDGE_AND_MIXING_RULES.md) | Musical judgement: set flow, beatmatching, phrasing, harmonic mixing, transitions, percussion and vocal rules. |
| [**`SETUP_AND_OPERATIONS.md`**](SETUP_AND_OPERATIONS.md) | Hardware audit, CPU-only Ollama decision, memory budget, iPhone/LAN setup & troubleshooting, storage policy, dependencies & licenses. |

---

## 🎛️ Project Structure

```
Ai-DJ/
├── README.md                              # This master documentation
├── USER_GUIDE.md                          # Step-by-step guide for party hosts
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
│   │   ├── OllamaDJAgent.ts               # Local Qwen 2.5 3B client with heuristic fallback
│   │   └── PercussionAdvisor.ts           # Autonomous drum selection and sync evaluator
│   │
│   ├── audio/
│   │   ├── AudioEngine.ts                 # Master 3-deck coordinator and auto-DJ scheduler
│   │   ├── VirtualDeck.ts                 # Virtual Deck A & B (3-band EQ, pitch fader, waveform)
│   │   ├── PercussionDeck.ts              # Continuous Dhol & drum player (Deck P)
│   │   ├── BpmDetector.ts                 # Web Audio PCM tempo & sync confidence analyzer
│   │   ├── HighlightDetector.ts           # World's favorite viral hook & pre-roll cue detector
│   │   └── SynthesizedSamples.ts          # Procedural high-fidelity Dhol & drum buffer generator
│   │
│   ├── renderer/
│   │   ├── App.tsx                        # Main desktop DJ console and state hub
│   │   ├── components/
│   │   │   ├── PartyConsoleView.tsx       # User-friendly Party Master console (Default)
│   │   │   ├── DeckView.tsx               # Dual deck UI with waveforms and 3-band EQ kills
│   │   │   ├── PercussionBar.tsx          # Continuous Dhol deck controls and AI advisor banner
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
