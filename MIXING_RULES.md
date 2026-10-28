
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


