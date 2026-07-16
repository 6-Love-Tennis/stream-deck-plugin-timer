# Marketplace media — gallery + demo video

Notes for (re)submitting **Next Meeting Countdown** to the Elgato Maker Console after the
first review asked for better product-page media and a functionality demo video.

## Gallery images ✅ ready

Six 1920×960 PNG panels (2:1, per Elgato spec) in [`imgs/gallery/`](../imgs/gallery),
each showcasing one feature with the plugin's real key/dial visuals:

| File | Story |
| --- | --- |
| `01-hero.png` | Product intro — "Your next meeting, always in view." |
| `02-urgency.png` | Green → amber → red color states |
| `03-modes.png` | NEXT (time until) vs NOW (time left) |
| `04-join.png` | Press → "Join?" → opens the video link |
| `05-dials.png` | Stream Deck + dial touchscreen support |
| `06-states.png` | Idle states — No more meetings / Free / long session |
| `07-multi.png` | Multiple overlapping meetings — dial N/M counter + turn to cycle |

Upload at least 3 (all 7 recommended). Regenerate any time with
`node imgs/gallery/gen-gallery.mjs <outdir>` then render each HTML at 1920×960.

## Demo video — to record (MP4, 1920×1080, < 250 MB), email to maker@elgato.com

Elgato wants to *verify functionality*, so record the **real plugin running** in the
Stream Deck app (a screen recording, not an animation). Keep it ~40–60s.

**Before recording — make the countdown do interesting things fast:**
- Create a test calendar event **2–3 minutes** out so the countdown is short.
- In the action's settings, set **Amber at = 3 min**, **Red at = 2 min** so you can film
  the green → amber → red transitions in under a minute.
- Have a real Meet/Zoom/Teams link on the test event so the "Join" step actually opens.

**Record with:** QuickTime Player ▸ File ▸ New Screen Recording (or `Cmd+Shift+5`).
Record the full screen or the Stream Deck window at 1080p. If you have the physical
device, a second phone/camera shot of the keys is a nice B-roll addition.

**Shot list:**
1. **(0–6s)** The Stream Deck app with a key showing a live green countdown ticking down.
2. **(6–16s)** Open the Property Inspector: show the action's settings — pick a calendar,
   the amber/red thresholds, the sound option. (Proves it's configurable.)
3. **(16–26s)** Let the countdown cross the thresholds — key goes green → amber → red;
   show a long meeting name scrolling.
4. **(26–36s)** Press the key → **"Join?"** confirmation → press again → the meeting's
   video call opens in the browser. (This is the key functionality check.)
5. **(36–46s)** Show the **NOW** action counting down time left in a current meeting, and
   the idle states (**Free**, **No more meetings**).
6. **(46–56s, optional)** On a Stream Deck +, the dial touchscreen countdown — turn to
   switch meetings, push to join.
7. **(end)** Hold on the hero key for a beat.

**Export:** QuickTime exports `.mov`; if you need `.mp4`, run
`ffmpeg -i demo.mov -vcodec h264 -acodec aac demo.mp4` (well under 250 MB at 1080p/~1 min).

## Resubmit

Maker Console ▸ Products ▸ *Next Meeting Countdown* ▸ **Versions** tab ▸ open the rejected
version ▸ replace the gallery media (and upload the same `.streamDeckPlugin` unless the
code changed) ▸ submit. Reply to Elgato's email with the video attached. Allow another
4–10 business days.
