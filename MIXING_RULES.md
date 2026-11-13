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
  - `Clash ⚠️` (Rose): Key clash (3+ steps); the blend is at most **8 bars** and the outgoing song leaves through a **filter sweep**: a high-pass rises steadily from fully open to 1 kHz over the blend, so its bass and chords thin out while the new song comes in, instead of its harmony rubbing against the new key (`VirtualDeck.scheduleFilterSweepOut`). Keys that only partly fit (`ok`) are also capped at 8 bars, without the sweep. See [MusicRadar: EQ and filter tricks](https://www.musicradar.com/news/eq-and-filter-tricks-for-djs).
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

**When even the best pair has both singing** (both sides at least about 0.7 vocal over the blend, `vocalClash`), the app doesn't force the blend: it does a **quick cut** instead (about 2 s, the old song echoing out on its beat, or a reverb wash / brake as in "Ways to Mix"). The "Mixing into…" status line says *"both songs sing here, so a quick cut"* ahead of time. A blend length the user chose for that mix still applies. The same check covers two competing melodies or leads, since they sit in the same band.

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

**Why a cut:** the status line names the real reason: *"The beat isn't clear enough on the new song to beatmatch"*, *"Party mood never slows a song down"*, or *"Tempos too far apart (93 → 119 BPM)"*.

**Safety clipper:** the limiter (a Web Audio compressor) lets fast peaks through and adds its own make-up gain; in a 15-mix test, echo-out cuts peaked at 1.01–1.08, which clips. The very last stage before the speakers now passes everything up to 0.9 unchanged and rounds anything louder off smoothly, so the output never goes above 0.99 (`createSafetyClipper`).

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

## Quick Mix (Last Choice)
- Use a short transition.
- Select compatible beat or phrase boundaries.
- Minimize unnecessary overlap.
- Preserve momentum and energy.

## Creative Mix
- Use drop swaps, echo effects, beat switches, or vocal transitions.
- Apply effects only when they improve the transition.
- Prioritize musical timing and intentionality.

# Ways to Mix (The Advance DJ Transition Suite)

The planner (`MixPointPlanner.ts`), the mixer (`startTransition`), and the advanced transition router (`resolveAdvancedTransition`) execute **only advance-level pro DJ transitions**. Boring flat crossfades and plain volume dips are permanently eliminated. Every transition delivers an unmistakable pro club/festival experience.

| Advance DJ Style | Technique & Routing | Musical Context & What You Hear |
|---|---|---|
| **3-Band Frequency Stem Isolation Handoff** (`showcase_3band_handoff`) | Frequency stem separation: incoming highs ramp in (0–30%), mids blend (25–50%), instant hard low-bass swap at 50%, outgoing mids/highs thin out (60–100%). | Beatmatched pairs with compatible Camelot keys (Exact, Energy +1, Deep -1). Crystal clear frequency separation with zero mud or colliding basslines. |
| **Stutter Loop Roll Riser** (`loop_roll_riser`) | 8-beat stutter loop roll (1 beat → ½ → ¼ → ⅛ beat slices) under a rising resonant high-pass filter (to 400+ Hz) and white-noise riser sweep, landing with a punch on the 1. | Beatmatched tracks building into a drop, party/bhangra dance floor sets, or quick vocal-clash cuts. Builds massive anticipation into the incoming downbeat. |
| **Turntable Vinyl Brake Drop** (`vinyl_brake_drop`) | Motor brake deceleration: pitch and tempo glide smoothly to a dead stop over the final 1.5 beats right before the incoming drop lands on beat 1. | Large tempo gaps (> 5% BPM ratio), dramatic genre shifts, or high-energy dance floor switches. The gold-standard club DJ move for sudden tempo transitions. |
| **Echo Freeze Throw** (`echo_freeze_throw`) | Dotted-8th dub delay grab on the outgoing vocal/lead phrase, feeding a 3s decay tail that sweeps through a rising high-pass filter into stereo space. | Vocal clash avoidance, clashing Camelot keys, or tempo transitions where a rhythmic echo naturally carries energy over the mix. |
| **Stadium Reverb Wash Dissolve** (`reverb_wash_drop`) | Large-space convolution reverb diffusion wash over 4 beats, dissolving the outgoing track into atmospheric space as the new song takes the floor. | Chill, romantic, acoustic, or ballad transitions, and low-part ambient breakdowns where rhythmic delay would clash. |
| **Resonant Filter Bass Swap** (`filter_bass_swap`) | High-Q resonant HPF sweep thinning outgoing lows and mids up to 2.4 kHz with an instantaneous sub-bass kill and punch on the incoming downbeat. | Beatmatched blends, Camelot key clashes, or rapid phrase transitions. Clean tonal handoff preventing any harmonic clash. |
| **Precision Drop Cut** (`drop_cut`) | Downbeat precision drop cut: instantaneous deck handoff on beat 1 timed to a breakdown pause, gap exit, or climax drop. | Gaps after high points, breakdown stops, or immediate impact cuts. |

**Cut into the silence (a gap exit):**
- **What counts as a gap:** 0.3–4 s quieter than 15% of the song's average level, right after 2 bars at least as loud as its average (a high point), with the music coming back afterwards (`findGaps`).
- **Score:** a gap is worth 2.5, more than an 8-bar phrase start (1) plus a drop into a calmer section, so it wins when there is one in the window.
- **Never before a chorus:** a stop that comes right before a chorus is the build-up to it, so it isn't used. The crowd is waiting for that chorus.
- **Only when the new song can land on it:** a bare cut needs tempos within 8 %, keys that don't clash, and an entry at the start of a 4-bar phrase (`gapCutFits`). Otherwise the old song is thrown into an echo or reverb as its pause begins, and the tail fills the silence up to the new song.
- **Shown:** the status line says "Cut into the silence after the old song's high point".

**Why these, and when (research):**
- **Most mixes are plain blends.** A study of 20,765 real DJ transitions found transitions and cue points cluster on 32-beat phrases, and 86% of songs were tempo-adjusted by less than 5% ([Kim et al., ISMIR 2020](https://arxiv.org/html/2008.10267v1)). Blending on phrases at small tempo changes is what DJs do most.
- **Long blend / bass swap** when the songs are close; **filter** when they're moderately different (it tolerates tempo and key differences); **echo-out** or a cut when they're far apart ([MixReady](https://mixready.art/guides/dj-transition-types), [Mixgraph](https://www.mixgraph.io/learn/dj-transition-techniques)).
- **Delay vs reverb:** a rhythmic delay suits beatmatched songs, a reverb tail suits songs at different tempos ([Digital DJ Pool](https://digitaldjpool.com/blog/dj-transitions-for-beginners/)).
- **Loop and build** is for building into a peak or bringing in a big song; a big build into a mellow song disappoints ([Mixgraph](https://www.mixgraph.io/learn/dj-transition-techniques)).
- **Brake / spinback** is a deliberate, theatrical hard exit, best used sparingly; about one beat long ([We Are Crossfader](https://wearecrossfader.co.uk/blog/five-ways-djs-mix-songs-together/), [Thomann](https://www.thomann.de/blog/en/the-5-most-important-dj-transitions)).
- **Never every time, never stacked:** effects stop working when they're on every transition, and a filter, echo and loop together is too much. Hence the "once every 4 mixes" limit and one effect per mix.

**Shown:** the status line names the style, e.g. "Echo-out on the old song".

**No abrupt transitions (STRICT):** a song may change abruptly **only where the old song itself pauses** (a gap cut into its own silence). Everywhere else every transition overlaps for at least 4 s (`SMOOTH_MIN_SECONDS`), whoever asked for it: the AI DJ's "cut", the vocal-clash cut (now a 2-bar blend), Mix now, a disliked-song skip, a length picked by hand. So:
- Loop roll and brake are the exception: hard landings, used only on a dance floor with no low part at the mix point, and never two close together.
- Tempos that can't be beatmatched never get a plain fade. The move comes from `pickSignatureFx`, in rotation: echo-out, filter sweep, loop roll, reverb wash, brake (calm moods and quiet parts: reverb, echo or filter sweep only; echo and reverb are thrown 60 % into a filtered, bass-swapped fade). The filter sweep removes the old song's kick and bass first, so the two beats barely clash while they overlap. Two soft beatless songs get the long wash fade.
- **Special mixes** (`specialMixes.ts`), at most one in every 4 mixes, taking turns:
  - **Drop mix** (`drop_mix`): the old song builds up (loop roll riser: the loop speeds up from 1 beat to 1/8, a filter rises, a noise riser), then the new song lands on beat 1 of its **drop** (its detected drop, else its first chorus, else its hook; not in its intro, and with a minute of song left). Any tempos, since there's no blend. Never in a calm mood.
  - **Vocal overlay** (`vocal_overlay`): the new song starts 8 bars before its first chorus as **vocals only** (its deck's vocal isolator, music down) over the old song's beat, whose mids are cut so its own vocals step back; both sit at the middle of the crossfader. On the chorus downbeat the new song's full music comes in and the old song drops out. Only for beatmatched songs whose keys are known to fit (`good` or `ok`; an unknown key once put Naina in 7A over Never Fold in 1B), and only when the 8 vocal bars start at least 8 bars into the new song's music, past its intro, where there is singing for the isolator to keep.
- Beatmatched songs get `pickBlendFx`: mostly a **filter sweep blend** over the full blend length (resonant high-pass rising on the old song, bass swapped halfway), with a loop roll or an echo-out now and then on a dance floor (calm moods: filter sweep or echo). Every move skips the one used last, and the move used longest ago comes next.
- Anything that overlaps stays beatmatched (natural tempo only for gap cuts), so the beats don't flam.
Code: `smoothOnly` in `startTransition`, `executePendingMix`, `chooseExitFx`, `lowFadeSeconds`.

**Never in a high part:** every song has high parts (choruses, drops: bars at least 85% as loud as its loud level, the 90th percentile of its bars) and low parts (verses, breakdowns, intro, outro). The old song never starts leaving in the middle of a high part, or just as one begins (in the first half of the mix): the crowd is waiting for that chorus. The best exit is right where a high part ends and a low part starts (*"current song's high part just ended"*, worth 1 more point). When Mix is pressed in a long high part, the exit is looked for up to 90 s ahead instead of 45 s, so the mix waits for the low part rather than cutting the chorus off (`loudLevel`, `inHighPart` in `planMix`). Cuts with no overlap (natural pitch) never change the new song's speed.

**Never into the fade-out:** some songs fade or go quiet for several seconds before the file ends. The exit starts at least a bar (or half the blend) **before** the song's music ends (the last bar at least half its average level, `lastLoudTime`), so the old song is still playing for the first half of the mix; a bar after it left 1–3 s of silence (QA: Despacito ended 1.5 s before the mix began). The new song never comes in on a near-silent fade-in either: an entry's first 2 bars reach at least a quarter of its loud level (`ENTRY_MIN_LEVEL`), else the first bar of its intro that does. If the song is already fading when the mix is planned, it mixes at the next bar.

**Every hook is protected:** an exit never fades the old song out over any of its hooks (each chorus and a drop), not only the first one.

**Best Parts timing:** a song mixes out only after its best part: the later of its first chorus and its most-loved moment (most replayed, else loudest; `peakTime`). The first chorus often comes early, and leaving after it cut songs short.

---


# Mistakes Great DJs Don't Make (Research)

| Mistake | What the app does |
|---|---|
| Mixing out mid-phrase or mid-chorus | Exits on phrase starts, never in a high part; the best exit is where a high part ends |
| Chorus over chorus | The incoming song enters in its intro / build-up; two singers at once get a quick cut |
| Big changes in a chorus instead of a break | Tempo glides and blends happen over low parts |
| An abrupt stop between songs that don't match | A low-part fade instead of a 2 s cut; the brake and quick cuts only when no low part is near |
| Two basslines at once | Bass swap in every blend and fade |
| Mixing out too early (playing mostly intros) | The Mix button waits for the end of the high part; Best Parts leaves after the hook |
| Cutting to silence (dead air) | No exits into fade-outs; the cut into a silence is timed to where the music would come back |

Sources: [DJ.Studio: bad mixing mistakes](https://dj.studio/blog/bad-dj-mixing-mistakes), [DJ.Studio: phrasing](https://dj.studio/blog/phrasing-dj-mixing), [ZipDJ: phrasing](https://zipdj.com/?p=33273), [Violet Recording: common DJ mistakes](https://violetrecording.com/common-dj-mistakes-to-avoid/), [DJ Courses Online: 3 common mixing mistakes](https://djcoursesonline.com/dj-blog/2021/8/2/3-common-mixing-mistakes), [We Are Crossfader: 3 transitions for any genre](https://wearecrossfader.co.uk/blog/3-easy-transitions-to-mix-any-genre/), [DJ TechTools forum: 140 to 88 BPM](https://forum.djtechtools.com/t/how-do-i-transition-from-a-higher-bpm-140-to-a-much-slower-bpm-88/52941).

---

# The 15 Golden Rules (and How the App Follows Each)

| # | Rule | In the app |
|---|---|---|
| 1 | Match the speed (BPM) | Beatmatching within the BPM limits ("BPM Adjustment Rules"); small adjustments preferred |
| 2 | Mix at the right moment (phrases) | Exits and entries on 8 / 16 / 32-beat phrase starts (`planMix`) |
| 3 | Don't mix two vocals carelessly | Exit and entry chosen as a pair to avoid two vocals; a **quick cut** when both still sing (rule 8 above) |
| 4 | Bass swap | Old song's bass out over the first half, new song's bass in over the second |
| 5 | Harmonic mixing | Camelot key fit; clashing keys get at most 8 bars with a filter sweep, or a cut |
| 6 | Respect the energy | Set Flow: no energy drop on a dance floor, a **breather** after 5 peak songs, moods |
| 7 | Right technique per pair | "Ways to Mix" above: blend, filter, gap cut, loop roll, reverb, brake, echo |
| 8 | Match loudness | Every song levelled by its measured loudness; master limiter |
| 9 | Not too long | Length per mood and key fit (4–16 bars), a quick cut when vocals or tempos clash |
| 10 | Intros and outros | Talking intros and closing scenes skipped; entry in the build-up |
| 11 | No competing melodies | Same vocal/lead check as rule 3 |
| 12 | Surprises | Loop roll and brake now and then (at most once every 4 mixes), dhol fills, breathers |
| 13 | Keep the rhythm alive | The dhol wala (Live Rhythm Enhancer): locked to each song's beat grid, plays with the song (soft under singing, full on choruses, rolls and tihais), and carries the crowd through every mix: a light groove in blends, a dhol break and a roll landing on the new song's first downbeat in cuts |
| 14 | Don't force a bad mix | Gap cut, echo-out, quick cut on two vocals, brake, reverb wash |
| 15 | Prepare the next song | Analysed in the background as it arrives; mix planned up to 45 s ahead, the AI asked earlier still |

---

# Core Principle

A good transition must sound natural, maintain musical timing, control competing frequencies, and preserve the intended energy of the music. BPM matching alone is not enough; phrase alignment, vocal compatibility, song structure, and transition selection are equally important.

---

# Live Rhythm Enhancer (Deck P): the dhol wala

At an Indian wedding or baraat the dhol wala doesn't drum over everything: they play *with* the DJ to lift the music. They keep time softly while someone sings, answer in the gaps between vocal lines, roll into the chorus and land it with a big stroke, close a section with a tihai, and keep the crowd dancing while the DJ changes the song. The rhythm layer does exactly that, on real dhol and dholak samples. It is on by default and needs no musical choices. Code: `src/audio/rhythm/`.

## 1. Sound: real dhol and dholak

- Every stroke is a real recording (CC0 one-shots, sources in `public/percussion/CREDITS.md`): the dhol's **dagga** (bass side, the boom) and **tilli** (thin-stick crack), and the dholak's bass and treble heads. 3–4 takes each, rotated so the same take never plays twice in a row.
- Strokes: normal, accent, ghost (soft), **muted** (the hand damps the head: a short thud) and **flam** (a soft grace stroke 22 ms before an accent).
- Each stroke varies ±7 % in velocity and ±3 ms in timing (never on the beat itself), so it doesn't sound machine-made.
- **Bass management:** the bass heads are high-passed at 70–75 Hz and the treble heads at 200–300 Hz, so the dhol stays out of the song's kick and 808. A gentle compressor glues the layer before it joins the master bus.

## 2. Timing: locked to the song's beat grid

- Nothing loops. Every stroke is scheduled on the audio clock about 0.25 s ahead, at its exact place in the **on-air song's own beat grid** (BPM and downbeat, through the deck's start time and playback rate). It cannot drift, follows tempo changes and key-lock re-timing, and never changes pitch.
- After a seek, pause or new song it drops what was scheduled and locks on again within a beat.
- Songs above 140 BPM get the taal at **half-time** (as a dhol player plays 170 BPM bhangra), except in Party mood or for a folk meter.
- **Rule:** if the song's beat confidence is below 50 %, or its tempo is outside 70–200 BPM, the dhol waits and says why. A dhol off the beat ruins the music.

## 3. Taals

| Taal | Instrument | Feel | Suits |
| :--- | :--- | :--- | :--- |
| **Bhangra Chaal** | Dhol | The swinging chaal: dagga on the 1 and the lift before 3, tilli dancing in between | Punjabi songs, Bollywood dance numbers, baraat |
| **Dhamaal** | Dhol | Peak-time: a boom on every beat, driving tilli 8ths | The biggest bangers; songs whose own drums are soft |
| **Luddi** | Dhol | The bouncy lilting two-step | Punjabi folk: boliyan, giddha, jaago |
| **Dholak Keherwa** | Dholak | The 8-beat keherwa (dha ge na ti na ka dhi na), lighter than dhol | Bollywood, sangeet, mid-tempo and romantic desi songs |

Each taal has: a **light** bar (keeps time under the singing), the full **groove** (2–4 bars of variations), an **answer** phrase (beats 3–4) and a 2-bar **break** (solo). Rolls, tihais and accents are built from its two heads (`src/audio/rhythm/styles.ts`, `dholEvents.ts`).

## 4. Playing along with the song (the score)

Each song gets a score, bar by bar, from its loudness in 4-bar phrases (relative to its choruses) and a **vocal map** (`dholScore.ts`):

| Part of the song | What the dhol plays |
| :--- | :--- |
| Intro before the music, breakdowns (under 50 % of the chorus loudness) | Nothing |
| Singing (verse) | The **light** taal, softly; an **answer** phrase in a gap between two vocal lines (at most every other bar) |
| Chorus, the hook, or an **instrumental part** (nobody singing, 70 %+ loud) | The full **groove**, cycling its variations |
| The bar before a bigger section | A **roll** from beat 3: fast strokes getting louder, landing on the next 1 |
| The first bar of a chorus, or where a roll / tihai lands | An **accent**: a full boom with a flammed crack on the 1 |
| The last bar of a chorus before a quieter part | A **tihai**: one phrase played three times, louder each time, landing on the next 1 |
| The song's last phrase | Light (the ending belongs to the mix) |

- **Vocal map** (`computeVocalMap`): 10 times a second, the centre of the stereo mix in the voice range (300 Hz–3.4 kHz) minus the sides of that range (wide instruments, reverb), relative to the song's own singing level. It finds clear gaps between lines, not a transcription: an answer needs singing in the first half of the bar and a gap in the second.
- With **Steady all song** (manual mode) it plays the full groove wherever the music plays, with a roll every 8 bars.

## 5. Carrying the crowd through mixes

- **Cut between songs that can't be beatmatched:** the dhol keeps playing a **dhol break** on the old song's beat, ends it with a **~1.2 s roll** (timed in seconds: the two songs' beats don't agree) and lands an **accent exactly on the new song's first downbeat**, then follows the new song. A quick cut that lands within a bar gets a roll into that downbeat.
- **Beatmatched blend:** a **light groove** all through the blend, even over the old song's quiet outro (the crowd never loses the beat), with no rolls or tihais.
- If neither song gets dhol, it stays out of the mix. If only the new song does, the dhol rolls into it. If only the old one does, the bridge lands the accent on the new song and hands over.
- The bars already scheduled are re-planned the moment a mix starts or ends.

## 6. Which songs get the dhol (AI mode)

Every song gets a plan when it is analysed, well before it plays (`rhythmPlan.ts`). The song's language comes from known artists and scripts, else the AI DJ (asked once per song, remembered), else a guess.

| Song | Taal |
| :--- | :--- |
| Punjabi | **Bhangra Chaal**; **Luddi** for folk titles (boliyan, giddha, jaago, tappe, mahiya…); **Dholak Keherwa** in Chill / Romantic |
| Hindi, Party or Bhangra mood, 85+ BPM | **Bhangra Chaal** (dhol, the baraat way) |
| Hindi otherwise | **Dholak Keherwa** |
| English, Spanish, other | **No dhol** (a dhol doesn't belong on them), except in the **Bhangra** mood, which puts dhol on everything |
| Devotional (chalisa, aarti, bhajan, shabad, kirtan, naat…), beat confidence under 50 %, or under 75 BPM outside Party / Bhangra | No dhol |

How present it is, from the song's sound: 0.7 normally, 0.45 in Chill / Romantic; at most 0.5 when the song's own drums already hit hard; at most 0.55 when it is vocal-heavy; and when a dance song's own drums are soft, **Dhamaal** at 0.8 so the dhol carries the beat.

The card shows the plan, who identified the song (**🤖 AI**, **Known artist** or **Guess**) and why, e.g. *"Punjabi song, party mood: Bhangra Chaal (vocal-heavy)"*.

## 7. Live cues: asking the dhol wala

Big buttons on the laptop (Party and Pro views) and the phone remote, and typed commands ("dhol roll", "dhol break", "dhamaal", "rest the dhol"; these skip the AI model so they happen at once). A cue switches the dhol on if it was off.

| Cue | What happens |
| :--- | :--- |
| **Roll** | A roll from the next half beat to the bar line, landing with an accent. Too close to the bar line: it runs on through the next bar as one crescendo. |
| **Dhol break** | From the next bar line, 2 bars of the taal's solo break, then an accent and back to the song. |
| **Dhamaal** | Go big: the full Dhamaal on everything (accent every 4 bars, roll every 8) until tapped again. |
| **Rest** | Dhol out until tapped again, or until the next song starts. |

## 8. Controls

On/off, **🤖 AI decides / Pick the taal**, volume (multiplied by the plan's level in AI mode), mute and the four cues. In **Pick the taal**: the taal for every song and **Plays along with the song / Steady all song**. Typed commands also set the taal ("dholak", "luddi", "bhangra dhol") or stop it ("stop the dhol"). Settings are remembered in this browser. The panel redraws on its own as the dhol plays (cues, status). The **Bhangra** mood also switches the layer on.

**QA:** `node qa/dholQa.mjs` plays a Punjabi song in its own headless tab, logs every dhol stroke and checks the score (roll, accent, chorus), the four cues and the bridge through a cut, and records clips to listen to.

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

When people are dancing they want the energy of each song, not its full length. **Best Parts** mode plays every song from its build-up through its hook, then mixes into the next song's build-up. Each song is on air for **at most 1:30 by default** (a hard limit, adjustable 1:00–2:30) instead of 3–4 minutes.

Switch: **"Best parts only"** under the transport controls (Party console), **"Best Parts"** in the Master Mixer header, and **"Best Parts"** on the phone remote. It is off by default and remembered on this browser (`ai_dj_best_parts`). Next to the Party console switch, a picker sets the limit (max 1:00 / 1:15 / 1:30 / 2:00 / 2:30; `ai_dj_best_parts_max_seconds`). Moods don't change it. Code: `bestPartExitWindow`, `bestPartEntryRange` and `mixOutWindow` in `src/audio/AudioEngine.ts`; `earliestExit` and `entryRange` in `planMix` (`src/audio/MixPointPlanner.ts`).

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
- The on-air song keeps playing for **16 bars from its best part** (`BEST_PART_HOOK_BARS`, a full chorus; the best part is the later of its first chorus and its most-loved moment, `peakTime`), then mixes out at the **best phrase in the next 16 bars** (`BEST_PART_EXIT_BARS`): its *exit window*.
- Inside the window the normal exit rules choose the bar: phrase starts, a drop into a calmer section, few vocals, never fading out over the hook (Rules 3, 8, 9).
- The auto-mix treats the end of the exit window as the song's end: it plans the mix (and asks the AI DJ ahead of time) 45 s before it, exactly as it would before a real outro.
- **Never cut a phrase short to hit a time:** the exit is always a bar start chosen for musical reasons inside the window.

## 4. The hard limit (`bestPartsMaxSeconds`, default 90 s) and 30-Second Minimum Playback
- **Minimum Play Duration (at least 30 seconds):** Every song in Best Parts mode (or after jumping to a hook with "Best part") must play on air for **at least 30 seconds** (`BEST_PART_MIN_PLAY_SECONDS = 30`) before the engine is permitted to mix it out on its own. Automatic mixes (`planOutroMix`) are suppressed until 30 seconds have elapsed, and the earliest allowable exit point (`earliestExit`) is held to at least `playStart + 30s`.
- Counted from where the song came in (its entry point, or where the listener jumped to with a seek / Best part), mix included: the old song is **half faded by the limit** (`latestExit` in `planMix`).
- Everything else works **inside** the limit: the exit window, the phrase search, the "never in a high part" wait and gap cuts. If a high part runs past the limit, the best bar before the limit is used.
- An exit window running past the limit ends at it; one starting after the limit is dropped and the exit is chosen in the 45 s before the limit.
- If the limit passes with no next song ready, the song keeps playing and mixes out within ~8 s of a song being ready.
- Not limited: songs under 2 minutes, strict-start songs, and the Manual Mix / Next buttons.

## 5. When a song plays whole
- **Short songs:** under 2 minutes (`BEST_PART_MIN_SONG_SECONDS = 120`) play whole.
- **Late hook:** if the exit window would run into the song's last 22 seconds, the exit isn't tied to the hook; the hard limit still applies.
- **Not analysed yet:** before its analysis has found the hook, the exit isn't tied to the hook; the hard limit still applies.
- **First song of the set:** it still starts from the music start (never from the hook). Its exit follows the Best Parts rule.

## 6. When the next song isn't ready
- The song keeps playing; nothing is cut into silence.
- Once a song is ready after the exit window has passed, the mix happens at the best bar in the **next 16 bars**.

## 7. What doesn't change
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

## Tempo Detection (Which Songs Can Be Beatmatched)

Two songs are beatmatched only when both tempos have a confidence of at least 0.6 and the new song needs at most **±8%** (`BLEND_MAX_SHIFT`: beyond that a blend sounds pitch-bent; -15% is over a semitone flat); otherwise the mix is a smooth fade (`BpmDetector.ts`). The ±16% limit below is for a set tempo you lock yourself.

- **Kick and bass first:** the tempo comes from the low band (under 150 Hz) when its pulse is clear (0.6 or more). This is unchanged from before, so songs that were confident keep their tempo.
- **Otherwise all three bands:** low (at half weight), mid (150 Hz – 2 kHz: snare, claps, dholak) and high (over 2 kHz: hats, shakers, dhol crack). Many pop and desi songs carry their pulse there, not in the kick.
- **Beat position from the kick and bass:** the grid and the "1" still come from the low band, because hats would pull the beat toward the off-beat.
- **Tempo vote (`voteTempo`):** the tempo is measured on the whole song and again on four separate 40 s stretches, each with the low band and all bands. Every estimate of 0.4 or more votes for its tempo family (half / double time counts as the same; a stretch votes once, by its stronger estimate; the low band counts 10 % more). The family with the most support wins; its BPM is the median of the estimates within 0.3 % of its strongest one (wider readings, e.g. 124.3 vs 125.06, are two readings, not one tempo).
- **Stability:** a tempo most stretches confirm (3 of 4, 2 of 3) is trusted (confidence at least 0.7) even when no single estimate was very sure; one most don't confirm is capped at 0.55, so the song is never beatmatched on a tempo that drifts.
- **QA, 30 songs (Nov 2026):** trusted for beatmatching 17 → 25 (the 5 left have drifting or weak beats). Fixed: a low band confident at the wrong tempo (141.7 vs 124 everywhere else), a weak whole-song pass with certain stretches (158.6 at 0.26 vs 81.0 at 1.0), a steady 118 that no single estimate was sure of. `node qa/bpmDiagnostics.mjs` shows every stage for cached songs.
- **Measured on 200 cached songs:** a confident tempo for **62 %** of songs (was 34 %). Every song that was confident before kept its tempo. Known tempos that are now right: We Don't Talk Anymore (100), Closer (95), As It Was (174), Drop It Like It's Hot (92), 295 (90). Tempos that were confidently wrong are now flagged as unsure (e.g. This Is What You Came For: 141.7, really 124). Shape of You is still wrong (127.7, really 96) but stays unsure (0.27), so it is cut, not beatmatched.

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
4. **Small tempo steps** (half and double time count as the same tempo). An expert keeps neighbours within a few percent and changes tempo on purpose, now and then:
   - a step of 3% or less gains 1; up to 6% gains 0.5;
   - a step over 6% loses 0.5; over 10% loses 1.5;
   - a jump over 16% loses 3, or only 1 once 20 minutes have passed since the last such jump (a deliberate tempo change is due).
5. **Language runs:** a few songs (3) in one language before switching. An earlier switch loses 0.7. This only counts when the language is known for sure (script, artist or label). After 2 or more Hindi / Punjabi songs in a row, an English song loses 3 more (see "Language at the Top of Up Next").
6. **No energy drop on a dance floor:** in Party or Bhangra mood, a song more than 3 dB quieter than the one on air loses 1.
7. **Breathers:** on a dance floor, after 5 songs in a row with no step down in energy (no song at least 1.5 dB quieter than the one before it), a song 1.5–6 dB quieter than the one on air **gains** 0.8 instead of losing points, so people get a breather. A song more than 6 dB quieter still loses 1: a breather, not an empty floor.
8. **Queue order still counts:** each place further back costs 0.6, so the queue wins unless another song flows clearly better.
9. **Up Next arranged for each song** (`arrangeUpNextForFlow`): a few seconds after a song goes on air, the next 10 ready songs are ranked by these same rules (each place further back costs only 0.15 here) and the best 3 move to the top, so the mix and the AI DJ choose among songs that flow. Requested songs keep their place, and a request first in line isn't jumped. Off when auto-curation is off. The song moved up shows why in Up Next ("Moved up for the flow: …").
10. **The AI DJ is told the tempo step:** when it picks the next song, each ready song is labelled *"tempo step 3% (can blend)"* or *"tempo jump 25% (forces a cut)"* (8% or less blends; half and double time count), and it is asked to prefer songs that can blend.
11. **Shown:** the reason appears as the AI DJ decision, e.g. *"Next: Softly — a different artist; its key fits; "G.O.A.T." would be same artist again"*.

**Why:** the craft sources agree that a set is shaped as waves of energy rather than a random order or a flat line. Big tempo jumps need planning, and abrupt changes of genre or energy lose the floor. See [DJ.Studio: anatomy of a great mix](https://dj.studio/blog/anatomy-great-dj-mix-structure-energy-flow-transition-logic), [ZipDJ: how to structure a set](https://zipdj.com/blog/how-to-structure-a-dj-set) and [DJ Will Gill: setlist flow](https://djwillgill.com/pro-tactics-for-flawless-song-selection-for-dj-setlist-flow/).

---

# Language at the Top of Up Next

When Hindi / Punjabi songs play back to back, English songs don't sit at the top of Up Next (`keepDesiOnTop` in `AudioEngine.ts`, `moveWesternDown` in `engine/queueRules.ts`):

1. **When:** the last **2** songs on air (incl. the one playing) were Hindi or Punjabi. Hindi and Punjabi count as one group (desi): they mix freely at a desi party.
2. **What happens:** English (and Spanish) songs move to the **end** of Up Next, keeping their order. Done when a song starts and whenever songs are added to Up Next.
3. **Never moved:** songs someone chose (search, request) and the song being mixed in right now.
4. **Following your choice:** when you search and play only Hindi / Punjabi songs, the songs picked "like your picks" leave out English songs, even before the run of 2.
5. **Which language a song is** (`languageFamily` in `shared/songLanguage.ts`): the script, artist or label first; then the AI DJ's earlier answer for that song; then common Hindi / Punjabi words in the title (*dil, tera, ishq, nachde…*). Any other plain Latin-alphabet title counts as English.
6. **Play an English song yourself** and the run ends, so English songs are welcome again.

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

# Following the Listener's Mood

When the listener chooses songs themselves (searched and played, or added), the **type** of those songs is followed, not just the one song: Shararat (Dhurandhar) then Aaj Ki Raat → item songs.

- **The run:** the last 3 songs they chose within 45 minutes of each other (`MOOD_RUN_SONGS`, `MOOD_RUN_MS`), newest first.
- **Where the songs come from:** `/api/similar` reads each song's "people who play this also play" list. A song on the lists of several of the chosen songs is that type for sure and ranks first; the newest song's list counts most. The songs most surely of the type are then asked about too (second step), so the picks are many songs of that type rather than one list's mix. Only if that finds too few, the AI's ideas (its fixed fallback lists only when nothing else came).
- **How many and where:** at least 6 (`MOOD_PICKS`), at the top of Up Next right after the songs the listener queued themselves. They stay there together when Up Next is reshuffled (`moodPick`, `isPinned` in `queueRules.ts`). A new choice replaces the previous picks that haven't started loading.
- **Staying with the type:** when one of those picks plays (mixed in, or chosen from Up Next), the listener is staying with that type, so 3 more of it (`MOOD_MORE`) join the end of the picks, keeping at least 6 and at most 10 waiting (`MOOD_MAX_WAITING`). It's researched from the pick that's playing together with the songs the listener chose themselves (the anchors), so one off-type pick doesn't drift the type away. Picks don't become anchors; after 45 minutes without a choice of their own, the playing pick alone sets the type.
- **Same rules as any automatic pick:** at most 6 minutes, no 8D or mashups, nothing played in the last 3 hours, nothing on "Don't Play Again Ever", and the AI chat's filter. Each shows why it's there ("Like your picks: played with both …").

# Live Phase Lock (Beatmatched Blends)

Matching two songs' tempos isn't enough: each beat grid comes from analysis and can sit a fraction of a beat off. QA measured kicks 60–123 ms apart in beatmatched blends (a flam; Music Flamingo heard "beat clashes" in exactly those). So, like a DJ riding the jog wheel by ear (`PhaseLock.ts`, `schedulePhaseLock`):

- During every beatmatched blend of 6 s or more, both decks' kick and bass (before the EQ, so both kicks are heard while one's bass is cut) are followed on the audio thread in 5 ms frames.
- After 6 beats (at least 2.5 s), each song's beat phase is measured on its own (onsets folded over the beat, `beatPhase.ts`) and the distance between them taken. Both need a clear beat (clarity 2+).
- More than 12 ms apart: the new song is nudged onto the old one's beat, played at most 4% faster or slower for about a second (`VirtualDeck.nudge`), not heard as a pitch bend. A second check a few seconds later fixes what's left. The status line says "Beats locked by ear (nudged … ms)".
- QA (Nov 2026): beatmatched blends 29–32 ms apart after it (was 60–123 ms).

Also from QA: the new song's start is computed from the old song's position at the moment it starts (it was read before the new song's analysis, putting its first beat late), and beatmatching uses the exact tempo, not the display value rounded to 0.1 BPM.

**Long pauses aren't waited out:** a gap cut into a stop of a beat or two is kept (a DJ uses it), but when the old song's pause is longer than 1.2 s (`HEARD_GAP_SECONDS`), the new song drops in on its first beat instead of after it: 1.75 s of silence is dead air.

# Previous

Each press of Previous (console or phone) steps one song further back through Previously Played (`prevTrack`): 10 presses = 10 songs back, back to back, each switched to **directly** from its music start (never its hook): a 0.2 s fade against clicks, at the song's own tempo, no blend and no echo, because Previous is pressed when someone asks for a song (exempt from the no-abrupt rule; a mix running is cut short). Fast presses are counted and only the song they end on is loaded. The list is taken at the first press and walked from there; any other song starting ends the walk (and so does 20 s without a press). It never restarts the song on air (a hard jump), and no longer cross-fades to whatever the other deck still held (which only bounced between the last two songs). QA: `node qa/previous.mjs`.

# Soft Pair (Slow Ballads)

Two songs without a steady beat (acoustic ballads such as Anuv Jain "Jo Tum Mere Ho" into Navjot Ahuja "Khat": beat clarity 0.50 and 0.31, tempo readings meaningless), or one without and the other slow (100 BPM or less), cross in a **long gentle fade**: 20 s in Romantic / Chill, 16 s in Normal, 10 s in Party / Bhangra (`SOFT_FADE_SECONDS`, `softPairFadeSeconds`). There is no beat to clash, so the quick 4–9 s fade (meant for two drum tracks that can't be beatmatched) made them feel rushed. No echo tail; the exit is planned with room for the whole fade, so it never runs into the song's ending. Two songs with clear beats never get this: a long unsynced overlap of drums would flam. QA: `node qa/softPair.mjs [mood]`.
