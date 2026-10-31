> **Which document is which.** This file holds the app's concrete rules: the numbers and algorithms the engine follows (BPM limits, Deck P, queue and lookahead rules), which the code and UI cite. The general DJ craft behind them, with sources, is in [DJ_KNOWLEDGE_AND_MIXING_RULES.md](DJ_KNOWLEDGE_AND_MIXING_RULES.md); the "Top 10" below is the short version of its §4–§10. When the two disagree, this file describes what the app does.

# Top 10 Rules for Mixing Any Two Songs

## 1. Match the BPM (Tempo)
- Keep both songs at compatible speeds so their beats don't clash.
- Adjust the tempo of one track to match the other.
- Use half-time or double-time matching when appropriate.
- Prefer smaller tempo adjustments for a more natural sound.

## 2. Align the Beats
- Synchronize the kick drums and main beats of both songs.
- Use beatgrids and beatmatching to prevent beats from drifting apart.
- Ensure the beats remain synchronized throughout the transition.

## 3. Mix at the Right Phrase
- Align the start of the incoming song with a suitable musical phrase in the outgoing song.
- Common phrase lengths are 8, 16, or 32 beats.
- Prefer transitions at intros, outros, breakdowns, and phrase boundaries.
- Avoid starting the incoming track at an awkward point in the musical arrangement.

## 4. Check Key Compatibility
- Analyze the musical key of both songs.
- Prefer compatible keys when blending melodic sections.
- Songs in the same key, adjacent Camelot keys, or relative major/minor keys often work well together.
- Avoid overlapping melodies that create noticeable dissonance.
- Treat harmonic compatibility as a guideline, not a strict rule.

**In this app** (`src/audio/KeyDetector.ts`): each song's key comes from a chroma profile (120 spectra across the song) matched to KeyFinder's key profiles, in Camelot notation. Tested on 40 cached songs: at a confidence of 0.3 or more (19 songs), the key from the first half and second half of every song agreed; below that, results weren't stable, so **the app only uses keys from 0.3 up** and ignores the rest. Two of three songs with published keys came out as a compatible neighbour (Despacito: relative major; Titanium: one step), one was off (Blinding Lights), so the key is a guideline:
- Keys are compared **as heard**: without key lock a deck's speed shifts pitch (6 % ≈ one semitone), so the incoming song is judged at its beatmatch speed.
- **Camelot Key Badges & Tags**: Displayed on every track in Up Next queue (`8A Am`, `8B C`, `9A Em`), Decks, and Now Playing.
- **Color-Coded Harmonic Compatibility**:
  - `Harmonic ±0` / `To Major ✨` / `To Minor 🌙` (Emerald): Exact match or relative major/minor sharing the same notes for seamless tonal blend.
  - `Energy +1 ⚡` (Gold / Amber): +1 Camelot step clockwise (adds 1 sharp) to raise room energy smoothly.
  - `Deep -1 🌊` (Cyan): -1 Camelot step counter-clockwise (adds 1 flat) for a smooth chill/deep groove.
  - `Drop Jump 🚀` (Purple): +1 Semitone modulation for dramatic climax drop transitions.
  - `Clash ⚠️` (Rose): Key clash (3+ steps); blend is kept to **4 bars** and the outgoing song leaves through a **filter sweep**: a high-pass rises from fully open to ~1.5 kHz over the blend, so it thins to a hiss instead of its harmony rubbing against the new key (`VirtualDeck.scheduleFilterSweepOut`). A cut echoes out instead. See [MusicRadar: EQ and filter tricks](https://www.musicradar.com/news/eq-and-filter-tricks-for-djs).
- **Energy-Shift Mixing**: Tag transitions in the header and status line with their exact harmonic relationship (e.g. `⚡ Energy +1 (8A → 9A)`).
- **One-Click Harmonic Queue Reordering (`🪄 Harmonic Flow`)**: Automatically sorts the 50-song queue into a continuous, clash-free Camelot wheel wave starting from the currently playing track.
- **Next song:** the AI DJ sees which ready songs' keys fit. Without the AI, if the next song clashes and one of the two after it fits, that one plays first (guest requests are never skipped).

## 5. Avoid Bass Clashes
- Avoid playing two strong kick drums and basslines together for too long.
- Reduce the incoming track's bass during the initial transition.
- Gradually swap the bass from the outgoing track to the incoming track.
- Use EQ controls to maintain a clean, powerful low end.

## 6. Match the Energy and Mood
- Consider the intensity, mood, genre, and danceability of both songs.
- Prefer transitions between tracks with compatible energy levels when a smooth mix is desired.
- Use breakdowns or gradual transitions when moving between very different energy levels.
- Allow intentional energy changes when they improve the musical experience.

## 7. Choose the Right Transition Length
- Short transition: approximately 2–8 seconds.
- Standard blend: approximately 8–16 seconds.
- Long blend: approximately 16–32 seconds or longer.
- Adapt the duration to the genre, song structure, and transition style.
- Do not apply the same crossfade duration to every song pair.

## 8. Avoid Vocal Clashes
- Avoid overlapping two prominent vocal sections unless the overlap sounds intentional.
- Prefer transitions between vocal phrases.
- Use instrumental sections or breakdowns when available.
- Reduce or remove the outgoing vocals before introducing prominent vocals from the incoming track.
- Consider vocal separation when an instrumental transition is needed.

**In this app** (`planMix` in `src/audio/MixPointPlanner.ts`): each candidate exit and entry gets a vocal-activity value: the 300 Hz–3 kHz band's share of the loudness over the blend window, relative to the song's own average share (so a loud chorus without singing doesn't count). The exit and entry are chosen **as a pair**, and pairs where both sides sing lose 3 points (an 8-bar phrase start is worth 1). On 24 real song pairs this halved the blends with two vocals at once (10 → 5) while giving up 0.08 points of phrase/energy score on average; the remaining 5 had vocals in every candidate window. The status line says *"chosen so the two vocals don't overlap"* when it made a difference. This is a vocal/lead *proxy* from the frequency band, not true vocal separation.

## 9. Choose the Right Entry and Exit Points
- **Never start from the hook because buildup is also important:** Incoming and first songs must build up naturally from where the music begins (skipping initial dialogue/conversation skits). Do not jump straight into the hook or chorus drop. *(In Best Parts mode the incoming song enters later, in the build-up 16–4 bars before its hook, but still never at the hook: see "Best Parts Mode".)*
- Identify suitable intro, outro, breakdown, and instrumental sections.
- Avoid introducing a loud vocal or drop over another prominent section unless intentional.
- Use cue points and phrase markers to identify suitable transition positions.
- Select entry and exit points based on musical structure, not just elapsed time.

## 10. Match Loudness and Prevent Clipping
- Match the perceived loudness of both tracks.
- Adjust gain levels to avoid sudden volume jumps.
- Prevent clipping and distortion at the master output.
- Maintain a consistent listening level throughout the transition.
- Do not rely on the master volume alone to fix an unbalanced mix.

**In this app** (`src/audio/Loudness.ts`): each song's loudness is the RMS level of its loud parts (75th percentile of its 0.1 s frames). On 40 cached songs it tracked the EBU R128 meter (LUFS) with a correlation of 0.89. Every deck has a trim stage before its volume fader that brings the song to the library median (−9.5 dB, about −8.3 LUFS): at most +4 dB of boost (more would just drive the limiter) and −6 dB of cut. It is set when a song loads and glides in over half a second if the song is analysed later.

**Cuts:** when two songs can't be beatmatched (or the AI DJ chooses a cut), the outgoing song **echoes out**: its last beat feeds a dotted-eighth echo at its own tempo, the repeats fade over about 3 s through a high-pass sweep (300 Hz → 3 kHz) so they thin out under the new song's bass. The echo goes straight to the master bus, so it rings on after the crossfader has cut the dry signal.

---

# Recommended AI DJ Mixing Workflow

1. Analyze both songs for BPM, key, beatgrid, phrase structure, vocals, energy, and loudness.
2. Identify compatible transition points in both tracks.
3. Select the best transition strategy based on musical compatibility.
4. Align the beats, tempo, and musical phrases.
5. Blend the tracks using appropriate EQ, volume, and vocal controls.
6. Match perceived loudness and prevent clipping.
7. Evaluate the transition for beat clashes, vocal overlap, awkward gaps, and sudden changes.
8. Refine the transition until the result sounds natural.

# Handling Incompatible Songs

When two songs have very different tempos, keys, energy levels, or vocal arrangements, do not force a long, seamless blend.

Consider alternative techniques:
- Quick crossfade
- Echo-out transition
- Breakdown transition
- Drop swap
- Beat switch
- Instrumental transition
- Intentional cut on a beat or phrase boundary

The best transition is the one that sounds musically intentional, not necessarily the one with the longest overlap.

# Suggested Transition Modes for an AI DJ App

## Smooth Mix
- Match BPM and align beats.
- Align musical phrases.
- Gradually transition volume and EQ.
- Minimize vocal and bass clashes.

## Quick Mix
- Use a short transition.
- Select compatible beat or phrase boundaries.
- Minimize unnecessary overlap.
- Preserve momentum and energy.

## Creative Mix
- Use drop swaps, echo effects, beat switches, or vocal transitions.
- Apply effects only when they improve the transition.
- Prioritize musical timing and intentionality.

# Core Principle

A good transition must sound natural, maintain musical timing, control competing frequencies, and preserve the intended energy of the music. BPM matching alone is not enough; phrase alignment, vocal compatibility, song structure, and transition selection are equally important.

---

# Live Rhythm Enhancer (Deck P)

A layer of real dhol, dholak and percussion played on top of the song on air. It is on by default and needs no musical choices: for every song it decides by itself whether drums play, which style and how loud (§5). It is a supporting layer: it follows the song's beat and structure, steps back during mixes, and rests whenever it can't play in time. Code: `src/audio/rhythm/`.

## 1. Sound: real recorded samples

- Every hit is a real recording (CC0 one-shots, sources in `public/percussion/CREDITS.md`): dhol bass side (dagga), dhol stick crack, dholak bass and treble heads, stick, tambourine, shaker, maraca, clap, 909-style kick, conga and frame drum.
- Most sounds have 3–4 takes, rotated so the same take never plays twice in a row.
- Each hit varies by up to ±8 % in velocity and ±3 ms in timing (±1 ms on the downbeat) so it doesn't sound machine-made. Ghost notes play clearly softer than accents.
- **Bass management:** the dhol and dholak bass are high-passed at 70–75 Hz, the tops (crack, tambourine, shaker) from 200–600 Hz, so the layer stays out of the song's kick and 808. Only **Club Drive** adds a kick, and it is meant for songs whose own kick is weak or missing.
- Each sound has its own level and stereo position; a gentle compressor glues the layer before it joins the master bus (so the master EQ and limiter apply to it too).
- Dholak Keherwa plays authentic, clean dholak tones without any metallic chimta / tambourine layer.

## 2. Timing: locked to the song's beat grid

- Nothing loops. Every hit is scheduled individually on the audio clock about 0.2 s ahead, at the exact time its step falls in the **on-air song's own beat grid** (BPM and downbeat in song seconds, mapped through the deck's start time and playback rate).
- So it **cannot drift**, follows tempo changes, key-lock re-timing and set-tempo glides, and never changes pitch. Hits land within the ±3 ms humanize window of the grid.
- After a seek, pause or new song it drops the hits already scheduled and re-locks on the next beat step (within ~0.1 s).
- Songs above 140 BPM (e.g. 170–180 BPM bhangra) get the groove at **half-time**, which is how a dhol player would play them.
- **Rule:** if the song's beat confidence is below 50 %, or its tempo is outside 70–200 BPM, the layer **rests** and says why. Drums that aren't locked to the beat ruin the music.

## 3. Arrangement: when it plays and how much

With **Follows song** on (the default), each 4-bar phrase gets a level from the song's loudness, compared with the song's loud parts (90th percentile of its phrases, i.e. the choruses):

| Phrase loudness vs. the choruses | Level | Typical part |
| :--- | :--- | :--- |
| Under 50 % | **Rest** (no drums) | Intro, breakdown, outro, spoken parts |
| 50–88 % | **Light groove** | Verse, pre-chorus |
| 88 % and up | **Full groove** | Chorus, drop |

- A single phrase that differs from both neighbours is smoothed out, so a loud bar in a verse doesn't trigger the chorus groove.
- Before the music starts (spoken intro skipped by the intro detector) it always rests.
- The phrase holding the song's hook plays the full groove if it is at least 70 % as loud as the choruses.
- The last phrase of the song drops to the light groove, leaving the ending to the mix.
- **Fills:** the last bar before a bigger section (rest → groove, light → full) is a fill, and so is the end of every 8 bars of full groove. A fill keeps the full groove underneath.
- Changes happen only on bar lines; a new style starts on the next bar line.
- With **Steady** chosen instead, it plays the full groove wherever the music plays, with a fill every 8 bars.

**During mixes:** in a beatmatched blend it drops to the light groove (no fills); in a cut between songs of different tempos it rests. When the new song is on air it locks onto that song's grid.

## 4. Styles

| Style | Feel | Suits |
| :--- | :--- | :--- |
| **Dhol Dhamaal** | Peak-time: a boom on every beat and driving cracks | High-energy Punjabi and Bollywood bangers |
| **Dholak Keherwa** | The 8-beat keherwa (dha ge na ti na ka dhi na) on dholak, lighter than dhol | Bollywood, sangeet, folk, mid-tempo desi |
| **Clap & Tambourine** | Claps on 2 and 4 with a tambourine shuffle, no low end | Pop, Bollywood, songs with strong drums of their own |
| **Club Tops** | House-style shaker and claps, no kick | House, EDM, dance remixes |
| **Club Drive** | Four-on-the-floor kick, claps and shaker | Songs with soft or no drums |
| **Afro Groove** | Congas, son clave on sticks, shaker, soft frame-drum pulse | Afrobeats, amapiano, reggaeton, Latin |
| **Light Shaker** | Soft shaker and maraca | Chill, romantic, acoustic |

Each style has a light, a full and a fill version (16-step bars in `src/audio/rhythm/styles.ts`).

## 5. Who decides what plays on each song

With **🤖 AI decides** (the default) every song gets its own plan when it is analysed, well before it plays (`src/audio/rhythm/rhythmPlan.ts`):

1. **Which song is it?** The song's language (Punjabi, Hindi, English, Spanish, other) comes from:
   - **Known artists and scripts first:** Gurmukhi or Devanagari in the title, or a well-known artist or title word (Diljit, Sidhu Moose Wala, Karan Aujla, Arijit, Badshah, bhangra, reggaeton…). These are certain, and the AI isn't asked.
   - **Otherwise the AI DJ** (local Qwen 2.5 3B, or Gemini when it is the active backend), asked once per song with the answer limited to one of those languages. Answers are remembered across sessions.
   - **Until the AI answers, or if it is offline:** a guess (a plain Latin-alphabet title counts as English).
2. **Does it get drums?** No when the beat confidence is below 50 %, when the title marks it as devotional (chalisa, aarti, bhajan, shabad, gurbani, kirtan, naat…), or when it is slower than 75 BPM outside the Party and Bhangra moods.
3. **Which style?**

   | Mood | Punjabi | Hindi | Spanish | English / other |
   | :--- | :--- | :--- | :--- | :--- |
   | Party | Dhol Dhamaal | Dholak Keherwa | Afro Groove | Club Tops at 118–132 BPM, otherwise Clap & Tambourine |
   | Bhangra | Dhol Dhamaal | Dholak Keherwa | Afro Groove | Dhol Dhamaal |
   | Normal | Dhol Dhamaal | Dholak Keherwa | Afro Groove | Clap & Tambourine |
   | Chill, Romantic | Dholak Keherwa | Dholak Keherwa | Light Shaker | Light Shaker |

4. **How loud, from the song's own sound** (thresholds calibrated on 60 songs from the app's cache):
   - **Hard-hitting drums already** (low-end punch above ~0.13, e.g. *295*, *Morni*, *Dope Shope*): level 0.5, and Dhol Dhamaal becomes Dholak Keherwa, so the dhol doesn't pile on top of the song's own drums.
   - **Vocal-heavy** (mid-band share above 0.58): at most 0.55.
   - **Soft drums at a party** (punch below ~0.095, non-desi songs): **Club Drive**, adding a kick, at 0.8.
   - Otherwise 0.7 (0.45 in Chill and Romantic).

The card shows the plan, who identified the song (**🤖 AI**, **Known artist** or **Guess**) and why, e.g. *"Punjabi song, party mood: Dhol Dhamaal, kept light (its drums are already strong)"*. A plan that changes while a song plays (the AI answered late) switches on the next bar line. AI questions about songs wait while a mix or next-song question is in flight, because those are time-critical.

**Why the AI identifies the song but doesn't pick the style.** Tested on 20 real songs with the app's local model, qwen2.5:3b:

- Asked for the style directly, it put dhol on nearly every song, called *Blinding Lights* and *Titanium* "bhangra", gave every song the same level, ignored the audio facts, and took 15–38 s per song.
- Asked only for the language, with the answer limited to one value, it was right for 17 of 20 songs in about 3 s. Its misses (*295*, *Mundian To Bach Ke* as Hindi) are songs the known-artist list already gets right.
- With both combined, all 20 came out right, and the AI was only needed for 9 of them (about 1.2 s each).

The style table and the audio rules above make the musical decision.

**Known limitation:** slow love songs (e.g. *Tum Hi Ho*) aren't recognised as ballads. The model's answer to "is it a slow or sad song?" was unreliable, and there were no ballads in the cache to calibrate an audio test on. In Party mood such a song gets the mood's normal style.

**Choose myself** switches to manual: one style (any of §4) for every song, with **Follows the song** or **Steady all song**.

## 6. Controls

On/off, **🤖 AI decides / Choose myself**, volume (0–100 %, multiplied by the plan's level in AI mode) and mute; the style list and Follows/Steady only in **Choose myself**. The same panel is on the laptop (Party and Pro views) and on the phone remote. Typed commands work too ("add dhol", "dholak", "stop the drums"; choosing a style this way switches to manual). Settings, including on/off, are remembered in this browser. The **Bhangra** mood also switches the layer on.

---

# Top Bangers (Quick Starters) Rules

1. **Strict Exclusion of Active and Played Songs:**
   - Top Bangers must **never** display any song that is currently present in the **Up Next queue**, currently playing **on air**, or in the **Previously Played** history.
   - Prevents duplicate song selections and ensures all recommended bangers are fresh and ready for selection.

---

# Manual Mix & 45-Second Lookahead Window Rules

1. **45-Second Lookahead Window for Manual Mix Triggers:**
   - When a song is playing and the user triggers a mix (by clicking **"MIX"** on an Up Next queue song or clicking **"Next / Mix"** in the transport controls), the engine searches up to the next **45 seconds** of the playing song (`MANUAL_MIX_LOOKAHEAD_SECONDS = 45`) for the optimal musical transition point.
   - The engine evaluates bar starts across this 45-second window, prioritizing 8-bar / 4-bar phrase boundaries, energy breakdowns, section drops, or vocal-light stretches to plan the exit.
   - The UI displays a live countdown banner: `Mixing into "{song}" in Xs (following MIXING_RULES.md): {reason}` ($X \le 45\text{s}$) with the planned entry timestamp and an instant **"Mix now"** button.

2. **Strict Adherence to MIXING_RULES.md (When "Mix now" is NOT clicked):**
   - If the user does **not** click "Mix now", the planned transition **must strictly follow all 10 Mixing Rules**:
     - **Rule 1 (Match BPM):** Rates matched seamlessly within safe pitch-shift limits (or half/double time).
     - **Rule 2 (Align Beats):** Beats and downbeat grids locked with sample-accurate audio scheduling.
     - **Rule 3 & 9 (Phrase Boundary Exit & Intro Buildup Entry):** Blend initiates on the planned 4/8-bar phrase or breakdown exit within the 45s window. The incoming song enters at `musicStartTime` (skipping dialogue/conversation skits) to allow natural musical buildup, **never starting from the hook**. In Best Parts mode it enters in the build-up 16–4 bars before its hook instead.
     - **Rule 5 (Avoid Bass Clashes):** Smooth EQ bass swap ramp executed over the transition (outgoing low EQ drops before incoming low EQ rises) to keep the low end punchy without dual-kick phase cancellation.
     - **Rule 6 & 7 (Energy & Transition Length):** Transition length adapted to the genre/tempo (4 Bhangra, 8 Normal/Party, 16 Chill/Romantic bars).
     - **Rule 8 (Avoid Vocal Clashes):** Vocal energy envelope analysis (`profile.mid`) avoids clashing vocal lines.
     - **Rule 10 (Loudness Matching & Limiting):** Perceived loudness normalized and master limiter prevents clipping distortion.

3. **"Mix Now" Immediate Override:**
   - If the user explicitly clicks **"Mix now"** (or clicks the active song's "MIX NOW" button / presses Next during the countdown):
     - The phrase countdown is immediately bypassed.
     - The transition starts on the very next beat grid downbeat, preserving beatmatching and bass swap while fulfilling the user's explicit request for an immediate transition.

---

# Music Start and End Rules (Skipping the Wasteful Parts)

These apply always, with or without Best Parts. Both are decided from the audio alone, when a song is analysed (`analyzeTrack`).

## 1. Start: talk before the music is skipped
- `IntroSkitDetector` finds the first point where the beat is clearly there and holds for 8 s.
- **Skipped:** what comes before it, if it's talking (dialogue, a movie scene, a skit) or silence. The song starts at the bar where the music begins (`musicStartTime`).
- **A short sting before the talk:** some videos play a few seconds of music, then a conversation, then the song. For example, Karan Aujla's "5-7" has 7 s of beat, then 30 s of talking, and the music starts at 0:40.
  - If about 10 s of talking with almost no bass follows within 20 s of the first beat, that beat was only a sting.
  - The song then starts at the first steady beat after the talking ends, even if the bass fades in under the last words.
  - A rap or sung verse has bass under it, so it never counts as talking.
- **Songs that start streaming:** a song that starts streaming before it's fully downloaded begins at 0:00, because its intro can't be analysed yet. As soon as it has loaded, if it's still in a talking intro, it jumps to where the music starts. The status line then says *"Skipped the talking intro of …"*.
- **Kept:** a musical intro without the beat (pads, piano, a sung opening), because the build-up matters (Rule 9).

## 2. End: what comes after the music isn't waited for
- `OutroDetector` looks at the song's last 2.5 minutes. It finds the last point where the beat holds for 8 s, then the last kick or dhol hit (loud in the bass, so a syllable of talk doesn't count).
- **What follows it is classified:**
  - **Talking** (≥ 20 % speech-like), **silence**, or a **quiet fade** (≥ 60 % of it below a quarter of the song's level): the music end is the bar line after the last hit.
  - **A musical outro without the beat:** 16 s of it is kept to blend over; the rest is skipped.
  - **Less than 10 s after the beat, or no clear beat near the end:** nothing is cut.
- **How it's used:** the music end (`musicEndTime`) is treated as the song's end.
  - The auto-mix plans its blend in the 45 s before it.
  - The blend finishes by it.
  - In Best Parts mode, the exit window must also end 22 s before it.
- **It's shown:** the mix banner then says why, e.g. *"Music ends at 2:16; skipping 38 s of talking/dialogue"*.
- **Stays correct when the tempo changes:** the music end moves with the song like its other timings, and is saved with the queue.

## 3. What doesn't change
- **Manual control:** Mix and Next work as before. If no next song is ready, the song plays on to the end of the file.
- **Measured result:** on 24 cached songs, the end was cut on 6 (dialogue 12–38 s, a 16 s fade, two long beatless outros). The start detection gave identical results before and after the shared beat analysis was split out (`beatPresence.ts`).

---

# Best Parts Mode (Dance Floor) Rules

When people are dancing they want the energy of each song, not its full length. **Best Parts** mode plays every song from its build-up through its hook, then mixes into the next song's build-up. Each song is on air for about **1–1.5 minutes** (≈ 40 bars at 120 BPM) instead of 3–4.

Switch: **"Best parts only"** under the transport controls (Party console), **"Best Parts"** in the Master Mixer header, and **"Best Parts"** on the phone remote. It is off by default and remembered on this browser (`ai_dj_best_parts`). Moods don't change it. Code: `bestPartExitWindow`, `bestPartEntryRange` and `mixOutWindow` in `src/audio/AudioEngine.ts`; `earliestExit` and `entryRange` in `planMix` (`src/audio/MixPointPlanner.ts`).

## 1. What "the best part" is
- The song's **hook** is its `highlightTime` (`HighlightDetector`): the loudest sustained 6-second stretch between 18 % and 75 % of the song, which is where the chorus or drop sits.
- **The best part = the build-up into the hook + the hook (one full chorus).** The build-up is kept on purpose: the crowd needs it to feel the hook arrive.

## 2. Entry: the incoming song enters in its build-up
- It enters on a **bar start 16 to 4 bars before its hook** (`BEST_PART_BUILD_BARS = 16`, `BEST_PART_MIN_BUILD_BARS = 4`), never closer than 4 bars to the hook, so **it still never starts from the hook** (Rule 9).
- Phrase starts (8 / 4 bars) and calm, vocal-light bars are preferred, as for any entry (Rules 3, 8).
- The blend should **finish before the hook hits**: an entry whose blend runs into the hook loses 1.5 points, so the hook is heard in full and not under the old song.
- Dialogue/skits are still skipped: the entry is never before `musicStartTime`.
- **Early hook:** if the hook comes within 8 bars of the music start, the intro *is* the build-up: the song enters at its intro as usual.
- A mix that can't be planned (immediate mix) also cues the incoming song at the start of its build-up range.

## 3. Exit: the outgoing song leaves after its hook
- The on-air song keeps playing for **16 bars from its hook** (`BEST_PART_HOOK_BARS`, a full chorus), then mixes out at the **best phrase in the next 16 bars** (`BEST_PART_EXIT_BARS`): its *exit window*.
- Inside the window the normal exit rules choose the bar: phrase starts, a drop into a calmer section, few vocals, never fading out over the hook (Rules 3, 8, 9).
- The auto-mix treats the end of the exit window as the song's end: it plans the mix (and asks the AI DJ ahead of time) 45 s before it, exactly as it would before a real outro.
- **Never cut a phrase short to hit a time:** the exit is always a bar start chosen for musical reasons inside the window.

## 4. When a song plays whole
- **Short songs:** under 2 minutes (`BEST_PART_MIN_SONG_SECONDS = 120`) play whole.
- **Late hook:** if the exit window would run into the song's last 22 seconds, the song plays out to its outro and mixes normally.
- **Not analysed yet:** a song that is still streaming, before its analysis has found the hook, plays normally until the hook is known.
- **First song of the set:** it still starts from the music start (never from the hook). Its exit follows the Best Parts rule.

## 5. When the next song isn't ready
- The song keeps playing; nothing is cut into silence.
- Once a song is ready after the exit window has passed, the mix happens at the best bar in the **next 16 bars**.

## 6. What doesn't change
- **Manual Mix / Next:** these keep their 45-second lookahead and "Mix now" (see *Manual Mix* rules). In Best Parts mode the incoming song still enters at its build-up.
- **All other mixing rules still apply:** BPM matching and limits, beat alignment, key compatibility, bass swap, blend length per mood, vocal-clash avoidance, loudness, and the AI DJ's choice between rule-abiding exit/entry points.
- **Queue rules:** a song played as a best part counts as played (Previously Played, Most Played, the no-repeat window).
- **Switching it on or off mid-song:** a mix that's already planned stands. The new rule applies from the next planned mix.

## 7. Limits
- The hook comes from the audio's loudness alone (YouTube's "most replayed" data is not used, to keep this laptop off YouTube). A song whose loudest part isn't its best-known part will be cut around the wrong section. **Play best part** and the manual Mix button let you take over.
- Faster turnover means the next song has to be downloaded, analysed and tempo-matched within about a minute. The queue preloads the next song, so this normally keeps up. On a slow connection, songs run longer while they wait (rule 5).

---

# Up Next Queue Deduplication Rules

1. **Strict Single-Instance Guarantee:**
   - The **Up Next queue must NEVER contain the same song twice**.
   - Any duplicate song—whether matching by identical YouTube URL / video ID, exact title string, or normalized core title (ignoring artist prefixes like `"Artist - Title"`, `"(Official Video)"`, `"[Audio]"`, punctuation, and metadata tags)—is strictly prohibited.
2. **Multi-Stage Queue Guarding:**
   - **Initialization / Hydration:** When the queue is restored from `localStorage`, it is immediately sanitized through `deduplicateQueue()`.
   - **User & Playlist Requests:** Before queuing a song via `acquireTrack()`, the query, URL, and search results are verified against existing queue tracks. If already present, the duplicate request is discarded.
   - **AI Auto-Curation & Seeding:** Both `refillQueueWithRecommendations()` and `restoreOrSeedQueue()` verify every candidate song against the queue, on-air tracks, and recently played history using fuzzy core-title matching before insertion.
   - **Save Guard:** `saveQueueToStorage()` deduplicates the queue before committing state to persistent storage.

---

# BPM Adjustment Rules for Dancing and DJ Mixing

## Objective
Adjust song tempo to create energetic, dance-friendly mixes while preserving musical quality, vocal naturalness, and rhythmic consistency.

## BPM Adjustment Limits

- **Preferred range:** ±3% from the original BPM.
- **Default adjustment range:** ±5%.
- **Extended adjustment range:** ±8% when musically appropriate.
- **Maximum permitted adjustment:** ±16% from the original BPM.
- Never exceed the ±16% limit unless the user explicitly changes this configuration.

## Adjustment Guidelines

### 1. Subtle Adjustments: 0–3%
- Prefer this range for natural-sounding transitions.
- Preserve the original groove and feel of the song.
- Use for most routine DJ mixing.

### 2. Moderate Adjustments: 3–5%
- Use to increase dance energy or match the tempo of another song.
- Suitable for many pop, Bollywood, Punjabi, and electronic dance tracks.
- Check that vocals and percussion remain natural.

### 3. Strong Adjustments: 5–8%
- Use when a more energetic feel or closer tempo match is needed.
- Evaluate the genre, rhythm, vocal delivery, and audio quality.
- Prefer key-lock or pitch-preserving time-stretching to maintain vocal pitch.

### 4. Aggressive Adjustments: 8–16%
- Allow only when needed for a deliberate creative effect or a viable transition.
- Treat this as an exceptional range, not the default.
- Check for distorted transients, unnatural vocals, rhythmic artifacts, and loss of groove.
- If the result sounds poor, use a different transition technique instead of forcing the tempo match.

## Technical Rules

1. Calculate tempo changes as a percentage of the original BPM.
2. Enforce the configured limit in both directions.
3. Never change tempo beyond ±16% from the original BPM.
4. Prefer pitch-preserving time-stretching when changing tempo.
5. Analyze both songs before choosing a target BPM.
6. Choose a target BPM that minimizes unnecessary tempo changes while maintaining a suitable dancing rhythm.
7. Do not force two songs to the same BPM if doing so produces poor audio quality.
8. If the required tempo adjustment exceeds the limit, use an alternative such as a quick transition, breakdown, echo-out, or beat switch.
9. Evaluate the actual rendered transition, not just the calculated BPM values.
10. **Party mood, songs that can't reach the set tempo:**
    - **Which songs:** a song slower than the set tempo (about 124 BPM) that can't be brought to it within ±16%, or whose BPM reading is unsure. For example Nashe Si Chadh Gayi, 97 BPM.
    - **What happens:** it's lifted **+8%** (key-locked, pitch unchanged), e.g. 97 → 104.8 BPM. That's more energy without the vocals sounding rushed. It never goes past the set tempo.
    - **Not lifted:**
      - readings below 80 BPM (likely half of a fast song, which a lift would make rush);
      - songs at or above the set tempo (never slowed down).
    - **Up Next:** such songs are kept and lifted instead of being swapped out (`partyLiftBpm` in `AudioEngine.ts`).
    - **Outside Party:** with a "Whole set at this BPM" lock you set yourself, a song beyond the limit is still brought as close as ±16% allows.

## Calculation

For an original BPM of `B` and an adjustment percentage of `P`:

- Increased BPM = `B × (1 + P / 100)`
- Decreased BPM = `B × (1 - P / 100)`

For example, a 100 BPM song has the following permitted range:

- Minimum BPM: 84
- Original BPM: 100
- Maximum BPM: 116

For a 128 BPM song:

- Minimum BPM: 107.52
- Original BPM: 128
- Maximum BPM: 148.48

Keep the internal calculations precise and round displayed BPM values appropriately.

## Core Principle

The ±16% limit is a hard technical constraint for automated mixing, not a guarantee of good sound. Prefer small tempo changes and prioritize danceability, vocal quality, musical phrasing, and a natural transition over forcing an exact BPM match.

## Manual Tempo Presets (User Explicit Override)

- The user can explicitly change the on-air track speed with dedicated presets: `0.5x`, `0.9x`, `1.0x`, `1.1x`, `1.2x`, and `1.5x`.
- Selecting `1.5x` accelerates tempo to 150% of the natural BPM. With **Key Lock ON**, WSOLA time-stretching maintains vocal and instrumental pitch; with **Key Lock OFF (vinyl)**, pitch scales naturally with the speed.
- The user's explicit manual tempo choice overrides the automatic ±16% mixing constraint for that playback.

---

# Previously Played Exclusion Rules for Up Next Queue

1. **No Repeats Within 3 Hours:**
   - **A song played in the last 3 hours is NOT added to Up Next automatically** (`REPLAY_GAP_MS` in `AudioEngine.ts`). Songs played longer ago come back: they're the songs people know (see *Up Next Familiar-First Rules*).
   - "Played" means this browser's Previously Played log, or the server's play history (`lastPlayed`) in case the log was cleared (`playedRecently`).
   - Matches are evaluated across:
     - Exact video URL or YouTube video ID
     - Exact song title (case-insensitive)
     - Normalized core title (stripping artist prefixes like `"Artist - Title"`, `"(Official Video)"`, `"[Audio]"`, etc.)
     - Title segments and fuzzy key matches (`isSameSong`)
   - Any matching song is purged from Up Next during queue sanitization, when a track finishes playing, and when restoring the queue from storage.
   - A song someone asks for (search, a request from the phone, Mix on a Previously Played song) is always allowed.

2. **No Consecutive Identical Songs in Previously Played:**
   - **In Previously Played, no 2 consecutive songs can ever be the same.**
   - If a song finishes or is played again immediately, the engine updates the timestamp (`playedAt`) and metadata on the existing latest entry instead of appending an adjacent duplicate row.
   - Storage hydration (`loadPlayLog`), runtime state emissions (`getSyncState`), and UI presentation components (`PreviouslyPlayedPanel.tsx` in Party Console and Mobile Remote) strictly deduplicate adjacent matching entries using multi-attribute song equivalence (`areSongsConsecutivelySame`).
   - Non-consecutive plays (e.g. Song A -> Song B -> Song A) are preserved to maintain an accurate chronology of the mix set.

---

# AI Mood Reading & Top 5 Queue Insertion

1. **Vibe & Mood Analysis on Search & Play:**
   - When a user searches for and plays a track (via **"Play & Sync Mood"** or search dropdown mix), the AI DJ agent (Ollama primary with Gemini cloud backup and genre heuristic fallback) analyzes the user's current mood:
     - Detects musical genre, cultural vibe (e.g., Punjabi Club Bangers, Bollywood Dance Floor Hits, Club House & EDM, Afrobeat & Amapiano, Global Pop), tempo/BPM range, and dancefloor energy.
   - Generates the **top 5 most compatible tracks** matching that specific mood.

2. **Top-of-Queue Priority Placement:**
   - The engine fetches and verifies video metadata for the 5 recommended tracks.
   - Filters out any songs that are currently on air, in the Up Next queue, or in Previously Played.
   - Pushes the recommended tracks to the **very top** of the Up Next queue (`queue.unshift(...)`), so they are queued to play immediately following the active track.
   - Automatically begins background pre-buffering for the immediate next track to ensure zero-latency transitions.

---

# Top Queue Song Avoidance & 7-Skip Auto-Removal Rule

1. **Avoidance Detection for Top Queue Item:**
   - **If a song is at the first position (#1) of the Up Next queue and the user avoids it by playing other songs 7 times in a row, it is automatically removed from the top of the queue.**
   - An avoidance occurs whenever any other song is mixed or put on air (via search play, top bangers selection, or picking another song from lower down the queue) while the current song remains unchosen at index 0.
   - If the user plays the top song at any time, its avoidance counter is immediately reset to 0.
   - If the avoidance counter reaches 7, the engine automatically drops the song from the queue (`queue.shift()`), notifies the user, and shifts the next song into position #1.
   - The UI displays an active `⚠️ Skipped X/7` indicator on the top queue item to give visual feedback on avoidance progress.

---

# Maximum 6-Minute Song Duration Rule for Auto-Queue (User Search Exempt)

1. **Strict 6-Minute (360 Seconds) Limit for Engine-Added Songs:**
   - **Never add any song longer than 6 minutes on your own in the Up Next queue.** (It was 5 minutes; many Bollywood songs run 5–6 minutes. One shared value: `MAX_AUTO_SONG_SECONDS` in `shared/taste.ts`.)
   - Applies to:
     - Autonomous queue replenishment and recommendations (`refillQueueWithRecommendations`, `/api/recommend`).
     - AI Mood-Reading recommendations (`readMoodAndPushTop5`).
     - Background preloading and decoding (`preloadQueuedTrack`).
     - Auto-seeding from text playlists (`restoreOrSeedQueue`, `loadSongsFromTextFile`).
     - Queue sanitization (`deduplicateQueue()`).
   - Any automatically acquired song with a duration exceeding 360 seconds ($> 6\text{ minutes}$) is immediately rejected or pruned from the queue.

2. **Exemption for Explicit User Search & Play:**
   - **If the user explicitly searches for a song and queues or plays it (`source === 'request'`), it is permitted regardless of duration.**
   - The user has complete freedom to enjoy long mixes, extended club tracks, or live sets when explicitly requested.

---

# Set Flow (Which Song Plays Next)

A DJ doesn't just take the queue in order. When the AI DJ isn't choosing (it's off, slow, or only one song is ready), the next song is picked from the **next 3 ready songs** by these rules (`engine/setFlow.ts`, used in `planOutroMix`). When the AI DJ does choose, it is told to avoid the same artist back to back, prefer keys that fit, keep energy and language flowing, and play guest requests soon.

1. **Guest requests are never skipped.** A request first in line always plays next, and requests further back keep their place.
2. **No artist twice in a row:** a song by the artist on air, or the one before it, loses 3 points.
3. **Keys that fit:**
   - a fitting key gains 1 point;
   - a clashing key loses 2.
4. **Small tempo steps** (half and double time count as the same tempo):
   - a step of 4% or less gains 0.5;
   - a step over 8% loses 1;
   - a step over 16% loses 2.
5. **Language runs:** a few songs (3) in one language before switching. An earlier switch loses 0.7. This only counts when the language is known for sure (script, artist or label).
6. **No energy drop on a dance floor:** in Party or Bhangra mood, a song more than 3 dB quieter than the one on air loses 1.
7. **Queue order still counts:** each place further back costs 0.6, so the queue wins unless another song flows clearly better.
8. **Shown:** the reason appears as the AI DJ decision, e.g. *"Next: Softly — a different artist; its key fits; "G.O.A.T." would be same artist again"*.

**Why:** the craft sources agree that a set is shaped as waves of energy rather than a random order or a flat line. Big tempo jumps need planning, and abrupt changes of genre or energy lose the floor. See [DJ.Studio: anatomy of a great mix](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic), [ZipDJ: how to structure a set](https://zipdj.com/blog/how-to-structure-a-dj-set) and [DJ Will Gill: setlist flow](https://djwillgill.com/pro-tactics-for-flawless-song-selection-for-dj-setlist-flow/).

---

# Hooks (Every Chorus, Not Just One Point)

A song usually has its chorus 2–3 times, and sometimes a separate drop. The app finds all of them (`HookDetector.ts`, run in `analyzeTrack` once the music's start and end are known):

1. **How it finds them:**
   - **Measurements:** per bar of the beat grid, the loudness and the harmony (which of the 12 notes sound).
   - **A chorus:** every 8-bar stretch is compared with every later one. A chorus comes back with the same harmony (≥ 0.8 similarity, bar by bar) and is louder than the song's average. Loudness counts heavily, because verses and intro riffs repeat too.
   - **Choruses vs halves:** each repeat of the best match is a chorus hook. Repeats less than 16 bars apart are one chorus's two halves, not two choruses.
   - **A drop:** a one-off stretch as loud as the choruses, away from them.
   - **Up to 4 hooks**, each starting on a bar. When nothing repeats, the loudest stretch is used, as before.
2. **The song's main hook** (shown as "Hook", used by Best Parts mode and the pre-roll cue) is the **first chorus**. The build-up and the first time the hook lands are heard, and the loudest (often last) chorus is no longer waited for.
3. **Best part button:** each press jumps to the next hook after where you are, back to the first after the last. The status line says e.g. *"Hook 2 of 3 (1:48)"*.
4. **On screen:** a marker for every hook on the waveform (Party console and Pro decks). The badge lists them, e.g. **"Hooks 0:58 · 1:42 · 2:55"**, on the laptop and the phone.
5. **Where it comes from:** it's decided from the audio alone. YouTube's "most replayed" data isn't used (to keep this laptop off YouTube), so the app no longer calls anything "the world's favourite part".
6. **Limits:** a song whose intro riff is as loud as its chorus and has the same harmony (e.g. Blinding Lights) can get that riff marked as a hook too. On 12 test songs the choruses came out about a minute apart, as expected. Hooks are found in about 50–120 ms per song.

---

# AI Chat Song Filters ("only dance songs", "only Diljit Dosanjh"…)

What you tell the AI chat about **which songs** to play becomes a filter on Up Next (`shared/songFilter.ts`). It has four parts, in any mix:
- **Artists:** "only Karan Aujla", "more AP Dhillon".
- **Vibe:** dance (also "party", "club", "upbeat", "bangers"), romantic ("love", "slow"), chill ("relax", "calm"), bhangra.
- **Language:** Punjabi, Hindi ("Bollywood"), English, Spanish ("Latin").
- **Era:** old ("retro", "classic"), 90s, 2000s, new ("latest").

**Only vs more:**
- **"Only …":** Up Next keeps only the songs that fit, plus songs someone added. If the song on air doesn't fit, a fitting one is mixed in within 45 s.
- **"More …", or "play dance songs"** (a kind of song with no "only"): new picks lean toward it, and other songs still play.
- A kind of song is read as a request only when "songs", "music" or "gaane" is said too, so "play Love Dose" still plays that song.

**What changes:**
1. **Mood:** a vibe switches the mood: dance → Party (punchy sound, 120–130 BPM set), romantic → Romantic, chill → Chill, bhangra → Bhangra.
2. **What fits:**
   - **Artists:** the title or channel names them, as whole words. "KK" matches "| KK |" and "K.K.", but not "Ikky".
   - **Language:**
     - Punjabi, Hindi and Spanish need a sure sign: the script, title words, well-known artists or labels (Speed Records, T-Series…).
     - English only needs to not be surely another language.
   - **Dance:** no slow or stripped-down versions (sad, unplugged, lofi, slowed, acoustic…). A song whose steady beat is measured below 88 BPM is dropped once it's analysed.
   - **Romantic / chill:** no party versions (remix, club, DJ, bhangra…).
   - **Bhangra:** Punjabi songs, or titles that say bhangra or dhol.
3. **The AI checks the vibe:**
   - **Why the AI:** titles and measured tempo can't reliably tell a dance song from a ballad (on 14 test songs, ballads read 137–163 BPM).
   - **What it checks:** under a vibe filter, the AI DJ (Ollama, with Gemini as backup) is asked which songs fit. That covers Up Next and your own songs (Most Played, Favourites, Previously Played), 30 per question, with answers remembered in this browser.
   - **What happens:** songs it rules out leave Up Next. A song from your history is queued under a vibe filter only once the AI has said it fits.
   - **No AI available:** history songs wait, and picks come only from the vibe-specific searches.
4. **New picks:**
   - **Searches:** for the kind of song, e.g. "Punjabi party songs", "Punjabi party songs hits", "<your top artists> party songs". For dance it searches "party songs", not "dance songs", which finds children's songs.
   - **"Also played" lists and the AI's ideas** are filtered the same way.
   - **Children's content** (preschool, nursery rhymes, kids' songs) is never picked.
5. **Shown and remembered:**
   - The top bar and Up Next show e.g. **"Only Punjabi dance songs by Diljit Dosanjh"**.
   - The filter survives reloads.
   - **Clear AI instructions** or "play anything" removes it.

---

# No Mashups or 8D Audio in Up Next (Unless Liked)

1. **Never picked automatically:**
   - Mashups (titles with "mashup", "mash-up", "mash up") are never added to Up Next by the app.
   - 8D / 16D / 24D audio is never added either.
   - This covers recommendations, AI suggestions, AI mood picks, familiar songs (Most Played, Previously Played), `my_songs.txt`, choosing a search result for a song, preloading and queue clean-up (`autoBlocked` in `AudioEngine.ts`; `/api/recommend` drops them too).
2. **Exception: a mashup you liked.** It's treated like any other liked song and can be queued automatically.
   - It must be that exact mashup: the same video, or exactly the same title.
   - Another mashup with a similar name still isn't picked.
   - 8D audio has no exception.
3. **Songs you ask for are always allowed:** searching, requesting from the phone, or typing "play …" in the AI chat plays a mashup if that's what you picked.

---

# "Don't Play Again Ever" (Thumbs Down) Rule

1. **Thumbs Down (👎) Dislike Action:**
   - A dedicated **Thumbs Down (👎)** button is available directly on the **Now Playing** artwork and on every song in the **Up Next queue**.
   - Clicking Thumbs Down permanently saves the song to the **"Don't Play Again Ever"** blacklist (persisted to `localStorage` and `data/banned_songs.json`).

2. **Immediate Queue Purge & On-Air Skip:**
   - When a song is thumbs-downed:
     - Any copies or upcoming instances are immediately purged from the Up Next queue.
     - If the song is currently playing on air, the DJ engine immediately initiates a transition to the next track (`nextTrack()`).

3. **Strict Global Exclusion:**
   - Songs in "Don't Play Again Ever" are strictly prohibited from:
     - Being auto-recommended by the AI agent (`readMoodAndPushTop5`, `/api/recommend`).
     - Being auto-curated or seeded into the queue (`refillQueueWithRecommendations`, `restoreOrSeedQueue`).
     - Appearing in Top Bangers (`getTopBangers()`).
     - Being downloaded or preloaded in the background.

4. **Dedicated "Don't Play" Management Tab:**
   - In the Quick Starters panel, a **"Don't Play"** tab lists all blocked tracks with their title, artist, and thumbnail.
   - An **"Unblock"** button allows the user to easily remove any track from the blacklist at any time.

---

# Up Next Queue 50-Song Capacity & Multi-Tier Seeding Rules

1. **50-Song Queue Target:**
   - The engine actively maintains up to **50 songs** (`MAX_QUEUE_TARGET = 50`) in the Up Next queue.
   - When the queue size drops below 50, the auto-curation loop periodically seeds new tracks to keep the playlist full.

2. **Seeding Precedence** (`populateQueueTo50`):
   - **Tier 1: Familiar songs:** Favourites, Most Played and Previously Played, not played in the last 3 hours. They're taken in a weighted random order (favourites weigh 4, a Most Played song 1 + log₂(plays), a play-log song 1, each times a random 0.5–1.5) so the same songs don't always lead.
   - **Tier 2: Local Song Library** (`my_songs.txt`): curated local tracks.
   - **Tier 3: New picks** (`/api/recommend`): songs matching the listener's taste, the current mood and tempo.
   - Tiers 1 and 2 fill at most **70 %** of the queue (35 of 50) when auto-curation is on, so new picks get the rest.

3. **Combined Exclusion Filters:**
   - Candidates are automatically rejected if they:
     - Exceed the **6-minute duration limit** ($> 360\text{ seconds}$).
     - Are already present in the **Up Next queue** or **currently on air**.
     - Were **played in the last 3 hours**.
     - Are in the **"Don't Play Again Ever"** blacklist (`bannedSongs`).
     - Were **expired or refreshed away in the last 2 hours** (new picks only).
     - Have a **link instead of a title** (a failed lookup in the history).

---

# Up Next Familiar-First Rules

The listener should know most of what plays. Up Next is built so that about 70 % of automatically picked songs are familiar, new picks are well-known hits rather than fresh uploads, and new picks that nobody plays don't sit in the list.

1. **Familiar and new take turns:** below the first 3 songs, Up Next is ordered **two familiar songs, then one new pick**, repeating (`mixFamiliarAndNew` in `src/audio/engine/queueRules.ts`). Songs someone added on purpose stay exactly where they are, and so do the first 3 songs (they're loading or about to play).
2. **New picks are hits:**
   - The AI is asked only for *"well-known hits that most people at a party would recognise"*, with no new releases, deep cuts or obscure songs (both the Up Next suggestions and the AI mood picks).
   - Each search hit is ranked (`scoreHit` in `shared/taste.ts`):
     - **Views:** about 3 M is neutral, about 100 M+ scores up to +1.5, under about 100 k scores down to −1.5.
     - **Age:** uploaded in the last 30 days −1.5; in the last 4 months −0.5.
     - Artists the listener plays, and official versions, score up.
     - Slowed, lofi, karaoke, mashup, live and TV versions, fan clips and shorts score down.
   - A search for an artist looks at their top 20 results (not 8), so their big hits beat their newest upload.
3. **Stale new picks expire:** a new pick below the first 3 songs that has waited **30 minutes** without being played is removed and replaced (`STALE_AFTER_MS`, checked every 30 s). Familiar songs and songs someone chose never expire. An expired song isn't suggested again for 2 hours.
4. **Refresh button** (top of Up Next, laptop and phone):
   - Rebuilds Up Next from the song on air, the listener's taste and the mood.
   - It keeps the songs someone added and the first 3.
   - It stops any fill already running, then researches without the AI, so it takes about 8 s for about 28 songs.
   - Familiar songs appear at once and new picks as each request returns.
   - It reports *"Up Next refreshed: N new songs"*. The new picks it dropped aren't suggested again for 2 hours.
5. **Removing songs teaches it:** removing **2 or more** automatically picked songs by the same artist from Up Next makes that artist avoided for the rest of the session. They're left out of AI suggestions, ranked down in searches, and sent to the server as `?avoid=`.
6. **How new picks are researched** (`handleRecommend` in `server/recommendations.ts`, `server/discover.ts`). One request researches several seeds at once, in parallel:
   - **Songs played together with yours:**
     - YouTube's related list, built from what listeners play together, fetched through the Invidious/Piped instances (never YouTube directly).
     - It's fetched for up to 10 songs: the seeds (the song on air counts 3, recent plays 2) and a random handful of liked and most-played songs (1 each).
     - A song recommended from several of your songs collects points from each.
   - **Artists fans of yours also like:** Deezer's related artists (public API, no key) for the seed's artist and your top 4 artists. The 4 new artists named most often are searched for their hits (top 20 results, 2 kept per artist).
   - **Your own artists:** the seed's artist and your top 3, 2 hits each.
   - **The AI DJ's ideas:** 12 songs for this listener and mood, one search each. Only on a background fill's first request (the AI takes about 30 s on this CPU), never on Refresh.
   - **Hand-made mood list:** only if fewer than 10 candidates came back.
   - **One ranking:**
     - Every candidate gets `scoreHit` (popularity, age, your artists, proper versions) plus its points from each source.
     - Kept: songs between 90 s and 6 minutes. Dropped: 8D, mashup and jhankar versions, and banned songs.
     - The best 40 are returned with the reason each was picked.
   - **Caching:** related lists and searches are kept 10 minutes, and "fans also like" 1 hour, so picks follow what's popular now.
   - **Speed:**
     - About 2–4 s per request.
     - The browser sends 4 seeds per request, at most 3 requests per fill.
     - If the AI times out, it's skipped for 5 minutes.
   - **Limit:** the related lists don't know the party mood, so a calm song can come in during Party mood. Only the AI's ideas follow the mood.
