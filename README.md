# Next Meeting Countdown — Stream Deck plugin

Stream Deck keys that show a live countdown for your meetings, read straight from
**macOS Calendar.app**. Because macOS Calendar mirrors your Google Calendar via native
account sync, there is **no Google API, OAuth, or Apple Shortcut** involved — the plugin
reads events directly through EventKit.

Two actions (both share the same settings, icon, and behavior — they differ only in which
meeting they track):

- **Next Meeting** — labelled **NEXT**; counts down to the *start* of your next upcoming
  meeting. A bottom progress bar drains over the final hour (full at 60+ min out). Shows
  **No more meetings** when nothing is upcoming.
- **Current Meeting** — labelled **NOW**; counts down the time *left* in the meeting you're
  in right now. The bar drains across the meeting's duration. Shows **Free** when you're not
  in a meeting.

The two are distinguished by the **NEXT / NOW** label, the opposite bar drain direction, and
their idle text. Long meeting names scroll like a ticker.

Both shade **green → amber → red** as the countdown runs down, flash an alert (and optional
sound) when it hits zero, and offer a two-tap "Join?" confirmation to open the meeting's
video link when pressed.

## How it works

- **Reading events:** an inline AppleScriptObjC script drives EventKit (`EKEventStore`)
  via `osascript`, returning the upcoming events in a look-ahead window as JSON. See
  [`src/calendar/eventkit-script.ts`](src/calendar/eventkit-script.ts) and
  [`src/calendar/read-events.ts`](src/calendar/read-events.ts). Node filters out all-day,
  declined, canceled, and already-started events and picks the earliest remaining one.
- **Counting down:** the action polls the calendar every 30s and repaints every 1s. The
  displayed time is computed from the event's absolute start (`start - Date.now()`), so it
  self-corrects after any throttled ticks (e.g. while the app is backgrounded). See
  [`src/actions/countdown.ts`](src/actions/countdown.ts).
- **Rendering:** the key is drawn as an SVG data URI (no native canvas dependency),
  crisp at both 72px and 144px. See [`src/render/countdown-svg.ts`](src/render/countdown-svg.ts).

## Requirements

- macOS (with your Google/other account added under Calendar ▸ Settings ▸ Accounts).
- Stream Deck app 7.1+ (developed against 7.5). Uses the Node 24 runtime the app ships.

## Install (developer / local)

```bash
npm install
npm run build
npx streamdeck link org.henkhaus.next-meeting.sdPlugin   # symlink into Stream Deck
npx streamdeck restart org.henkhaus.next-meeting          # (or restart the Stream Deck app)
```

Then in the Stream Deck app, find **Next Meeting Countdown ▸ Next Meeting** in the actions
list and drag it onto a key.

### First run: grant Calendar access

The first time the key appears it will show a red **"Calendar access → Settings"** state,
because macOS hasn't yet let Stream Deck read your calendars. Grant it once:

1. Open **System Settings ▸ Privacy & Security ▸ Calendars** (the Property Inspector has a
   "Grant Calendar access…" button that opens this pane).
2. Enable **Elgato Stream Deck**, and make sure it's set to **Full Access** (not "Add Only" —
   reading events requires full access).
3. Within ~30s the key switches to a live countdown (or **Free** if nothing is upcoming).

## Settings (Property Inspector)

| Setting | Default | Notes |
| --- | --- | --- |
| Amber at (min) | 15 | Turn amber at this many minutes remaining. |
| Red at (min) | 5 | Turn red at this many minutes remaining. |
| Look ahead (hrs) | 24 | How far ahead to search for the next event. |
| Ignore all-day events | on | All-day events aren't treated as meetings. |
| Skip declined events | on | Events you've declined are ignored. |
| Calendars | all | Checkbox list (grouped by account) of your macOS calendars. Leave **all unchecked to observe every calendar**; check some to restrict to just those. |
| Open meeting video link | on | Pressing the key opens the Meet/Zoom/Teams link. |
| Play a sound at zero | on | Plays a macOS system sound (via `afplay`) once, when the countdown reaches the meeting start. |
| Sound | Submarine | Which macOS system sound to play. A **Test sound** button previews the current choice. |

The calendar list is loaded live from macOS Calendar.app via the Property Inspector's
datasource. Until Calendar access is granted it shows "Grant Calendar access first".

## Development

```bash
npm run watch   # rebuild on save + hot-restart the plugin in Stream Deck
```

Logs are written to `org.henkhaus.next-meeting.sdPlugin/logs/`. Bump the level in
[`src/plugin.ts`](src/plugin.ts) (`setLevel("trace")`) while debugging.

## Known limitations & future work

- **Calendar permission** relies on macOS attributing the EventKit request to the Stream
  Deck app. For a distributable build, replace the `osascript` call with a bundled, signed
  Swift EventKit helper that carries its own `NSCalendarsFullAccessUsageDescription` — this
  gives clean, correctly-attributed permission prompts. The current approach is ideal for
  personal/local use.
- Meetings already in progress are skipped in favor of the next not-yet-started event.
- "Declined" detection uses the current user's attendee participant status.
