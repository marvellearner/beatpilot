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

- **Shape the night as build → dip → climb.** Build energy, dip slightly to let people breathe, then climb again. Staying at peak too long burns the crowd out; dropping too hard empties the floor.
- **Open low.** The first ~15–20% of a set settles the room and lets you read its starting energy. Don't open with your biggest songs.
- **Save the biggest anthems for the peak.** Place the most familiar, sing-along tracks where the floor is fullest.
- Treat energy as a journey, not a permanent maximum.
- Build anticipation gradually when appropriate.
- Use familiar high-energy tracks for peaks.
- Allow breathing room after intense sections.
- Do not make every transition louder, faster, or more dramatic.
- For a party, adapt to the requested vibe: warm-up, background socialising, dance floor, peak time, or wind-down.
- If actual crowd sensing is not available, do not claim to know how the crowd is reacting. Use user feedback and explicit session settings instead.

## 4. Beatmatching and Tempo

**Beatmatching has two parts, and both are required:**

1. **Same tempo:** both tracks run at the same BPM during the overlap.
2. **Same phase:** their beats land at the same moment. The incoming track starts **"on the one"**, exactly on a beat of the outgoing track.

Matching BPM without matching phase still sounds wrong. The kicks "flam" (double-hit) or "trainwreck" (fall out of step). Even a 20–30 ms offset is audible on kick drums.

**BPM must be precise.** A 1 BPM error drifts an 8-bar blend by about a quarter of a beat, which is a clear flam. Use decimal BPM (e.g. 127.96), not whole numbers.

**Tempo vs pitch.** Changing speed without key lock (time-stretching) also changes pitch:

| Speed change | Effect without key lock |
| :--- | :--- |
| ≈ 5.95% | Exactly one semitone (one musical key) |
| ~2–3% sudden change | Starts to be noticeable to many listeners; many DJs avoid long blends beyond ±2% without key lock |
| Gradual ramp over many seconds | Much less noticeable than the same change done suddenly |
| With key lock | Usually fine within about ±6%; artefacts grow beyond that |

**Practical rules:**

- Estimate BPM and beat-grid confidence before attempting precise beatmatching.
- Align beats and downbeats where musically appropriate.
- Prefer moderate tempo adjustments that preserve sound quality.
- Avoid extreme tempo changes unless explicitly requested and the result remains acceptable.
- Use high-quality time-stretching when available; monitor for artefacts.
- Account for half-time and double-time interpretations, such as 70 BPM versus 140 BPM.
- Do not rely on BPM alone: two tracks with the same BPM can have incompatible rhythmic feels.
- If reliable beat alignment is unavailable, use a musical transition that does not require precise synchronisation.
- Prefer moving the **outgoing** track's tempo gradually toward the incoming one during its last phrases (a *tempo ramp*), so the new song can play at or near its natural speed and pitch.
- After the blend, bring the new song back to its natural tempo gradually, not in one jump.

### Mixing songs with very different tempos

When tempos are too far apart to beatmatch cleanly (e.g. 95 → 128 BPM), don't force a long blend. Use one of these instead:

| Technique | How it works |
| :--- | :--- |
| **Cut on the one** | Drop the new track's first beat exactly on a downbeat of the old track, ideally at a phrase end, with little or no overlap. |
| **Echo out** | Put an echo or delay on the outgoing track, cut it, and let the echo tail carry into the new track. |
| **Breakdown / drop swap** | Bring the new track in during a beatless breakdown, intro or a cappella, where no beats can clash. |
| **Tempo ramp** | Gradually speed up or slow down over a build-up, then land the new track's drop at the new tempo. |
| **Half / double time** | Treat 70 and 140 BPM (or 85 and 170) as compatible. The beats line up every other beat. Double-time is a quick way to lift energy. |

## 5. Phrase Matching and Song Structure

Musical sections often occur in predictable phrase lengths, but the software must analyse each track rather than blindly assume a fixed structure.

**Counting basics:**

- 4 beats = 1 bar.
- Phrases are usually 8, 16 or 32 bars, and club music is often built in 16-bar phrases inside 32-bar sections.
- Changes (a new vocal, a drop, a breakdown) almost always happen at the start of a phrase.
- Bringing a track in mid-phrase can make even a perfect beatmatch sound wrong. Start the incoming track at the start of a phrase, and time the outgoing track so its phrase ends where the new one begins.

- Prefer transitions at suitable phrase boundaries, such as the end of an intro, verse, chorus, breakdown, or outro.
- Start the incoming track where its musical content makes sense.
- Avoid cutting off a key lyric, hook, or payoff unless the user asks for a quick cut or mashup.
- Avoid introducing a major drop too early if the current track has not resolved its phrase.
- Keep kick, snare, bass, and major rhythmic accents aligned when possible.
- Use shorter transitions for abrupt genre changes or incompatible arrangements.
- Use longer blends only when the tracks sustain compatible rhythms and textures.
- If section detection is uncertain, choose a conservative transition point or ask the user.

## 6. Harmonic Mixing

When reliable key estimates are available, use the **Camelot wheel**. Keys are numbered 1–12, and A = minor, B = major.

| Move | Example | Effect |
| :--- | :--- | :--- |
| Same key | 8A → 8A | Safest, seamless |
| ±1 on the wheel | 8A → 9A or 7A | Smooth; a small lift or drop in energy |
| A ↔ B | 8A → 8B | Mood change between minor and major |
| +2 | 8A → 10A | "Energy boost"; use sparingly or the set feels forced |
| +7 | 4A → 11A | Big dramatic jump; not strictly harmonic |

Tools label these moves differently (some call +1 the "energy boost"), so treat the wheel as guidance. Also:

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

- **The most important EQ rule: never play two basslines at full level at the same time.**
- Bring the incoming track in with its low EQ cut.
- Swap the basslines at a phrase change (e.g. on bar 9 or bar 17 of the blend), never mid-phrase.
- The swap itself can be quick (on one beat) or gradual (over 1–4 bars). Practise both and judge by ear.

### Choosing the transition by situation

| Situation | Transition |
| :--- | :--- |
| Same genre, tempos within a few %, beats reliable | Long beatmatched blend (8–16 bars) with a bass swap at a phrase change |
| Tempos close but vocals clash | Shorter blend: bring the new track in over the old track's instrumental or outro |
| Tempos far apart, or a genre jump | Cut on the one, echo out, or breakdown swap |
| Beat detection unreliable (acoustic, live, rubato) | No-blend transition: finish or fade cleanly, start the next on its first beat |
| Big "moment" (wedding entry, the anthem) | Clean cut or short drop into the most recognisable intro/hook |

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

- **Gain staging first.** Match each track's loudness with its gain/trim control while the EQ is flat, and use the channel fader only for the mix. Never compensate a quiet track by pushing the master.
- **Stay out of the red.** Keep level meters peaking below the red, and leave headroom on the master. Clipping sounds harsh on a PA and can damage speakers. A limiter is a safety net, not a volume knob.
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

## 19. Desi Party and Wedding Specifics

- **Wide tempo range.** Bhangra and Punjabi songs run anywhere from about 80 to 180 BPM, and Bollywood mixes in slower romantic and faster dance songs. Many neighbouring songs will be too far apart to beatmatch. Plan for clean cuts on the one and use half/double-time, rather than forcing blends.
- **Not everything blends.** Even at the same BPM, vocal-heavy Punjabi and Bollywood tracks often clash when layered. Prefer short overlaps, or bring the new song in over the old one's instrumental or dhol section.
- **Dhol is a rhythm layer, not a lead.** A live or virtual dhol anchors the rhythm under the songs. Keep it locked to the beat, keep its sub-bass out of the way of the song's 808 and kick, and duck it under important vocals.
- **Play to every age group.** Mix current hits with classics older guests know, and gauge which group is on the floor.
- **Follow the event's phases:**

  | Phase | Music |
  | :--- | :--- |
  | Arrival / cocktail | Background energy |
  | Entries and dances | Exact songs on cue, usually from the start |
  | Dinner | Lower energy |
  | Dance floor | Build → dip → climb |
  | Last song | A memorable closer |

- **Requests are cues, not commands.** Play a request when it fits the floor's energy, and queue it for a better moment when it doesn't.

## 20. Etiquette Checklist for a Decent DJ

- [ ] **No dead air.** Something is always playing; the next track is ready before the current one ends.
- [ ] **No trainwrecks.** If beats aren't matched, cut cleanly instead of blending.
- [ ] **No two basslines at once.**
- [ ] **Out of the red.** Matched levels and headroom.
- [ ] **No repeats** of the same song in a set unless requested.
- [ ] **Respect the hook.** Never cut off a chorus, drop or key lyric mid-phrase.
- [ ] **Effects in moderation.** One tasteful echo-out beats constant filters and sirens.
- [ ] **Read the room, not the plan.** Adjust to who is dancing. An empty floor at a wedding isn't always the music's fault (speeches, food, photos).
- [ ] **Look like you're enjoying it.** The crowd takes its cue from the DJ.

## 21. How AI DJ Applies These Rules (current engine)

| Rule | Implementation | Status |
| :--- | :--- | :--- |
| Precise BPM | Autocorrelation of a 5 ms onset envelope, refined on the bar peak; BPM to 0.01 (`BpmDetector.ts`) | ✅ |
| Same phase ("on the one") | Beat grid from the onset histogram peak. The incoming song is scheduled to start exactly on the outgoing song's next beat, from a cue point on its own beat grid. | ✅ |
| Same tempo, minimal pitch change | Outgoing song is ramped gradually (≤ 8%, 0.4%/s) in the 20 s before an auto-mix. The incoming song gets at most a 4% sudden change, then glides back to normal at 0.4%/s. | ✅ |
| Half / double time | 0.5×, 1× and 2× interpretations are considered when matching | ✅ |
| Tempos too far apart | No forced blend: 2 s cut, landing on the beat, at natural pitch | ✅ |
| Blend length | 8 bars when beatmatched (clamped to 8–20 s) | ✅ |
| Never two basslines | Bass swap: the outgoing low band ramps out over the first half, the incoming low band ramps in over the second half | ✅ |
| Unreliable beats → no blend | Beatmatching and on-beat starts need BPM confidence ≥ 0.6 for both songs | ✅ |
| Dhol locked to the beat | Deck P schedules every hit on the on-air song's beat grid (no loop, no drift), and follows its energy: rest / light / full / fills (MIXING_RULES.md) | ✅ |
| No repeats & no consecutive duplicates | Auto-curation excludes songs in Previously Played; no 2 consecutive songs in previously played can ever be the same (`areSongsConsecutivelySame`) | ✅ |
| Up Next queue capacity | Proactively maintains up to 50 songs seeded from favorites, most played, `my_songs.txt`, and AI recommendations | ✅ |
| Auto-added duration cap | Auto-added songs capped at 5 minutes (300 s) to preserve fast party rotation | ✅ |
| 7-skip top queue avoidance | Auto-purges song #1 if avoided 7 times while playing other tracks | ✅ |
| Thumbs down ("Don't Play Again Ever") | Permanently bans track across sessions, immediately drops from queue | ✅ |
| Speed presets | 0.5x, 0.9x, 1.0x, 1.1x, 1.2x, 1.5x presets with pitch-preserving WSOLA Key Lock | ✅ |
| No dead air | Mixes only into a **ready** song; otherwise the current song keeps playing | ✅ |
| Headroom | Master limiter at −1.5 dB threshold; per-track loudness matching not yet done | ⚠️ Partial |
| Mix at the right moment, not immediately | Mix / Next plans the blend: the best **bar** in the next 30 s (phrase starts, a drop into a calmer section, avoiding the hook and vocals) and the best entry in the new song (calm intro, drop landing as the blend ends) (`MixPointPlanner.ts`) | ✅ |
| Phrase (bar/16-bar) alignment | Bar downbeat estimated from the strongest low-end hits; phrase starts are counted from it. Reliable on songs with a clear accent on "1"; four-on-the-floor songs fall back to the first beat. | ⚠️ Heuristic |
| Harmonic mixing | Key detection not implemented | ❌ Planned |
| Key lock (tempo without pitch) | Own WSOLA time-stretch (no third-party licence) in a Web Worker, used by the Party mood to lock the set to one tempo; ±25% max | ✅ Party mood |
| Danceable party tempo | Party mood locks the set to 120–130 BPM (natural movement ~120 BPM; dance music peaks 125–130 BPM, Moelants 2002/2008) | ✅ |
| AI DJ judgement | Local Qwen 2.5 3B chooses among rule-abiding mix points, blend vs cut and length, and picks the next song for energy flow; validated, never blocks playback | ✅ |
| Vocal-aware overlaps | Vocal detection not implemented | ❌ Planned |
| Echo-out transition | Not implemented; cuts are used instead | ❌ Planned |

## Sources

Research gathered October 2026. These are practitioner sources (DJ schools, DJ software makers, DJ forums), so treat the numeric thresholds as rules of thumb.

- **Tempo, pitch and key lock:**
  - [DJTechTools — How much pitch change til the key changes?](https://forum.djtechtools.com/t/how-much-pitch-change-til-the-key-changes/47099)
  - [Mixgraph — Pitch & Tempo](https://www.mixgraph.io/tools/pitch-tempo)
  - [Mixgraph — Key lock](https://www.mixgraph.io/glossary/key-lock)
  - [DJTechTools — Tempo adjust with Keylock on](https://forum.djtechtools.com/t/tempo-adjust-with-keylock-on/54201)
- **Phrasing, EQ and bass swap:**
  - [Cursa — Bars, Phrasing, and Starting on the One](https://cursa.app/en/page/dj-mixing-foundations-bars-phrasing-and-starting-on-the-one)
  - [Cursa — EQ Use for Smooth Blends](https://cursa.app/en/page/dj-mixing-foundations-eq-use-for-smooth-blends)
  - [Violet Recording — How to Phrase Mix](https://violetrecording.com/how-to-phrase-mix/)
  - [Violet Recording — How to EQ Mix as a DJ](https://violetrecording.com/how-to-eq-mix-as-a-dj/)
  - [Digital DJ Pool — DJ EQ Mixing for Beginners](https://digitaldjpool.com/blog/dj-eq-mixing-for-beginners/)
  - [We Are Crossfader — 3 Ways To Mix House Music](https://wearecrossfader.co.uk/blog/3-ways-to-mix-house-music/)
- **Different tempos:**
  - [DJ.Studio — DJ tempo change techniques](https://dj.studio/blog/dj-tempo-change-techniques)
  - [DJ.Studio — Double and half tempo](https://help.dj.studio/en/articles/15359028-double-and-half-tempo)
  - [DJTechTools — BPM transition trick using loop out](https://djtechtools.com/2015/04/05/bpm-transition-trick-using-loop-out-move/)
  - [DJTechTools — Mixing between slower/faster songs](https://forum.djtechtools.com/t/mixing-between-slower-faster-songs/9383)
  - [Point Blank — Mixing different genres & BPM](https://www.pointblankmusicschool.com/blog/essential-dj-tips-for-mixing-different-genres-bpm/)
- **Harmonic mixing:**
  - [Mixed In Key — Change energy with the Camelot wheel](https://mixedinkey.com/workflows/change-energy-with-camelot-wheel/)
  - [Digital DJ Pool — Camelot wheel](https://digitaldjpool.com/blog/harmonic-mixing-camelot-wheel/)
  - [Signalkey — Camelot wheel](https://www.signalkey.io/tools/camelot-wheel)
- **Crowd and energy:**
  - [Elite DJ — How energy builds all night](https://www.elitedj.ca/?p=6047)
  - [Digital DJ Tips — Reading the crowd at weddings](https://digitaldjtips.com/?p=2567261)
  - [DJ Will Gill — Playlist curation tips](https://djwillgill.com/playlist-curation-tips-for-aspiring-djs/)
  - [Violet Recording — How to DJ a party](https://violetrecording.com/how-to-dj-a-party/)
- **Desi / wedding:**
  - [Anjali & The Kid — But can you mix?](https://anjaliandthekid.com/but-can-you-mix/)
  - [South Asian Wedding DJ Guide](https://dev.to/cloudpeaklabs/south-asian-wedding-dj-guide-music-and-culture-for-your-big-day-48g1)
  - [Mixgraph — BPM guide](https://www.mixgraph.io/learn/bpm-guide)

## Final Principle

**A good AI DJ does not simply mix audio; it makes musical decisions.** It understands when to build energy, when to leave space, when to preserve a hook, when to add percussion, when to avoid a forced blend, and when the best decision is to do less.
