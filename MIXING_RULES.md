
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

# Live Rhythm Enhancer (Deck P) Synchronization

1. **AI Rhythmic Analysis & Pattern Selection:**
   - The AI agent (Ollama primary / Gemini cloud backup) analyzes the active song's BPM, genre, beat confidence, and viral hook drop.
   - Selects the matching pattern:
     - `punjabi_dhol`: Authentic Punjabi Dhol Chaap (heavy curved Dagga + sharp Thapi slap, ideal for high-energy Punjabi club bangers >= 126 BPM)
     - `bhangra_groove`: Traditional Bhangra Dholak & Chimta (bouncy swing groove, ideal for Bhangra & medium tempo hits 90-125 BPM)
     - `electronic_drums`: Club 4-on-the-Floor (punchy 909 kick, snappy 808 clap on 2 & 4, 16th hats for EDM, House, Techno)
     - `afrobeat`: Syncopated wooden congas, organic shakers, and deep polyrhythmic bounce for Afrobeat & Amapiano
     - `none`: Silenced for acoustic tracks, ballads, classical, or low beat confidence (< 60%)
2. **Phase Lock & Downbeat Grid Alignment:**
   - Deck P phase-locks to the exact downbeat of the on-air deck: `(relativeTime % loopDuration) * rate`.
   - Continuous BPM tracking follows any tempo adjustments in real time without drifting.
3. **Dynamic Verse Ducking & Viral Hook Drops:**
   - Ducks rhythm volume during vocal verses and builds up to maximum power (`1.3x` intensity) at the viral hook drop.
   - On-demand "AI Sync" button instantly re-evaluates musical harmony and snaps phase lock.

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


