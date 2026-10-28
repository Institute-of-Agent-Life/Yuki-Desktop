# Local media fixtures

These small originals exercise Chromium's actual decoders. They are generated inputs, not copies of personal media. FFmpeg is not a runtime or CI dependency.

Generated with FFmpeg 9.0.2:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 4 -an -c:v libx264 -preset ultrafast -crf 32 -pix_fmt yuv420p -movflags +faststart clip.mp4
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 4 -an -c:v libvpx-vp9 -b:v 40k clip.webm
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 4 -c:a libopus -b:a 16k voice.webm
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 4 -c:a pcm_s16le voice.wav
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 4 -c:a libmp3lame -b:a 32k voice.mp3
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 4 -c:a libvorbis -q:a 2 voice.ogg
ffmpeg -f lavfi -i testsrc2=size=32x24:rate=2 -t 1 animated.gif
```

`manual.pdf` is a generated one-page PDF 1.4 with a Helvetica text stream. The stress input extends `clip.mp4` to 128 MiB with trailing padding in the isolated test directory; the committed fixture remains small.
