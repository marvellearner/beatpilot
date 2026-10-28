# DJ Knowledge and Mixing Rules

## Purpose

This document defines the musical judgement and operating principles the AI DJ should follow. It complements the project architecture specification: the architecture explains how the application is built; this document explains how it should behave like a thoughtful, capable DJ.

The goal is not to apply every effect to every song. The goal is to maintain musical flow, build and release energy intentionally, respect the original music, and keep the audience engaged.

## 1. Core DJ Principles

1. **Music first, effects second.** A good song choice and well-timed transition are more important than flashy effects.
2. **Keep the musical flow coherent.** Consider genre, mood, energy, rhythm, tempo, vocals, and the context of the set.
3. **Make deliberate decisions.** Every transition or effect should have a musical reason.
4. **Do not force a bad mix.** If two tracks are incompatible, choose a different transition or play one track cleanly before introducing the next.
5. **Protect the listening experience.** Avoid clipping, sudden extreme volume changes, harsh frequency build-up, accidental silence, and unwanted overlapping vocals.
6. **Respect the music.** Preserve important hooks, lyrics, drops, intros, outros, and emotional moments unless the user explicitly requests a remix.
7. **Prefer reliable simplicity.** A clean phrase-matched transition is better than a complicated transition that sounds wrong.
8. **Remain responsive to the user's intent.** User commands and manual controls override automatic creative choices, subject to safe technical limits.
9. **Keep the set moving.** Prepare upcoming tracks early, avoid unnecessary gaps, and recover gracefully when a requested track is unavailable.
10. **Never assume analysis is perfect.** BPM, beat-grid, key, vocal, and section detection may be wrong. Use confidence estimates and provide fallbacks.

## 2. Understand Each Track Before Mixing

For every track, analyse and store available metadata:

- Title, artist, duration, source, and local file path or provider identifier.
- Estimated BPM and confidence.
- Beat grid and downbeat locations.
- Musical key and confidence, if available.
- Time signature where it can be estimated reliably.
- Intro, outro, breakdown, build-up, chorus, verse, and drop regions where detectable.
- Vocal activity and likely vocal phrases.
- Energy and loudness profile over time.
- Major changes in rhythm, arrangement, and intensity.
- Clean transition regions and possible mix-in/mix-out points.
- Whether the track is already analysed and ready to play.

Do not fabricate metadata. If the system cannot confidently identify a section or key, treat it as unknown rather than pretending certainty.

## 3. Track Selection and Set Flow

Choose tracks based on the user's requested genre, artists, language, era, mood, and event context.

Consider these factors together:

- Genre and stylistic compatibility.
- Energy level and danceability.
- Tempo and rhythmic feel.
- Mood and emotional tone.
- Familiarity and sing-along potential, when known.
- Whether the next track continues, develops, or deliberately changes the current mood.
- The user's explicit requests and recent track history.

Avoid playing the same track repeatedly unless requested. Avoid abrupt genre changes unless they are intentional, useful, or requested.

### Energy management

- Treat energy as a journey, not a permanent maximum.
- Build anticipation gradually when appropriate.
- Use familiar high-energy tracks for peaks.
- Allow breathing room after intense sections.
- Do not make every transition louder, faster, or more dramatic.
- For a party, adapt to the requested vibe: warm-up, background socialising, dance floor, peak time, or wind-down.
- If actual crowd sensing is not available, do not claim to know how the crowd is reacting. Use user feedback and explicit session settings instead.

## 4. Beatmatching and Tempo

- Estimate BPM and beat-grid confidence before attempting precise beatmatching.
- Align beats and downbeats where musically appropriate.
- Prefer moderate tempo adjustments that preserve sound quality.
- Avoid extreme tempo changes unless explicitly requested and the result remains acceptable.
- Use high-quality time-stretching when available; monitor for artefacts.
- Account for half-time and double-time interpretations, such as 70 BPM versus 140 BPM.
- Do not rely on BPM alone: two tracks with the same BPM can have incompatible rhythmic feels.
- If reliable beat alignment is unavailable, use a musical transition that does not require precise synchronisation.

## 5. Phrase Matching and Song Structure

Musical sections often occur in predictable phrase lengths, but the software must analyse each track rather than blindly assume a fixed structure.

- Prefer transitions at suitable phrase boundaries, such as the end of an intro, verse, chorus, breakdown, or outro.
- Start the incoming track where its musical content makes sense.
- Avoid cutting off a key lyric, hook, or payoff unless the user asks for a quick cut or mashup.
- Avoid introducing a major drop too early if the current track has not resolved its phrase.
- Keep kick, snare, bass, and major rhythmic accents aligned when possible.
- Use shorter transitions for abrupt genre changes or incompatible arrangements.
- Use longer blends only when the tracks sustain compatible rhythms and textures.
- If section detection is uncertain, choose a conservative transition point or ask the user.

## 6. Harmonic Mixing

When reliable key estimates are available:

- Prefer compatible keys for long blends, melodic overlaps, and mashups.
- Consider relative major/minor and other harmonically compatible relationships.
- Treat key detection as guidance, not an absolute rule.
- A short, percussive, or vocal-free transition may work well even when keys differ.
- Do not reject an otherwise excellent track solely because a key estimate is incompatible or uncertain.
- If key confidence is low, do not make strong claims about harmonic compatibility.

## 7. Choosing the Right Transition

Select the transition based on the tracks and the intended musical effect.

### Smooth blend
Use when tempos, grooves, and arrangements are compatible. Blend gradually and manage frequency overlap.

### Bass swap
Reduce the outgoing track's bass as the incoming track's bass becomes prominent. Avoid playing two strong kick/bass lines at full level for too long.

### Phrase transition
Align the incoming track with a suitable phrase boundary in the outgoing track.

### Echo or filter transition
Use a short, controlled effect to create space for a transition. Avoid excessive effect tails or repeated effects that make the mix muddy.

### Quick cut
Use when a decisive change is musically appropriate, such as a genre switch, a recognisable intro, or a requested surprise.

### Loop-assisted transition
Use a short loop only when it sounds natural and does not trap an obvious vocal or awkward musical fragment.

### Mashup
Use only when the musical parts can coexist. Check tempo, key, phrasing, vocal overlap, and frequency competition. Avoid overlapping two lead vocals unless the user deliberately wants that effect.

### No-blend transition
If blending sounds poor, finish or fade the outgoing track cleanly and start the next at a suitable point. Musical judgement is more important than always blending.

## 8. Frequency, Loudness, and Audio Quality

- Avoid clipping at track, deck, bus, and output levels.
- Leave sufficient headroom and use gain staging.
- Do not assume tracks have equal perceived loudness.
- Avoid abrupt loudness jumps between tracks.
- Reduce competing bass when two tracks overlap.
- Avoid excessive low-mid build-up, harsh treble, or muddy percussion.
- Use EQ changes smoothly unless a deliberate effect calls for a sharper move.
- Keep effects controlled and avoid overloading the master output.
- Apply limiting only as needed; do not use it as a substitute for proper gain staging.
- If audio processing overloads the system, prefer stable playback and simpler effects over additional complexity.

## 9. Continuous Dhol and Percussion Layer

The percussion deck is independent from the main song decks and must continue across song transitions unless the user mutes or stops it.

### Rhythm selection
- Choose a rhythm appropriate to the requested genre and energy.
- Distinguish traditional dhol patterns, Bhangra-style percussion, electronic drums, house grooves, and other styles rather than treating all percussion as interchangeable.
- Use original, user-provided, or properly licensed loops and samples.
- Do not assume a commercial recording's drum stem may be extracted or reused without permission.

### Synchronisation
- Align the percussion with the current song's beat grid when confidence is sufficient.
- Preserve the percussion timeline when changing the main song.
- When the incoming track has a different tempo, adjust the percussion smoothly or switch at a suitable boundary to a compatible pattern or tempo variant.
- Avoid abrupt tempo jumps, pattern restarts, and audible gaps.
- If synchronisation confidence is low, prefer a rhythm that can work independently or reduce the percussion level.

### Arrangement and intensity
- Treat percussion as a supporting layer, not an obligation to play loudly at all times.
- Adjust its intensity around vocals, breakdowns, drops, and quiet sections.
- Use fills and rolls sparingly and at appropriate phrase boundaries.
- Do not add a fill over every transition.
- Avoid clashing dhol accents with strong drum hits in the main track.
- Provide independent percussion volume, mute, intensity, and rhythm controls.
- The user's manual control must take priority.

### Vocal awareness
When vocal activity can be detected reliably, consider reducing percussion intensity during important lyrics and raising it during instrumental sections or drops. Do not claim vocal detection is reliable unless confidence supports it.

## 10. Vocals and Important Musical Moments

- Avoid overlapping lead vocals unintentionally.
- Preserve recognisable hooks and important lyrics where possible.
- Do not cut off a chorus or drop merely to satisfy a default transition duration.
- Use instrumental sections for blends when they provide a cleaner opportunity.
- If a vocal clash occurs, shorten the overlap, reduce one track's level, use an instrumental section, or choose another transition.
- Effects on vocals should be intentional and restrained.
- Vocal/instrumental stem separation is optional and may introduce artefacts; use it only when it improves the result.

## 11. Continuous Playback and Reliability

The audience should not hear the application doing background work.

- Downloads, metadata retrieval, AI inference, and audio analysis must run outside the real-time audio thread.
- Keep the current track playing while the next track downloads or is analysed.
- Keep the percussion deck running independently across main-track transitions.
- Do not start a track until its audio is available and sufficiently prepared.
- If the next track is not ready, continue the current track, extend a suitable loop if safe, or use another ready track.
- If a download fails, retry according to policy or mark the track unavailable.
- Do not create silence while waiting for the LLM.
- If the mobile phone disconnects, continue playback using the current queue and settings.
- If the LLM becomes unavailable, retain manual controls and basic automatic playback.
- Avoid abrupt changes when recovering from an error.

## 12. Mobile Requests and User Control

- Validate every remote command.
- Confirm the selected track and its source before acquisition.
- Show whether a track is searching, downloading, analysing, ready, or failed.
- Let the user cancel or replace a pending request.
- Respect manual pause, skip, mute, and volume commands immediately where technically safe.
- Do not let the AI silently undo a user's manual settings.
- If an instruction is ambiguous, choose a conservative interpretation or ask a short clarification.
- Give concise feedback such as “Track is downloading,” “Ready to mix,” or “No compatible transition found.”
- Do not claim a track has been downloaded, analysed, or queued until the relevant operation succeeds.

## 13. AI Command Interpretation

The LLM should convert user intent into a constrained, structured plan.

Examples:

- “Make it more energetic” → propose a suitable next track or transition and adjust permitted settings.
- “Keep the dhol going” → ensure the percussion deck remains enabled and its timeline is preserved.
- “Lower the dhol during the vocals” → schedule a controlled percussion-volume change if vocal activity is known.
- “Mix after the chorus” → use a detected chorus boundary only when confidence is adequate.
- “Don't change the song yet” → do not schedule a transition.
- “Play something like this” → use available track metadata and user preferences; do not invent catalogue results.

Rules:

- Validate commands against a schema.
- Restrict actions to capabilities actually implemented.
- Never execute arbitrary LLM-generated shell commands or code.
- Do not fabricate track metadata or claim a transition point was detected if it was not.
- Ask for clarification when the request cannot be safely interpreted.
- Separate creative planning from precise audio scheduling.
- Keep all time-critical audio actions inside the audio engine.

## 14. Music Sources and Rights

- Use local files, user-created audio, and sources that authorise the intended downloading and processing.
- Check the current terms, API policies, and licence for each provider.
- Do not assume a streaming subscription grants raw audio access or remix rights.
- Do not bypass DRM, access controls, or provider restrictions.
- Preserve licence and attribution metadata when required.
- Ensure any exported mix follows the rights and terms applicable to its component tracks.
- Keep music-source integrations modular.

## 15. Safety, Privacy, and Network Behaviour

- Require authentication or secure pairing for mobile remote control.
- Do not expose unauthenticated control endpoints publicly.
- Validate all inputs received from the phone or music providers.
- Restrict file operations to intended library locations.
- Do not execute commands embedded in track metadata or external responses.
- Keep API keys and credentials out of logs and source control.
- Avoid uploading private music files to external AI services without explicit user consent.

## 16. Recommended Decision Order

When planning a mix, use this order:

1. Honour explicit user instructions and manual controls.
2. Ensure the next track is available, authorised, and technically playable.
3. Protect continuous playback and avoid silence.
4. Choose a musically appropriate track and transition point.
5. Evaluate beat alignment, tempo, phrase compatibility, and vocals.
6. Manage bass, loudness, EQ, and effects.
7. Preserve and synchronise the continuous percussion layer.
8. Execute the transition and monitor for clipping, dropouts, or clashes.
9. Recover gracefully if the plan fails.
10. Record useful diagnostics without disrupting playback.

## 17. Testing and Acceptance Criteria

Test using audio files that are owned by the developer or appropriately licensed.

Include tests for:

- Compatible and incompatible BPM pairs.
- Half-time/double-time BPM estimates.
- Incorrect or uncertain beat grids.
- Tracks with long intros and outros.
- Vocal overlap and vocal-free sections.
- Large loudness differences.
- Different genres and abrupt genre changes.
- Percussion continuity across transitions.
- Percussion tempo changes without unintended restarts.
- Background download during playback.
- Slow or failed downloads.
- LLM delays and failures.
- Mobile disconnection.
- Audio-device changes.
- CPU overload and buffer underruns.
- Missing or corrupt audio files.

A successful mix should be judged by audible quality, not only by whether a transition function completed.

## 18. Development Priority

Implement and verify in this order:

1. Stable playback and gain control.
2. Independent continuous percussion.
3. Basic beatmatching and crossfading.
4. Phrase-aware transitions and vocal-aware mixing.
5. Background acquisition and track preparation.
6. Local LLM command interpretation.
7. Mobile remote control.
8. Advanced effects, stem separation, and procedural percussion.

Do not implement every advanced feature at once. Keep the system modular, test each stage, and prefer a small set of reliable musical behaviours over a large number of unreliable effects.

## Final Principle

**A good AI DJ does not simply mix audio; it makes musical decisions.** It understands when to build energy, when to leave space, when to preserve a hook, when to add percussion, when to avoid a forced blend, and when the best decision is to do less.
