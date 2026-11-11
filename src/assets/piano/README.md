# Salamander Grand Piano — bundled piano samples

**Salamander Grand Piano by Alexander Holm**, licensed under
[Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).
The sampled instrument is a Yamaha C5 grand piano. Original recordings were made
at 48 kHz / 24 bit using two AKG C414 microphones, with 16 velocity layers and a
sample every minor third.

## Source and attribution

- Original library: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3).
- Author and license independently documented by
  [FreePats](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#SalamanderGrandPiano).
- MP3 distribution: [tambien/Piano (@tonejs/piano), commit 0cd2c034f820c53e83ab22f5c13bd490b9e4de85](https://github.com/tambien/Piano/tree/0cd2c034f820c53e83ab22f5c13bd490b9e4de85/audio).
  Its README identifies the samples as Salamander Grand Piano V3.
- Original author's accompanying README, including the explicit CC BY 3.0 grant,
  is preserved in `UPSTREAM-README.txt`, from
  [Tonejs/audio at efd8296360f9526e379bfbe5c1698ff54d6a1d34](https://github.com/Tonejs/audio/blob/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander/README).
  The upstream README retains a V2 heading but includes the V3 changelog.
- Complete license: `LICENSE-CC-BY-3.0.txt`, retrieved from
  [Creative Commons' official legal code](https://creativecommons.org/licenses/by/3.0/legalcode.txt).

The CC BY license applies to these audio recordings independently of this
application's source-code license. Retain this attribution and license when
redistributing the samples. Neither the author nor the distributors endorse this
application.

## Included subset and changes

This application includes 90 original MP3 files from the above distribution:
velocity layers **3, 8, and 13**, each with 30 sampled pitches from **A0 (MIDI 21)
through C8 (MIDI 108)** in minor thirds. File names use `s` for sharp, for example
`Fs4v8.mp3`. Playback can shift the nearest sample by at most one semitone to
cover all 88 piano keys.

The files are copied byte-for-byte. This project has not normalized, trimmed,
re-encoded, or otherwise edited the audio. The changes relative to the complete
library are selection of three velocity layers and omission of separate pedal,
hammer-release, and sympathetic-resonance recordings. The existing upstream MP3
conversion is retained.

All 90 files are 44.1 kHz stereo MP3s, totaling **16,448,461 bytes (15.69 MiB)**.
They preserve natural decay tails of about 2.85–25.81 seconds. Decoding the entire
set at 44.1 kHz requires approximately 417 MiB of Float32 PCM memory, so the
player should load only the samples needed for the current piece.

`manifest.mjs` exports pitch/layer mappings. `checksums.json` records each file's
size, SHA-256, verified upstream Git blob SHA-1, channel count, sample rate, and
duration. All files were checked against the upstream blob hashes and fully
decoded with FFmpeg without errors on 2026-10-22.
