# AI DJ — User Guide

A quick guide to running a party with AI DJ. You don't need any DJ experience.

---

## 1. One-Time Setup

Do this once, on the laptop.

1. Install [Node.js](https://nodejs.org/) (version 20 or newer).
2. Open PowerShell in the project folder and install the app:
   ```powershell
   cd C:\Users\sarth\Personal_projects\Ai-DJ
   npm install
   ```
3. *(Optional)* Install [Ollama](https://ollama.com/) and download the AI model. This lets the app understand typed instructions. Everything else works without it.
   ```powershell
   ollama pull qwen2.5:1.5b
   ```
4. *(Only if you'll use the iPhone remote)* Allow the phone to reach the laptop. Open PowerShell **as Administrator** and run:
   ```powershell
   New-NetFirewallRule -DisplayName "AI-DJ-DevServer" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
   ```

---

## 2. Start the App

1. Connect the laptop to your speakers.
2. In PowerShell, in the project folder, run:
   ```powershell
   npm run dev
   ```
3. Open **http://localhost:5173/** in Chrome or Edge.

Leave the PowerShell window open while you use the app. Closing it stops the app.

---

## 3. Start the Music

Choose one of these on the **Party Console** screen:

| Option | How |
| :--- | :--- |
| **Any song** | Type a song name (e.g. *Diljit Dosanjh Lover*) or paste a YouTube link, then press **Mix Now**. |
| **Your favourites** | Press **Start With This** next to one of your most-played songs. |
| **Your own list** | Press **Load my_songs.txt**. See [§8](#8-your-song-list-my_songstxt). |

The first song plays from the beginning. While it loads you'll see **Searching → Downloading → Decoding**, which usually takes a few seconds.

---

## 4. Let It Run

Once a song is playing, the app looks after the party:

- **Keeps the queue full:** it proactively maintains up to 50 songs lined up in the Up Next queue, auto-seeded from your favourites, most played bangers, past history, and AI recommendations.
- **6-Minute Song Cap:** The engine will never automatically add any song longer than 6 minutes to the queue. (Explicit searches and plays by you can be any length).
- **AI Mood Reading:** Whenever you search and play a song, the AI reads your current vibe/genre and pushes the top 5 matching songs to the front of the queue so they play next.
- **7-Skip Auto-Removal:** If the song at the top (#1) of Up Next is avoided 7 times while other songs are played, the app automatically drops it from the queue with an on-screen warning badge (`⚠️ Skipped X/7`).
- **Thumbs Down ("Don't Play Again Ever"):** Every queue item has a Thumbs Down (👎) button. Clicking it permanently bans the song, instantly drops it, and prevents it from ever being auto-queued again.
- **Previously Played history:** songs appear in the Previously Played list as they finish mixing in. **No two consecutive songs in previously played can ever be the same**, and songs present in previously played are strictly prevented from appearing in the Up Next queue.
- **Mixes automatically:** about 20 seconds before a song ends, it blends into the next one with the beats lined up. In the final stretch it gently nudges the tempo toward the next song, so the two meet at the same BPM. If two songs' tempos are too far apart, it does a quick, clean cut on the beat instead of a messy blend.
- **Best parts only (for dancing):** switch on **Best parts only** and every song plays just its build-up and hook (about 1–1.5 minutes), then mixes into the next song's build-up. Songs under 2 minutes play whole. Switch it off to hear songs through to their outro. Rules: MIXING_RULES.md "Best Parts Mode".
- **Never goes silent while loading:** if the next song isn't ready yet, the current song keeps playing.
- **Real-Time RAM Usage Meter:** The top navigation bar displays a live RAM gauge showing system memory (GB and percentage), process footprint (AI DJ server RSS), and browser JS/audio heap with interactive health telemetry on click/hover.

---

## 5. Main Controls

| Button | What it does |
| :--- | :--- |
| ▶ **PLAY** / ⏸ **PAUSE** | Play or pause the current song. With nothing loaded, PLAY starts the first ready song in the queue. |
| ⏮ **Previous** | Restart the current song. |
| ⏭ **Next** | Mix into the next ready song at the **best moment in the next 30 seconds**, e.g. where the current song drops into a breakdown, timed so the new song's drop lands as the blend ends. A banner shows the countdown. Press Next again (or **Mix now**) to skip the wait, or **Cancel**. |
| ⟲ / ⟳ | Jump back or forward 10 seconds. |
| ■ **STOP** | Stop all music and drums. |
| 🔥 **Best part** | Jump straight to the song's most popular part. |
| **Slider** | Drag to move to any point in the song. |

**Tempo** (under the buttons, also on the iPhone). It changes the speed of the song that's playing:

| Control | What it does |
| :--- | :--- |
| **0.5x / 0.9x / 1.0x / 1.1x / 1.2x / 1.5x** | Play slower or faster. Any speed from 0.5x to 1.5x works. |
| **− / +** | Nudge the tempo down or up by 1 BPM. |
| **BPM box + Set** | Type an exact tempo, e.g. `128`. |
| **🔒 Key Lock: ON** (default) | Speed changes but the **pitch stays the same**. Voices don't go chipmunk or deep. The change takes about a second to prepare, then switches in smoothly at the same spot in the song. |
| **Key Lock: OFF (vinyl)** | Instant, like a record player: faster also sounds higher. |
| **Whole set at this BPM** | Every following song is also tuned to this tempo, so every mix is at exactly the same BPM. |
| **Always original BPM: ON / OFF** | **ON:** songs play at their **original BPM**, ignoring the party/set tempo and any speed change. It stays on for the next songs too. **OFF:** the set tempo (if any) applies again. Pressing a speed button or **Set** turns it off. |

The display shows **Original** BPM and **Current** BPM side by side, plus the speed (e.g. `1.10x (+10%)`). The setting applies to the song that's playing; with **Whole set** on, it carries on to the next songs.

**AI chat** (the instruction box at the bottom). Song requests take effect at once; mixing, drum and EQ instructions go to the AI DJ.

| Type | What happens |
| :--- | :--- |
| `play only Diljit Dosanjh songs` (also `only …`, `just …`, `… only`, several artists with `and`) | Up Next keeps only that artist's songs and refills with their hits. If the song on air is by someone else, the app mixes into one of theirs within 45 s. A chip on Up Next shows **Only: Diljit Dosanjh**, with ✕ to clear it. |
| `play more AP Dhillon` | New picks favour that artist; other songs still play. |
| `play anything` / `back to normal` | Clears the artist filter. |
| `play Lover by Diljit Dosanjh` | Finds the song and mixes it in next. |
| `kill the bass on deck A`, `start the dhol`, `smooth crossfade` | Handled by the AI DJ (it can take up to 30 s on a laptop CPU). |

An instruction the app doesn't understand does nothing, and the reply says so. It no longer guesses a mix.

---

## 6. Dhol and Drums (Automatic)

The **Live Rhythm Enhancer** card adds real dhol, dholak and percussion on top of the song that's playing. It's on the laptop (Party and Pro views) and on the iPhone remote.

**You don't have to choose anything.** It's on by default with **🤖 AI decides**: for each song the AI DJ works out what kind of song it is, and the app picks the drums to suit it and your mood. For example, dhol for Punjabi songs, dholak for Bollywood, claps and tambourine for English pop, a club groove for EDM. It stays lighter on songs that already have heavy drums or lots of vocals, and adds nothing to devotional songs or songs with an unclear beat. The card shows what it chose for the song and why.

All you might want to touch:

- **ON / OFF** for the whole layer.
- **Volume** slider and the speaker button (mute).

**Pick drum style** is there if you ever want one fixed style for every song:

| Style | Best for |
| :--- | :--- |
| **Dhol Dhamaal** | The biggest Punjabi and Bollywood bangers |
| **Dholak Keherwa** | Bollywood, sangeet, folk |
| **Clap & Tambourine** | Almost anything, especially songs with strong drums already |
| **Club Tops** | House, EDM, remixes |
| **Club Drive (with kick)** | Songs with soft or no drums |
| **Afro Groove** | Afrobeats, amapiano, reggaeton, Latin |
| **Light Shaker** | Chill and romantic songs |

**What it does during each song:**

- It plays exactly on the song's beat, even when the tempo changes. Very fast songs get the groove at half speed, like a real dhol player.
- It sits out the intro and quiet parts, plays a **light groove** in verses and the **full groove** in choruses, with a **fill** leading into big moments.
- During a mix it plays lighter, or rests if the two songs are cut together.
- If it can't hear a clear beat, it rests rather than play out of time. The card says why.

The card's grey line always says what it's doing, e.g. *"🤖 Dhol Dhamaal: chorus energy: full groove"*.

It can't yet tell a slow love song from an upbeat one in the same language. If drums come in on a ballad, mute them for that song.

---

## 6b. Mood & Equalizer

The **Mood & Equalizer** card is below the drums card on the laptop, and also on the iPhone remote.

**Mood:** one tap sets the sound, the mixing style, and the kind of songs the AI adds.

| Mood | Sound | Mixing | Songs the AI adds |
| :--- | :--- | :--- | :--- |
| 🎵 Normal | Flat | 8-bar blends | Popular mix |
| 🎉 Party | Punchy bass, crisp highs | **Every song tuned to one dance tempo (120–130 BPM)** without changing its pitch, so every mix is at the exact same BPM. 8-bar blends. | Upbeat bangers |
| 🥁 Bhangra | Heavy bass + **dhol switched on** (Dhol Dhamaal) | Short 4-bar mixes | Punjabi / bhangra |
| 🌙 Chill | Warm, soft highs | Long 16-bar blends, songs from the start | Mellow songs |
| 💕 Romantic | Warm vocals | Long 16-bar blends, songs from the start | Love songs |

**Equalizer:** five sliders, from −12 to +12 dB, that shape the whole sound, songs and dhol together.

- **🔊 Bass:** kick, 808 and dhol thump.
- **Low-Mid:** warmth. Too much sounds muddy.
- **Mid:** vocals.
- **Presence:** clarity and the dhol's crack.
- **Treble:** hi-hats and sparkle.

How the sliders behave:

- Double-click a slider to flatten it.
- **Reset** returns to the current mood's preset.
- Boosting automatically lowers the volume slightly, so cranking the bass makes it fuller without distorting the speakers.

Your mood and EQ are remembered next time you open the app.

---

**The 🤖 AI DJ:** when Ollama is running (the header says **"🤖 AI DJ: Qwen 2.5 3B online"**), the AI chooses where to mix, whether to blend or cut, and which song plays next. Its reasons appear with 🤖 in the mix banner.

- It takes a few seconds to think, so the music never waits for it.
- If Ollama isn't running, the header says "AI DJ offline", and mixing uses the built-in rules.

---

## 7. Control It from Your iPhone

1. Connect the iPhone to the **same Wi-Fi** as the laptop. Don't use a guest network.
2. On the laptop, click **Connect iPhone Remote** to see the address, e.g. `http://192.168.29.190:5173/?remote=true`.
3. Open that address in **Safari** on the iPhone.
4. *(Recommended)* In Safari, tap **Share → Add to Home Screen** to get a full-screen remote.

From the phone you can play, pause, skip, search and add songs, jump to the best part, and control the drums.

The music always plays from the laptop. If the phone locks, gets a call or disconnects, the music keeps playing. Open the remote again and it reconnects by itself.

---

## 8. Your Song List (`my_songs.txt`)

`my_songs.txt` is a plain text file in the project folder. Open it in Notepad, or edit it inside the app.

```text
# Lines starting with # are ignored
Sidhu Moose Wala - 295
Diljit Dosanjh - Lover
https://www.youtube.com/watch?v=kJQP7kiw5Fk
```

- Put one song per line, as a song name or a YouTube / YouTube Music link.
- Press **Load my_songs.txt**. If nothing is playing, the first song starts right away and the rest are queued.

---

## 8b. Offline Music (Bad or No Wi-Fi)

The **📁 Local Music** card (Party console, middle column) keeps songs on the laptop, so the party carries on without internet.

**Your liked and most-played songs are saved by themselves.** Every song you **like** (♥) and every song played **2 times** is saved as an **MP3** in the `music/Most Played` folder. Songs that aren't downloaded yet are fetched in the background, one at a time, through the same third-party source the app plays from (never from YouTube directly). The sync runs at startup, every 30 minutes, and right after you like a song. The Local Music panel shows how far it has got, e.g. *"Offline sync: 57 of 58 liked / most played saved"*. A song that can't be fetched is tried again after 6 hours. Saved songs play instantly and offline, even after the download cache has been cleaned up.

**Add your own music** (MP3, WAV, FLAC, M4A, AAC, OGG, Opus):

- **Add files** or **Add folder**, or **drag songs or a whole folder onto the card**. They're copied into the app's `music/Uploads` folder.
- Or type a folder on the laptop (e.g. `D:\Music`) and press **Scan**. Those files stay where they are. **×** stops scanning a folder, and **⟳** looks for new or changed files.

Songs show up by their tags' title and artist, or as "Artist - Title" from the file name.

**Without internet:**

- The light on the card turns 🔴 **Offline**. **Search** (laptop and phone) finds local songs, and they're listed first even when you're online.
- **Up Next** fills itself from the local library: songs in the same language as the one playing first, then your most played. The no-repeat rules still apply.
- Songs in Up Next that were never downloaded can't play, so the app skips them.

**Use only local music** makes Up Next come from the laptop even when the internet works, for example on a slow venue Wi-Fi.


Use the bar at the bottom of the screen. Examples:

- *Switch to Bhangra Dholak beat*
- *Mix into Deck B with energetic Punjabi Dhol*
- *Kill low bass on Deck A*

This works best with Ollama running (see [§1](#1-one-time-setup)). Without it, the app still understands simple keywords.

---

## 10. Pro Mode (Optional)

**Hot cues and loops** (on each deck in Pro mode):

- **Hot cues 1–4:** tap an empty pad (**Set**) to save the current spot, snapped to the beat. Tap a saved pad to jump there. **×** clears it. They're remembered per song.
- **Loops ⟲1, ⟲2, ⟲4:** loop 1, 2 or 4 bars from the start of the bar that's playing, to stretch a build-up. Tap the same button again to carry on. The dhol stays on the beat. Looping the song on air cancels a planned mix, since you're holding the song.
- **KEY** shows the song's key as it sounds at the current speed. Grey means the app isn't sure of it, so it isn't used for mixing.

Click **🎛️ Pro Decks** at the top for full manual control:

- Two decks.
- Bass, mid and treble controls.
- A tempo slider.
- The crossfader.
- Loading MP3 or WAV files from your computer.

Click **✨ Party Console** to return to the simple view.

---

**AI lights** (header): a 🟢 green or 🔴 red light each for **Ollama** (the local AI, used first) and **Gemini** (the cloud backup). Grey Gemini means no API key is set. Hover a light to see why it's red. The AI DJ works if either is green; with both red, mixing uses the built-in rules.

## 11. Party-Night Checklist

- [ ] The laptop charger is plugged in.
- [ ] The Windows power mode is set to **High Performance** or **Best performance**.
- [ ] Closing the lid is set to **Do Nothing** (Control Panel → Power Options → *Choose what closing the lid does*).
- [ ] The laptop and iPhone are on the same Wi-Fi.
- [ ] Your first few songs are queued and show **READY** before guests arrive.

---

## 12. Troubleshooting

| Problem | Fix |
| :--- | :--- |
| No sound | Check the speaker cable and volume, then press **PLAY**. Browsers only allow sound after you click something on the page. |
| Song stuck on *Downloading* or shows *FAILED* | Try a different name or paste the exact YouTube link. Check the internet connection. |
| **Next** does nothing | The next song is still loading. The status line at the bottom tells you. Wait for **READY**. |
| I pressed Mix but nothing happened yet | It's waiting for a good blend point (up to 30 s). Watch the "Mixing into … in Ns" banner, or press **Mix now**. |
| iPhone says "server stopped responding" | Run the firewall command in [§1](#1-one-time-setup), and check that both devices are on the same Wi-Fi. |
| iPhone can't find the laptop on the same router | You may be on a guest network. Move both devices to the main Wi-Fi. |
| Drums sound off-beat | Press **Mute**, or turn off auto mode for that song. |
| Song sounds slightly fast or high | This is normal for a few seconds after a mix. The song glides back to its normal speed within about 15 seconds. |
| App stopped completely | Make sure the PowerShell window running `npm run dev` is still open. If not, start it again. |

For technical details, see [ARCHITECTURE.md](ARCHITECTURE.md) and [SETUP_AND_OPERATIONS.md](SETUP_AND_OPERATIONS.md).
