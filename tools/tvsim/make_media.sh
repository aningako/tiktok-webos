#!/bin/sh
# Test clips for the TV-mode harness: 10 numbered 8 s H.264 clips (needs ffmpeg).
cd "$(dirname "$0")" && mkdir -p media && cd media
for i in 0 1 2 3 4 5 6 7 8 9; do
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x$(printf '%02x' $((i*25)))3060:s=360x640:d=8:r=24" -f lavfi -i "sine=f=$((300+i*40)):d=8" \
    -vf "drawtext=text='clip $i  %{pts\:hms}':fontsize=36:fontcolor=white:x=20:y=300" \
    -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -b:a 64k -shortest -movflags +faststart clip$i.mp4
done
