#!/usr/bin/env bash
# Finishing pass for the Lyria mood bank. Lyria clips are NOT loop-ready (they
# fade out and don't level-match), so for every clip we:
#   1) author a seamless loop  — crossfade the tail back over the head
#   2) de-clip + normalize      — mood-relative loudness target + -1.5 dBTP ceiling
# The RAW Lyria output is preserved under <genre>/_raw/ so this is idempotent:
# it always reprocesses from the raw source, never double-processes.
#
# Run AFTER scripts/gen-music.ts.  Usage: bash scripts/postprocess-music.sh
set -euo pipefail

cd "$(dirname "$0")/.."
MUSIC=public/music
# genres can be passed as args: `bash scripts/postprocess-music.sh noir fantasy`
if [ "$#" -gt 0 ]; then GENRES=("$@"); else GENRES=(noir fantasy starship); fi
CF=4          # crossfade seconds for the seamless loop
TP=-1.5       # true-peak ceiling (dBTP)

# Mood-relative integrated-loudness targets (LUFS). Encoding arousal into level:
# combat loudest, decision/calm quietest. This is deliberate — the mixer
# crossfades on mood change, so a controlled loudness step per mood is wanted.
mood_target() {
  # targets mirror scripts/audio-contract.ts (energyRank-ordered)
  case "$1" in
    combat)       echo -9  ;;
    tense)        echo -11 ;;
    intro)        echo -13 ;;
    triumphant)   echo -13 ;;
    explore)      echo -15 ;;
    decision)     echo -16 ;;
    item_closeup) echo -17 ;;
    calm)         echo -18 ;;
    tragic)       echo -18 ;;
    *)            echo -14 ;;
  esac
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

total=0; done=0
for g in "${GENRES[@]}"; do
  for f in "$MUSIC/$g"/*.mp3; do [ -e "$f" ] && total=$((total+1)); done
done
echo "$total clips to finish"

for g in "${GENRES[@]}"; do
  mkdir -p "$MUSIC/$g/_raw"
  for f in "$MUSIC/$g"/*.mp3; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .mp3)"
    mood="${base%-2}"                         # strip -2 variant suffix
    raw="$MUSIC/$g/_raw/$base.mp3"
    # first run: stash the raw Lyria output; later runs: reprocess from it
    [ -f "$raw" ] || cp "$f" "$raw"
    target="$(mood_target "$mood")"

    # 1) seamless loop: [raw@CF..end] crossfaded with [raw@0..CF]
    ffmpeg -y -hide_banner -loglevel error -i "$raw" -i "$raw" -filter_complex \
      "[0:a]atrim=${CF},asetpts=PTS-STARTPTS[rest];[1:a]atrim=0:${CF},asetpts=PTS-STARTPTS[head];[rest][head]acrossfade=d=${CF}:c1=tri:c2=tri[o]" \
      -map "[o]" -c:a pcm_s16le "$TMP/loop.wav"

    # 2) de-clip + normalize to the mood's loudness target
    ffmpeg -y -hide_banner -loglevel error -i "$TMP/loop.wav" \
      -af "loudnorm=I=${target}:TP=${TP}:LRA=11" -ar 44100 -c:a libmp3lame -b:a 192k "$f"

    done=$((done+1))
    printf "  ✓ %-10s %-16s -> %sdB LUFS  (%d/%d)\n" "$g" "$base" "$target" "$done" "$total"
  done
done
echo "done. raw originals preserved under <genre>/_raw/"
