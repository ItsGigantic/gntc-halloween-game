#!/usr/bin/env bash
# Turn a screen recording into LinkedIn-ready assets.
#   tools/make-social.sh input.mov [name] [start_seconds] [duration_seconds]
# Produces social/<name>.mp4 (H.264, silent, 1080px, loop-friendly) and social/<name>.gif (600px, 20fps, <8MB target).
# LinkedIn feed posts don't animate uploaded GIFs: post the MP4, keep the GIF for Giphy/other channels.
set -euo pipefail
IN="${1:?usage: make-social.sh input.mov [name] [start] [duration]}"
NAME="${2:-clip}"
START="${3:-0}"
DUR="${4:-12}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/social"
mkdir -p "$OUT_DIR"

# Square-ish crop is decided at capture time (use ?aspect=1:1 or 4:5). Here we only scale.
ffmpeg -y -ss "$START" -t "$DUR" -i "$IN" \
  -vf "scale='min(1080,iw)':-2:flags=lanczos,fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart -an \
  "$OUT_DIR/$NAME.mp4"

ffmpeg -y -ss "$START" -t "$DUR" -i "$IN" \
  -vf "fps=20,scale=600:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 "$OUT_DIR/$NAME.gif"

ls -la "$OUT_DIR/$NAME.mp4" "$OUT_DIR/$NAME.gif"
echo "If the GIF is over 8 MB, shorten the duration or drop scale to 480."
