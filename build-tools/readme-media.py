"""Build the README showcase from tests/e2e/readme-showcase.spec.ts output (needs Pillow; ffmpeg for the video).

Usage: python3 build-tools/readme-media.py <PROMO_OUT> <destination>
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

source, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
for name in ("conversation-after", "conversation-dark", "work-detail", "works"):
    image = Image.open(source / f"{name}.png").convert("RGB").resize((1600, 1000), Image.LANCZOS)
    image.save(destination / f"{name}.webp", "WEBP", quality=88, method=6)

# The send-and-reply GIF: the conversation column, at the frames' real timing.
meta = json.loads((source / "frames.json").read_text())
start, end, times = meta["marks"]["sendStart"], meta["marks"]["sendEnd"], meta["times"]
frames, durations = [], []
for index in range(start, end):
    frame = Image.open(source / "frames" / f"{index:04d}.png").convert("RGB")
    frame = frame.crop((300, 230, 1280, 800))
    frames.append(frame.resize((frame.width * 3 // 4, frame.height * 3 // 4), Image.LANCZOS))
    durations.append(max(20, times[index + 1] - times[index]))
durations[-1] = 2600
palette = frames[-1].quantize(colors=160, method=Image.MEDIANCUT)
gif = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
gif[0].save(
    destination / "send.gif",
    save_all=True,
    append_images=gif[1:],
    duration=durations,
    loop=0,
    optimize=True,
)

# The whole tour as H.264, each frame shown for as long as it was on screen.
listing = []
for index, moment in enumerate(times):
    listing.append(f"file '{source / 'frames' / f'{index:04d}.png'}'")
    next_moment = times[index + 1] if index + 1 < len(times) else moment + 1500
    listing.append(f"duration {(next_moment - moment) / 1000:.3f}")
listing.append(listing[-2])
(source / "frames.txt").write_text("\n".join(listing) + "\n")
if shutil.which("ffmpeg"):
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", str(source / "frames.txt"), "-vf", "fps=30,format=yuv420p",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart",
         str(destination / "yuki-desktop-tour.mp4")],
        check=True,
    )
else:
    print("ffmpeg not found: the video was not rebuilt", file=sys.stderr)
