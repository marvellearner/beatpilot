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
   ollama pull qwen2.5:3b
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

- **Keeps the queue full:** it always tries to have 5 songs lined up, adding similar songs automatically.
- **Mixes automatically:** about 14 seconds before a song ends, it blends smoothly into the next one.
- **Plays the best part:** with **Auto-Cue: ON**, the next songs start just before their most popular part. Turn it **OFF** if you'd rather every song play from the start.
- **Never goes silent while loading:** if the next song isn't ready yet, the current song keeps playing.

---

## 5. Main Controls

| Button | What it does |
| :--- | :--- |
| ▶ **PLAY** / ⏸ **PAUSE** | Play or pause the current song. With nothing loaded, PLAY starts the first ready song in the queue. |
| ⏮ **Previous** | Restart the current song. |
| ⏭ **Next** | Mix into the next ready song. |
| ⟲ / ⟳ | Jump back or forward 10 seconds. |
| ■ **STOP** | Stop all music and drums. |
| 🔥 **PLAY BEST PART** | Jump straight to the song's most popular part. |
| **Slider** | Drag to move to any point in the song. |

---

## 6. Add Dhol or Drums (Optional)

In the **Live Rhythm Enhancer** card:

1. Pick a style: **Punjabi Dhol**, **Bhangra**, **Club Drums** or **Afrobeat**.
2. Pick a feel: **Subtle**, **Party Bounce** or **Peak**.
3. Press **Start** to play the drums, or **Mute** to silence them.

**Auto mode:** turn it on and the app chooses the drum style for each song and keeps the drums in time with it. It stays quiet on slow songs, or when it can't detect the beat clearly, so the drums never clash with the music.

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

## 9. Typing Instructions to the AI (Optional)

Use the bar at the bottom of the screen. Examples:

- *Switch to Bhangra Dholak & Chimta beat*
- *Mix into Deck B with energetic Punjabi Dhol*
- *Kill low bass on Deck A*

This works best with Ollama running (see [§1](#1-one-time-setup)). Without it, the app still understands simple keywords.

---

## 10. Pro Mode (Optional)

Click **🎛️ Pro Decks** at the top for full manual control:

- Two decks.
- Bass, mid and treble controls.
- A tempo slider.
- The crossfader.
- Loading MP3 or WAV files from your computer.

Click **✨ Party Console** to return to the simple view.

---

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
| iPhone says "server stopped responding" | Run the firewall command in [§1](#1-one-time-setup), and check that both devices are on the same Wi-Fi. |
| iPhone can't find the laptop on the same router | You may be on a guest network. Move both devices to the main Wi-Fi. |
| Drums sound off-beat | Press **Mute**, or turn off auto mode for that song. |
| Song sounds slightly fast or high | This is normal for a few seconds after a mix. The song glides back to its normal speed within about 15 seconds. |
| App stopped completely | Make sure the PowerShell window running `npm run dev` is still open. If not, start it again. |

For technical details, see [ARCHITECTURE.md](ARCHITECTURE.md) and [SETUP_AND_OPERATIONS.md](SETUP_AND_OPERATIONS.md).
