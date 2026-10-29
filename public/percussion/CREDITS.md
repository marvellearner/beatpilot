# Rhythm sample credits

Every sound here is a one-shot cut from a recording on [Freesound](https://freesound.org) that its uploader released under **CC0 1.0 (public domain)**. CC0 needs no attribution, but the sources are listed so each file can be traced. The licence of every source was checked on its own Freesound page on 2026-10-29.

How the cuts were made: each hit starts 2 ms before its attack (so it lands on the beat), gets a 1 ms fade-in and a cosine fade over the last 35 %, and is levelled to a -1 dBFS peak, saved as 16-bit mono 44.1 kHz WAV. The sources were Freesound's high-quality MP3 previews.

| Files | Sound | Source |
| :--- | :--- | :--- |
| `dhol_bass_1–4.wav` | Dhol bass side ("dagga") | [Dhol outside.wav](https://freesound.org/people/makbulchowdhury/sounds/172446/) by makbulchowdhury |
| `dhol_crack_1–4.wav` | Stick crack (dhol-tasha) | [Dhol_Tasha_Maharashtra_Urban_2](https://freesound.org/people/prospekt42/sounds/712286/) by prospekt42 |
| `dholak_ge_1–3.wav` | Dholak bass head | [Maybe Dollak Drum Freestyle Jamming](https://freesound.org/people/qubodup/sounds/865161/) by qubodup |
| `dholak_ge_4.wav` | Dholak bass head | [DHOLAK (BASS SKIN)](https://freesound.org/people/curesforbrokenhearts/sounds/536872/) by curesforbrokenhearts |
| `dholak_na_1–4.wav` | Dholak treble head | [DHOLAK-085-01.wav](https://freesound.org/people/iyankc/sounds/479246/) by iyankc |
| `stick_1–3.wav` | Stick click | [Little Drum Tuning Sticks Clicking and Clacking](https://freesound.org/people/qubodup/sounds/865159/) by qubodup |
| `tambourine.wav` | Tambourine | [Tambourine_Single_Hit_ 4](https://freesound.org/people/radiopassiveboy/sounds/219267/) by radiopassiveboy |
| `shaker.wav` | Shaker | [Shaker (shake5.wav)](https://freesound.org/people/sgossner/sounds/375636/) by sgossner |
| `maraca.wav` | Maraca | [Big Maraca OS 1](https://freesound.org/people/Sadiquecat/sounds/792505/) by Sadiquecat |
| `clap.wav` | Clap | [Clap.wav](https://freesound.org/people/PopoMagoo/sounds/612833/) by PopoMagoo |
| `kick.wav` | 909-style kick | [909 kICK.WAV](https://freesound.org/people/ZeSoundResearchInc./sounds/145775/) by ZeSoundResearchInc. |
| `conga.wav` | Conga | [Kygo Tropical Conga Percussion Hit](https://freesound.org/people/Cloud-10/sounds/678748/) by Cloud-10 |
| `frame_drum.wav` | Frame drum | [Frame drum_oneshot_RAW_15.wav](https://freesound.org/people/cabled_mess/sounds/345635/) by cabled_mess |

## Swapping in your own samples

Replace any file with your own recording under the same name (a short WAV or MP3 that starts right at the hit), then reload the app. Add or remove takes in `VOICES` in `src/audio/rhythm/kit.ts`, where each sound's level, low cut and stereo position are also set.
