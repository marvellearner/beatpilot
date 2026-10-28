# Project Brief: AI DJ — Intelligent Music Mixing & Live Percussion System

## 1. Project Overview

Build an AI-powered DJ desktop application for Windows that allows a user to behave like a professional DJ through natural-language instructions, without needing to manually operate traditional DJ equipment.

The application should automatically mix songs, synchronise beats, create transitions, add continuous percussion such as Punjabi dhol and electronic drums, and accept commands remotely from a mobile phone.

The system should continue playing music independently of the mobile device and should support background track downloading, analysis, and queue preparation from authorised music sources.

**Primary objective:** Create a practical, locally running AI DJ application that works on an existing Windows laptop and can eventually be used at house parties.

## 2. User's Existing Hardware

- Laptop: Dell Inspiron 7591.
- RAM: 24 GB.
- Operating system: Windows.
- Mobile remote: iPhone.
- Audio output: Laptop connected to external speakers.
- Local AI inference: Preferred, to avoid recurring LLM API costs.

The exact CPU, GPU, available VRAM, and storage capacity must be detected before choosing the final AI models and audio-processing configuration.

## 3. Product Architecture

Build two connected applications.

### A. Windows Desktop Application

This is the main application and runs the audio engine.

Responsibilities:

- Music library management.
- Playback of local audio files.
- Track queue management.
- Two or more virtual DJ decks.
- Beat matching and tempo synchronisation.
- Automatic song transitions.
- Continuous percussion playback.
- Real-time mixing, equalisation, filters, and effects.
- Background downloads from permitted sources.
- Audio analysis and preparation of upcoming tracks.
- Local LLM integration.
- Mobile remote-control server.
- Optional recording and exporting of mixes.

### B. Mobile Remote Web Application

A responsive web application accessible from the iPhone browser.

Responsibilities:

- Search for and select tracks.
- Add songs to the queue.
- Send natural-language instructions.
- View the currently playing song and upcoming tracks.
- Monitor download and analysis status.
- Control playback, volume, transitions, and percussion.
- Adjust percussion intensity and volume.
- Request different musical styles and rhythms.
- Optionally allow guests to request songs with host approval.

Initially, the mobile remote should communicate with the desktop application over the same Wi-Fi network.

Do not require an App Store release for the initial version.

## 4. Core Functional Requirements

### 4.1 Music Playback

Support common local audio formats such as MP3, WAV, and FLAC, subject to the selected audio libraries.

The application must:

- Load at least two songs into separate virtual decks.
- Display track names, playback positions, and waveforms where feasible.
- Support play, pause, seek, volume, and track selection.
- Provide a unified queue.
- Keep audio playback independent of LLM response times.
- Output the final mix to the selected Windows audio device.

### 4.2 AI-Assisted DJ Mixing

The user should be able to provide instructions such as:

- "Current song is Song A; next song is Song B."
- "Mix these two songs smoothly."
- "Start the next song after the current chorus."
- "Make the transition more energetic."
- "Match the tempo and align the beats."
- "Lower the bass of the outgoing song."
- "Add an echo to the outgoing vocals."
- "Choose a compatible Bollywood track."
- "Keep the music energetic and gradually increase the tempo."

The LLM should interpret user instructions and convert them into structured, validated mixing commands.

The audio engine must execute those commands deterministically.

The LLM must not directly generate real-time audio or control audio hardware through unrestricted code execution.

### 4.3 Automatic Beat Matching and Transitions

Implement or integrate components for:

- BPM detection.
- Beat-grid estimation.
- Downbeat detection where possible.
- Musical phrase and section detection.
- Tempo adjustment.
- Beat alignment.
- Crossfading.
- Bass, midrange, and treble EQ automation.
- Filters and optional echo effects.
- Transition planning based on track analysis.

The system should consider tempo compatibility, phrase boundaries, vocal clashes, and musical key compatibility where reliable data is available.

Do not assume that matching BPM alone guarantees a good transition.

### 4.4 Continuous Percussion Layer

This is a core differentiating feature.

The user wants drums or dhol playing continuously underneath songs, even while the main tracks transition.

Implement an independent percussion deck that can play:

- Punjabi dhol loops.
- Bhangra percussion.
- Electronic kick and hi-hat patterns.
- House drum loops.
- Afrobeat-style percussion.
- Other properly licensed or user-created rhythms.

Required behaviour:

- The percussion must continue across transitions between Song A and Song B.
- Changing the main song must not restart the percussion timeline.
- Percussion tempo should synchronise with the current track when appropriate.
- The engine should support volume, mute, intensity, and rhythm selection.
- Patterns may change at musical phrase boundaries.
- Optional fills, rolls, and drops can be added in a later phase.
- Support time-stretching or suitable alternative patterns to minimise audio artefacts.

Use properly licensed percussion loops or generate original patterns. Avoid assuming that any commercial song's extracted drum stem is available for unrestricted reuse.

### 4.5 Background Track Acquisition and Preparation

The user wants to request songs from their phone while the current music continues playing.

Implement a background preparation pipeline:

1. Receive a track request from the mobile remote.
2. Identify the selected track and its source.
3. Acquire the audio only from sources that permit the intended download and processing.
4. Download to a temporary file.
5. Verify file integrity and completion.
6. Move the completed file into the managed music library.
7. Analyse BPM, beat grid, and musical structure.
8. Prepare the track for playback.
9. Mark it as ready in the queue.
10. Execute the transition when appropriate.

Downloads and analysis must never block the real-time audio thread.

The current music and continuous percussion must continue playing during downloads and analysis.

Show clear track statuses, such as:

- Searching
- Downloading
- Analysing
- Ready
- Failed

Implement retry handling, cancellation, duplicate detection, and temporary-file cleanup.

If a track is not ready when expected, continue playing the current music rather than introducing silence.

### 4.6 Music Sources

Design a source-independent music-provider interface.

Potential source categories:

- Local MP3/WAV/FLAC files.
- Music files the user has legitimately purchased or otherwise has permission to process.
- Openly licensed music.
- Licensed music catalogues that explicitly permit downloading and the intended audio manipulation.
- Approved streaming integrations for supported playback functionality.

Important limitations:

- Streaming catalogue search does not automatically grant access to raw audio.
- YouTube Music Premium offline downloads are not ordinary MP3/WAV files accessible to our own mixing engine.
- Do not assume that Spotify, YouTube Music, or another streaming API permits custom remixing or downloading.
- Verify current terms, API permissions, and licensing before implementing each provider.
- Keep provider-specific functionality isolated so that a provider can be added or removed without rewriting the mixing engine.

Do not make unsupported promises that every mainstream commercial song will be available for automatic downloading and remixing.

### 4.7 Mobile Remote Control

The phone should control the laptop rather than stream the audio through itself.

Required commands:

- Add a track.
- Remove a track from the queue.
- Change track order.
- Skip or pause.
- Change percussion rhythm.
- Adjust percussion volume.
- Request an AI-generated transition.
- Adjust the energy level.
- Enable or disable effects.

Use WebSockets or an equivalent mechanism for real-time commands and state updates.

The desktop application should remain the source of truth for playback state.

If the phone disconnects, the music must continue uninterrupted.

Implement appropriate authentication, input validation, and network-access controls. Do not expose an unauthenticated audio-control server to the public internet.

## 5. Local AI and LLM Strategy

The preferred approach is to run an LLM locally on the Dell laptop.

Initial candidates:

- Ollama as the local model runtime.
- Qwen 2.5 3B as an initial model candidate.
- Other small instruction-following models if benchmarks justify them.

The final choice must be based on actual compatibility, licensing, latency, and available CPU/GPU resources.

The application should use the local model for:

- Natural-language command interpretation.
- Converting instructions into structured mixing plans.
- Selecting among supported mixing actions.
- Explaining transition decisions.
- Suggesting suitable next tracks based on available metadata.

Example structured command:

{
  "action": "prepare_transition",
  "target_track_id": "track_b",
  "transition_style": "smooth",
  "align_beats": true,
  "match_tempo": true,
  "bass_swap": true,
  "echo_outgoing_vocals": false,
  "percussion": {
    "enabled": true,
    "preserve_timeline": true,
    "sync_to_current_track": true
  }
}

This is an illustrative schema. Define and validate a formal schema during implementation.

All commands must be validated against application state and supported engine capabilities.

The LLM must not be responsible for detecting exact beat positions on its own. Supply it with analysed metadata from the audio engine.

The application should still support manual mixing if the LLM is unavailable.

## 6. Suggested Technology Stack

Treat this as a starting proposal, not a fixed mandate. Evaluate audio latency, library maturity, licensing, and Windows compatibility before final selection.

### Frontend

- React.
- TypeScript.
- Vite.
- A responsive component system.
- Waveform visualisation where appropriate.

### Windows Desktop

- Electron for packaging the React interface as a Windows application.
- Node.js for orchestration and local services.

### Audio Engine

Evaluate suitable options for low-latency, multi-deck audio processing.

Potential approaches:

- Web Audio API and AudioWorklet for an initial browser-based prototype.
- A dedicated native audio engine for more demanding low-latency processing.
- Existing audio libraries or established DJ-engine projects where integration is feasible and their licences permit the intended use.

Do not assume a browser-based audio implementation will automatically satisfy every professional DJ requirement.

Keep audio processing isolated from UI rendering, LLM requests, downloads, and heavy analysis.

### Audio Analysis

Evaluate Python libraries and other mature audio-analysis tools for:

- BPM detection.
- Beat tracking.
- Key estimation.
- Musical structure analysis.
- Waveform generation.
- Optional vocal/instrumental stem separation.

Potential tools can include librosa and suitable stem-separation models, subject to current compatibility and licence review.

### Backend and Communication

- Node.js application services.
- WebSockets for mobile remote communication.
- Local file management.
- Background task queue.
- Persistent configuration and metadata storage.

Use a simple local database such as SQLite initially if persistence is needed.

### Local AI

- Ollama or another compatible local inference runtime.
- A small instruction-following model.
- A validated structured-command interface.

### Packaging

- Electron packaging for Windows.
- A straightforward installation and update process.
- Clear configuration for audio devices and the mobile remote.

## 7. Proposed Architecture

Keep these components logically independent:

1. User interface.
2. Mobile remote API.
3. AI command interpreter.
4. Track and library manager.
5. Music-source adapters.
6. Background download manager.
7. Audio-analysis worker.
8. Track-preparation service.
9. Main song deck A.
10. Main song deck B.
11. Independent continuous percussion deck.
12. Real-time mixer and output.
13. Playback-state manager.
14. Persistent settings and metadata.

The intended flow is:

Mobile request → validated command → track acquisition → analysis → prepared queue → transition planner → audio engine → speakers.

The independent percussion deck continues running through the entire flow.

Do not couple track downloads, model inference, or Python analysis directly to the real-time audio thread.

## 8. Development Roadmap

### Phase 1: Environment and Architecture

- Inspect the existing Windows development environment.
- Verify CPU, GPU, RAM, storage, Node.js, Python, and Git versions.
- Establish a maintainable project structure.
- Choose the initial audio engine.
- Define the audio-source abstraction and application interfaces.

### Phase 2: Basic Audio Playback

- Build the Windows desktop shell.
- Load local tracks.
- Implement two virtual decks.
- Route the audio to speakers.
- Add basic play, pause, seek, and volume controls.

Acceptance criterion: Two local tracks can be loaded and played reliably without audio dropouts during ordinary UI operations.

### Phase 3: Continuous Percussion

- Implement an independent percussion deck.
- Add a small set of properly licensed test loops.
- Synchronise percussion with the main track.
- Ensure the percussion timeline survives song transitions.
- Add volume, intensity, mute, and rhythm controls.

Acceptance criterion: Song A transitions to Song B while the percussion continues without an unintended restart or gap.

### Phase 4: Automatic Mixing

- Integrate BPM and beat-grid analysis.
- Implement tempo matching and crossfading.
- Add phrase-aware transition planning.
- Add EQ automation and basic effects.

Acceptance criterion: The app can automatically transition between suitable local test tracks.

### Phase 5: Local LLM

- Install and benchmark a local model.
- Build a structured-command interface.
- Map natural-language requests to supported actions.
- Validate commands and handle errors.
- Ensure audio continues independently of inference latency.

Acceptance criterion: A natural-language instruction triggers a safe, supported mixing operation.

### Phase 6: Background Download and Preparation

- Implement a background download queue.
- Add permitted source adapters.
- Download and validate audio files.
- Analyse tracks asynchronously.
- Show download and analysis progress.
- Prepare tracks before transitions.
- Handle failures and network loss.

Acceptance criterion: The current song and percussion continue uninterrupted while a new authorised audio file is downloaded and analysed.

### Phase 7: Mobile Remote

- Build the responsive remote-control web app.
- Establish secure local pairing.
- Implement live playback-state updates.
- Add track search, queue management, AI commands, and percussion controls.

Acceptance criterion: The user can queue a track and control the mix from an iPhone while away from the laptop.

### Phase 8: Advanced Features

- Better musical-key and phrase compatibility.
- Vocal and instrumental stem separation.
- More advanced drum-pattern generation.
- AI-assisted fills and drops.
- Recording and exporting mixes where permitted.
- Guest song requests.
- Optional DJ controller integration.
- Approved streaming integrations if feasible.

Do not attempt all advanced features before the core playback and continuous percussion system is reliable.

## 9. Non-Functional Requirements

- Music must not stop because the LLM is slow or unavailable.
- Downloads and analysis must not block audio processing.
- Avoid audible clicks and unintended gaps.
- Handle incomplete files and failed downloads safely.
- Keep memory and CPU usage appropriate for a 24 GB Windows laptop.
- Monitor latency and buffer underruns.
- Do not assume GPU acceleration is available until the hardware is verified.
- Make the application recover gracefully from network or source failures.
- Protect local files and restrict remote-control access.
- Clearly report unsupported sources and unavailable features.
- Maintain a modular, testable codebase.
- Include logging and automated tests for critical state transitions.

## 10. Instructions to the Developer AI

Act as a senior software architect and audio-software engineer.

Before implementation:

1. Inspect the actual repository and environment.
2. Identify existing code and reusable dependencies.
3. Verify the capabilities and licences of proposed libraries.
4. Identify the most difficult technical risks.
5. Propose a small, testable architecture.
6. Establish measurable acceptance criteria.
7. Report blockers before making large architectural changes.

During implementation:

- Work incrementally.
- Keep the application runnable after each milestone.
- Avoid unnecessary abstractions and overengineering.
- Do not replace the entire architecture without justification.
- Do not fabricate completed features or test results.
- Run appropriate tests and report failures honestly.
- Separate prototype functionality from production-ready functionality.
- Verify current provider permissions before implementing music-source integrations.
- Do not let AI inference, downloads, or analysis block the audio thread.
- Prioritise reliable playback and continuous percussion before advanced AI remixing.

## 11. First Deliverable

Start by producing:

1. An environment and hardware assessment.
2. A recommended audio-engine choice with trade-offs.
3. A project directory structure.
4. A list of dependencies and their licences.
5. A small implementation plan for the first milestone.
6. A runnable Windows prototype that loads two local audio tracks and plays a continuous percussion loop.

Do not begin by implementing every planned feature. First prove that the audio architecture works reliably, then add automatic mixing, local AI, background acquisition, and mobile control incrementally.

## Definition of Success

The eventual product should allow the user to:

1. Connect the Windows laptop to speakers.
2. Start a music session.
3. Control the session from an iPhone.
4. Request a new song using natural language.
5. Prepare an eligible new track in the background.
6. Automatically mix it into the current track.
7. Keep a dhol or drum layer playing continuously across transitions.
8. Adjust the style and intensity of the music without operating the laptop.
9. Continue playback if the phone disconnects or the local LLM becomes unavailable.
