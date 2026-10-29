
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
- **Compatible** (same, ±1 on the wheel, or relative major/minor): the mood's normal blend length.
- **Two steps apart, or clashing:** the blend is kept to **4 bars**, and the AI DJ is told to prefer a cut or a short blend.
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
- **Never start from the hook because buildup is also important:** Incoming and first songs must build up naturally from where the music begins (skipping initial dialogue/conversation skits). Do not jump straight into the hook or chorus drop.
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
- There is no CC0 recording of a chimta, so the styles use tambourine and stick sounds instead.

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
| **Dhol Chaal** | The classic bhangra shuffle: boom on the beat, crack on the off-beats (swing 0.28) | Punjabi, bhangra, wedding songs |
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
   | Party | Dhol Dhamaal | Dhol Chaal | Afro Groove | Club Tops at 118–132 BPM, otherwise Clap & Tambourine |
   | Bhangra | Dhol Chaal | Dhol Chaal | Dhol Chaal | Dhol Chaal |
   | Normal | Dhol Chaal | Dholak Keherwa | Afro Groove | Clap & Tambourine |
   | Chill, Romantic | Dholak Keherwa | Dholak Keherwa | Light Shaker | Light Shaker |

4. **How loud, from the song's own sound** (thresholds calibrated on 60 songs from the app's cache):
   - **Hard-hitting drums already** (low-end punch above ~0.13, e.g. *295*, *Morni*, *Dope Shope*): level 0.5, and Dhol Dhamaal becomes the lighter Dhol Chaal, so the dhol doesn't pile on top of the song's own drums.
   - **Vocal-heavy** (mid-band share above 0.58): at most 0.55.
   - **Soft drums at a party** (punch below ~0.095, non-desi songs): **Club Drive**, adding a kick, at 0.8.
   - Otherwise 0.7 (0.45 in Chill and Romantic).

The card shows the plan, who identified the song (**🤖 AI**, **Known artist** or **Guess**) and why, e.g. *"Punjabi song, party mood: Dhol Chaal, kept light (its drums are already strong)"*. A plan that changes while a song plays (the AI answered late) switches on the next bar line. AI questions about songs wait while a mix or next-song question is in flight, because those are time-critical.

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
     - **Rule 3 & 9 (Phrase Boundary Exit & Intro Buildup Entry):** Blend initiates on the planned 4/8-bar phrase or breakdown exit within the 45s window. The incoming song enters at `musicStartTime` (skipping dialogue/conversation skits) to allow natural musical buildup, **never starting from the hook**.
     - **Rule 5 (Avoid Bass Clashes):** Smooth EQ bass swap ramp executed over the transition (outgoing low EQ drops before incoming low EQ rises) to keep the low end punchy without dual-kick phase cancellation.
     - **Rule 6 & 7 (Energy & Transition Length):** Transition length adapted to the genre/tempo (4 Bhangra, 8 Normal/Party, 16 Chill/Romantic bars).
     - **Rule 8 (Avoid Vocal Clashes):** Vocal energy envelope analysis (`profile.mid`) avoids clashing vocal lines.
     - **Rule 10 (Loudness Matching & Limiting):** Perceived loudness normalized and master limiter prevents clipping distortion.

3. **"Mix Now" Immediate Override:**
   - If the user explicitly clicks **"Mix now"** (or clicks the active song's "MIX NOW" button / presses Next during the countdown):
     - The phrase countdown is immediately bypassed.
     - The transition starts on the very next beat grid downbeat, preserving beatmatching and bass swap while fulfilling the user's explicit request for an immediate transition.

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

1. **Strict Exclusion of Previously Played Songs:**
   - **If any song is in Previously Played, the same name song should NOT be in the Up Next queue.**
   - Matches are strictly evaluated across:
     - Exact video URL or YouTube video ID
     - Exact song title (case-insensitive)
     - Normalized core title (stripping artist prefixes like `"Artist - Title"`, `"(Official Video)"`, `"[Audio]"`, etc.)
     - Title segments and fuzzy key matches (`isSameSong`)
   - Any matching song is immediately purged from the Up Next queue during queue sanitization, when a track finishes playing, and when restoring the queue from persistent storage.
   - When automatically replenishing or seeding Up Next (up to 50 songs), songs in the Previously Played history (`playLog`) are strictly excluded.

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

# Maximum 5-Minute Song Duration Rule for Auto-Queue (User Search Exempt)

1. **Strict 5-Minute (300 Seconds) Limit for Engine-Added Songs:**
   - **Never add any song longer than 5 minutes on your own in the Up Next queue.**
   - Applies to:
     - Autonomous queue replenishment and recommendations (`refillQueueWithRecommendations`, `/api/recommend`).
     - AI Mood-Reading recommendations (`readMoodAndPushTop5`).
     - Background preloading and decoding (`preloadQueuedTrack`).
     - Auto-seeding from text playlists (`restoreOrSeedQueue`, `loadSongsFromTextFile`).
     - Queue sanitization (`deduplicateQueue()`).
   - Any automatically acquired song with a duration exceeding 300 seconds ($> 5\text{ minutes}$) is immediately rejected or pruned from the queue.

2. **Exemption for Explicit User Search & Play:**
   - **If the user explicitly searches for a song and queues or plays it (`source === 'request'`), it is permitted regardless of duration.**
   - The user has complete freedom to enjoy long mixes, extended club tracks, or live sets when explicitly requested.

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

2. **Multi-Tier Seeding Precedence:**
   - **Tier 1: User Favorites** (`favorites`) — Starred bangers that have not recently played.
   - **Tier 2: Past Played & Most Played History** (`mostPlayedSongs`, `playLog`) — High-energy party favorites, strictly excluding songs played within the last hour.
   - **Tier 3: Local Song Library** (`my_songs.txt`) — Curated local tracks.
   - **Tier 4: Contextual AI Recommendations** (`/api/recommend`) — Dynamically fetched songs matching the current mood and tempo.

3. **Combined Exclusion Filters:**
   - Candidates are automatically rejected if they:
     - Exceed the **5-minute duration limit** ($> 300\text{ seconds}$).
     - Are already present in the **Up Next queue** or **currently on air**.
     - Are present in **Previously Played** (`playLog`).
     - Are in the **"Don't Play Again Ever"** blacklist (`bannedSongs`).



