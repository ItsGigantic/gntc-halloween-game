#!/bin/sh
# Encode a social post GIF: 100 rendered frames (5 s at 20 fps) + a transparent copy layer.
# - Grain (refreshed once a second) goes on the scene at final size, under the copy, so type stays clean.
# - The logo is kept as sharp as a 256-colour GIF allows:
#   * the copy layer's logo tile gets a light unsharp mask after downscaling,
#   * the palette is weighted toward the logo (a stretched copy of the tile, plus a blurred copy for
#     its blue-to-cyan edge blends, is fed to palettegen), so those colours get their own slots,
#   * the logo area is mapped without dither, so its flat colours stay solid.
# Tuned to keep the posts under LinkedIn's 5 MB GIF limit: harvest at 256 colours, holiday (busier, with
# the snow) at 160.
# Usage: tools/post-gif.sh 'frames/f%04d.png' copy-layer-full-res.png out.gif [colours]   (800 px wide)
set -e
FRAMES="$1"; COPY="$2"; OUT="$3"; COLOURS="${4:-256}"
TMP=$(mktemp -d)
ffmpeg -loglevel error -y -i "$COPY" -filter_complex "[0]scale=800:-1:flags=lanczos,format=rgba,split[a][b];[b]crop=110:110:45:45,unsharp=3:3:0.45:3:3:0.0[l];[a][l]overlay=45:45" "$TMP/copy.png"
ffmpeg -loglevel error -y -framerate 20 -i "$FRAMES" -i "$TMP/copy.png" \
  -f lavfi -i "color=c=0x808080:s=800x1000:r=1:d=5,noise=alls=14:allf=t+u,fps=20" \
  -filter_complex "[0]scale=800:-1:flags=lanczos[s0];[s0][2]blend=all_mode=grainmerge:all_opacity=0.5[s];[s][1]overlay,split=3[f][u][n];[f]split=3[p1][p2][p3];[p2]crop=100:100:50:50,scale=800:300:flags=neighbor[logo];[p3]crop=100:100:50:50,boxblur=3:1,scale=800:200:flags=neighbor[blend];[p1][logo][blend]vstack=inputs=3[pin];[pin]palettegen=max_colors=${COLOURS}:stats_mode=full,split=3[pa][pb][pc];[u][pa]paletteuse=dither=bayer:bayer_scale=3[d];[n][pb]paletteuse=dither=none,crop=104:104:48:48[nl];[d][nl]overlay=48:48[m];[m][pc]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$OUT"
rm -rf "$TMP"
