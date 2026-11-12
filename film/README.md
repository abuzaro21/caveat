# The CAVEAT film

An 87-second film of the running build: 1920×1080, 30 fps, H.264 and AAC, with narration, burned-in captions, a soft caption track, and a logo reveal at the end.

Every frame of the product is a real capture. `capture.mjs` starts a local server with an in-memory SQLite store and drives one continuous browser session with clicks only. Nothing is mocked or edited into the picture apart from crops and the end card.

## Pipeline

```bash
npm run build                       # the UI the capture records
python film/tts.py                  # narration.json -> film/out/audio/ (Kokoro-82M, voice am_michael, run locally)
node film/capture.mjs               # film/out/raw/session.webm, paced to the narration
node film/build.mjs                 # film/out/caveat-film.mp4 and film/caveat-film.srt
node film/check.mjs                 # automated checks -> film/out/check/report.json and film/contact-sheet.png
```

`film/out/` is not committed. The rendered film is published as a release asset. The committed files are the scripts, the narration text, the captions (`caveat-film.srt`), the contact sheet, and the check report in [`docs/evidence/film-check.json`](../docs/evidence/film-check.json).

## Automated checks

`check.mjs` measures:

- duration (85–95 s), resolution, frame rate, frame count and codecs;
- black frames, audio clipping (sample and true peak), and integrated loudness (−18 to −14 LUFS);
- caption timing: cues are in order, inside the film, and none sits in a silence;
- burned-in captions: at sampled cues, the caption area must differ from the same frame rendered without captions;
- the ending: the last frame matches the logo master, and the last 2 s are still.

These are machine measurements only. **No human has watched or listened to the film as part of this build.** The owner should do that once before submitting.

## Audio

The narration is synthetic: Kokoro-82M, an open-weights TTS model run locally on the CPU. The music bed is a synthesized drone made with ffmpeg. The mix goes through ffmpeg's `loudnorm` with a −16 LUFS target. The check measured −17.2 LUFS integrated, with a true peak of −4.3 dBTP.
