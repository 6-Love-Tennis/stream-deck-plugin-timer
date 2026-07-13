import { execFile } from "node:child_process";

import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { listCalendars, type Meetings, type NextEvent, readUpcomingEvents } from "../calendar/read-events";
import { renderKey, type RenderState } from "../render/countdown-svg";

/** Per-action settings, editable from the Property Inspector. Shared by both actions. */
type CountdownSettings = {
	/** Turn the ring/text amber at this many minutes remaining. */
	amberMinutes?: number;
	/** Turn the ring/text red at this many minutes remaining. */
	redMinutes?: number;
	/** How far ahead to look for the next meeting. */
	windowHours?: number;
	/** Ignore all-day events. */
	ignoreAllDay?: boolean;
	/** Ignore events the user has declined. */
	skipDeclined?: boolean;
	/** Open the meeting's video link when the key is pressed. */
	openLinkOnPress?: boolean;
	/** Calendar identifiers to observe. Empty/undefined means all calendars. */
	calendars?: string[];
	/** Play a macOS system sound when the countdown hits zero. */
	soundOnZero?: boolean;
	/** Which macOS system sound to play (see {@link SYSTEM_SOUNDS}). */
	soundName?: string;
	/** Playback gain passed to `afplay -v` (1 = normal, higher = louder). */
	soundVolume?: number;
};

/** Property Inspector message names (payload.event on sendToPlugin). */
const GET_CALENDARS = "getCalendars";
const TEST_SOUND = "testSound";

/** macOS system sounds in /System/Library/Sounds. */
const SYSTEM_SOUNDS = ["Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"];

const DEFAULTS = {
	amberMinutes: 15,
	redMinutes: 5,
	windowHours: 24,
	ignoreAllDay: true,
	skipDeclined: true,
	openLinkOnPress: true,
	soundOnZero: true,
	soundName: "Submarine",
	soundVolume: 50, // 0–100 scale (see SOUND_MAX_GAIN)
} satisfies Required<Omit<CountdownSettings, "calendars">>;

/** A volume of 100 maps to this afplay gain; the gentle system sounds need >1x to be heard. */
const SOUND_MAX_GAIN = 8;

/** Re-query the calendar this often; cheaper than reading on every render tick. */
const POLL_MS = 30_000;
/** Repaint cadence. Fast enough to animate the scrolling meeting name; redundant repaints
 * are cheap and de-duplicated in {@link MeetingAction.paint}. */
const RENDER_MS = 120;
/** How long the "tap again to join" confirmation stays armed before reverting. */
const CONFIRM_MS = 5_000;
/** How long a transient press message (e.g. "No link") stays on the key. */
const TOAST_MS = 1_500;
/** "Next meeting" ring drains over the final hour before the meeting starts. */
const RING_WINDOW_MS = 60 * 60 * 1000;
/** Alarm: repaint (shake) cadence, sound-repeat cadence, and hard cutoff. */
const ALARM_ANIM_MS = 100;
const ALARM_SOUND_MS = 2_000;
const ALARM_MAX_MS = 60_000;

type Status = "loading" | "ok" | "no-access" | "error";

/**
 * Shared behavior for the calendar-driven meeting keys. `SingletonAction` is a single object
 * that serves *every* button using the action, so all per-button state is keyed by `action.id`.
 * The visible countdown is derived from an absolute target time (`target - Date.now()`) rather
 * than by counting ticks, so it self-corrects after any skipped/throttled intervals.
 *
 * Subclasses choose which meeting to track and how the countdown/ring behave.
 */
abstract class MeetingAction extends SingletonAction<CountdownSettings> {
	private readonly keyAction = new Map<string, KeyAction<CountdownSettings>>();
	private readonly settings = new Map<string, CountdownSettings>();
	private readonly status = new Map<string, Status>();
	private readonly event = new Map<string, NextEvent | null>();
	private readonly pollTimers = new Map<string, NodeJS.Timeout>();
	private readonly renderTimers = new Map<string, NodeJS.Timeout>();
	/** Start time of the event we've already fired the "zero" alert for. */
	private readonly alertedFor = new Map<string, number>();
	/** Actions currently showing the "tap again to join" prompt, with the armed link. */
	private readonly confirm = new Map<string, { timer: NodeJS.Timeout; url: string }>();
	/** Actions currently "going off": a shaking bell + repeating sound until dismissed/timeout. */
	private readonly alarms = new Map<string, { title: string; frame: number; anim: NodeJS.Timeout; sound?: NodeJS.Timeout; stop: NodeJS.Timeout }>();
	/** Transient press feedback (e.g. "No link"), auto-clearing after {@link TOAST_MS}. */
	private readonly toasts = new Map<string, { text: string; timer: NodeJS.Timeout }>();
	/** Last image sent per action, so the fast render loop skips redundant setImage calls. */
	private readonly lastImage = new Map<string, string>();

	/** Which meeting this action tracks. */
	protected abstract pick(meetings: Meetings): NextEvent | null;
	/** The absolute time (epoch ms) the countdown targets — meeting start or end. */
	protected abstract targetTime(evt: NextEvent): number;
	/** Fraction (0–1) the progress ring should be filled for the given remaining time. */
	protected abstract ringFraction(evt: NextEvent, remainingMs: number): number;
	/** Short label shown on every state so the two actions are visually distinct. */
	protected abstract readonly modeLabel: string;
	/** Big text shown when there is no relevant meeting. */
	protected abstract readonly idleText: string;
	/** Whether the progress border drains the opposite direction. */
	protected abstract readonly reverseRing: boolean;
	/** Whether to slowly pulse the background while a countdown is showing. */
	protected abstract readonly pulseBackground: boolean;

	override onWillAppear(ev: WillAppearEvent<CountdownSettings>): void {
		if (!ev.action.isKey()) {
			return; // this action is Keypad-only
		}
		const id = ev.action.id;
		this.keyAction.set(id, ev.action);
		this.settings.set(id, ev.payload.settings ?? {});
		this.status.set(id, "loading");

		// Clear any manually-set title so it doesn't overlay our rendered image.
		void ev.action.setTitle("");
		this.paint(id);
		this.startTimers(id);
		void this.pollNow(id);
	}

	override onWillDisappear(ev: WillDisappearEvent<CountdownSettings>): void {
		const id = ev.action.id;
		this.stopTimers(id);
		this.clearAlarmTimers(id);
		const pending = this.confirm.get(id);
		if (pending) {
			clearTimeout(pending.timer);
		}
		this.confirm.delete(id);
		const toast = this.toasts.get(id);
		if (toast) {
			clearTimeout(toast.timer);
		}
		this.toasts.delete(id);
		this.lastImage.delete(id);
		this.keyAction.delete(id);
		this.settings.delete(id);
		this.status.delete(id);
		this.event.delete(id);
		this.alertedFor.delete(id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CountdownSettings>): void {
		const id = ev.action.id;
		if (!this.keyAction.has(id)) {
			return;
		}
		this.settings.set(id, ev.payload.settings ?? {});
		void this.pollNow(id); // reflect new thresholds/filters immediately
	}

	override async onKeyDown(ev: KeyDownEvent<CountdownSettings>): Promise<void> {
		const id = ev.action.id;

		// A press while the alarm is going off just dismisses it.
		if (this.alarms.has(id)) {
			this.stopAlarm(id);
			return;
		}

		// Second press while armed → open the link that was showing when we armed.
		const pending = this.confirm.get(id);
		if (pending) {
			clearTimeout(pending.timer);
			this.confirm.delete(id);
			execFile("/usr/bin/open", [pending.url], (err) => {
				if (err) {
					streamDeck.logger.error(`open failed (${pending.url}): ${err.message}`);
				}
			});
			void ev.action.showOk().catch(() => {
				/* ignore */
			});
			this.paint(id);
			return;
		}

		const settings = this.settings.get(id) ?? {};
		if (!(settings.openLinkOnPress ?? DEFAULTS.openLinkOnPress)) {
			return; // opting out of press-to-open → a press is a no-op, not an error
		}
		const evt = this.event.get(id);
		if (!evt) {
			return; // nothing to join (idle) → no-op
		}
		if (!evt.url) {
			this.showToast(id, "No link"); // a meeting without a detectable video link
			return;
		}

		// First press → arm the "tap again to join" confirmation; auto-revert after CONFIRM_MS.
		const timer = setTimeout(() => {
			this.confirm.delete(id);
			this.paint(id);
		}, CONFIRM_MS);
		this.confirm.set(id, { timer, url: evt.url });
		this.paint(id);
	}

	/** Flashes a brief neutral message on the key in response to a press. */
	private showToast(id: string, text: string): void {
		const existing = this.toasts.get(id);
		if (existing) {
			clearTimeout(existing.timer);
		}
		const timer = setTimeout(() => {
			this.toasts.delete(id);
			this.paint(id);
		}, TOAST_MS);
		this.toasts.set(id, { text, timer });
		this.paint(id);
	}

	/**
	 * Answers the Property Inspector's `getCalendars` datasource request, and the `testSound`
	 * button, both sent from the shared property inspector.
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, CountdownSettings>): Promise<void> {
		switch (ev.payload?.event) {
			case GET_CALENDARS: {
				const items = await this.buildCalendarItems();
				await streamDeck.ui.sendToPropertyInspector({ event: GET_CALENDARS, items });
				return;
			}
			case TEST_SOUND: {
				const settings = this.settings.get(ev.action.id) ?? {};
				const sound = settings.soundName ?? DEFAULTS.soundName;
				const volume = settings.soundVolume ?? DEFAULTS.soundVolume;
				streamDeck.logger.info(`Test sound requested: ${sound} @ volume ${volume}`);
				playSound(sound, volume);
				return;
			}
		}
	}

	private async buildCalendarItems(): Promise<Array<{ label: string; value: string; disabled?: boolean }>> {
		const result = await listCalendars();
		if (result.kind === "no-access") {
			return [{ label: "⚠ Grant Calendar access first", value: "__no_access__", disabled: true }];
		}
		if (result.kind === "error") {
			streamDeck.logger.warn(`Calendar list failed: ${result.message}`);
			return [{ label: "Couldn't read calendars", value: "__error__", disabled: true }];
		}

		streamDeck.logger.info(`Calendar picker: found ${result.calendars.length} calendar(s)`);
		// Flat items only — sdpi-checkbox-list doesn't render grouped (ItemGroup) datasources,
		// so fold the account into the label to disambiguate same-named calendars.
		return result.calendars.map((cal) => ({
			label: cal.account ? `${cal.title} · ${cal.account}` : cal.title,
			value: cal.id,
		}));
	}

	// ---- internals ---------------------------------------------------------

	private startTimers(id: string): void {
		this.stopTimers(id);
		this.pollTimers.set(
			id,
			setInterval(() => void this.pollNow(id), POLL_MS),
		);
		this.renderTimers.set(
			id,
			setInterval(() => this.paint(id), RENDER_MS),
		);
	}

	private stopTimers(id: string): void {
		const poll = this.pollTimers.get(id);
		if (poll) {
			clearInterval(poll);
		}
		this.pollTimers.delete(id);

		const render = this.renderTimers.get(id);
		if (render) {
			clearInterval(render);
		}
		this.renderTimers.delete(id);
	}

	/** Begins the "going off" alarm: shakes the bell, repeats the sound, and self-stops after 60s. */
	private startAlarm(id: string, title: string, playAudio: boolean, soundName: string, soundVolume: number): void {
		this.clearAlarmTimers(id);
		const anim = setInterval(() => {
			const a = this.alarms.get(id);
			if (a) {
				a.frame++;
				this.paint(id);
			}
		}, ALARM_ANIM_MS);
		let sound: NodeJS.Timeout | undefined;
		if (playAudio) {
			playSound(soundName, soundVolume);
			sound = setInterval(() => playSound(soundName, soundVolume), ALARM_SOUND_MS);
		}
		const stop = setTimeout(() => this.stopAlarm(id), ALARM_MAX_MS);
		this.alarms.set(id, { title, frame: 0, anim, sound, stop });
	}

	private clearAlarmTimers(id: string): void {
		const a = this.alarms.get(id);
		if (!a) {
			return;
		}
		clearInterval(a.anim);
		if (a.sound) {
			clearInterval(a.sound);
		}
		clearTimeout(a.stop);
		this.alarms.delete(id);
	}

	private stopAlarm(id: string): void {
		if (!this.alarms.has(id)) {
			return;
		}
		this.clearAlarmTimers(id);
		this.paint(id);
	}

	private async pollNow(id: string): Promise<void> {
		if (!this.keyAction.has(id)) {
			return; // action disappeared before this poll started
		}
		const s = this.settings.get(id) ?? {};
		const result = await readUpcomingEvents({
			windowHours: num(s.windowHours, DEFAULTS.windowHours),
			ignoreAllDay: s.ignoreAllDay ?? DEFAULTS.ignoreAllDay,
			skipDeclined: s.skipDeclined ?? DEFAULTS.skipDeclined,
			calendarIds: Array.isArray(s.calendars) ? s.calendars : undefined,
		});

		if (!this.keyAction.has(id)) {
			return; // action disappeared while we were reading
		}

		switch (result.kind) {
			case "ok":
				this.status.set(id, "ok");
				this.event.set(id, this.pick(result.meetings));
				break;
			case "no-access":
				this.status.set(id, "no-access");
				this.event.set(id, null);
				break;
			case "error":
				// Keep the last-known event so the countdown keeps running; just note it.
				this.status.set(id, "error");
				streamDeck.logger.warn(`Calendar read failed: ${result.message}`);
				break;
		}
		this.paint(id);
	}

	private paint(id: string): void {
		const act = this.keyAction.get(id);
		if (!act) {
			return;
		}
		const s = this.settings.get(id) ?? {};
		const status = this.status.get(id) ?? "loading";
		const image = renderKey(this.renderState(id, status, s));
		if (this.lastImage.get(id) === image) {
			return; // nothing changed since last paint — skip the redundant setImage
		}
		this.lastImage.set(id, image);
		void act.setImage(image).catch(() => {
			/* transient; next tick repaints */
		});
	}

	private renderState(id: string, status: Status, s: CountdownSettings): RenderState {
		// The going-off alarm overrides everything until dismissed or it times out.
		const alarm = this.alarms.get(id);
		if (alarm) {
			return { kind: "alarm", title: alarm.title, frame: alarm.frame };
		}
		// While armed, keep showing the "tap again to join" prompt through the render loop.
		if (this.confirm.has(id)) {
			return { kind: "confirm", title: this.event.get(id)?.title ?? "" };
		}
		const toast = this.toasts.get(id);
		if (toast) {
			return { kind: "toast", text: toast.text };
		}
		if (status === "loading") {
			return { kind: "loading" };
		}
		if (status === "no-access") {
			return { kind: "no-access" };
		}

		const evt = this.event.get(id) ?? null;
		if (!evt) {
			return status === "error" ? { kind: "error" } : { kind: "idle", label: this.modeLabel, text: this.idleText };
		}

		const amberMs = num(s.amberMinutes, DEFAULTS.amberMinutes) * 60_000;
		const redMs = num(s.redMinutes, DEFAULTS.redMinutes) * 60_000;
		const remainingMs = this.targetTime(evt) - Date.now();

		// When the countdown first reaches zero, kick off the alarm (once per event).
		if (remainingMs <= 0 && this.alertedFor.get(id) !== evt.start) {
			this.alertedFor.set(id, evt.start);
			this.startAlarm(id, evt.title, s.soundOnZero ?? DEFAULTS.soundOnZero, s.soundName ?? DEFAULTS.soundName, s.soundVolume ?? DEFAULTS.soundVolume);
			return { kind: "alarm", title: evt.title, frame: 0 };
		}

		return {
			kind: "countdown",
			remainingMs,
			title: evt.title,
			amberMs,
			redMs,
			ringFrac: this.ringFraction(evt, remainingMs),
			label: this.modeLabel,
			reverseRing: this.reverseRing,
			pulse: this.pulseBackground,
		};
	}
}

/** Counts down to the start of the next upcoming meeting. */
@action({ UUID: "org.henkhaus.next-meeting.countdown" })
export class NextMeeting extends MeetingAction {
	protected override readonly modeLabel = "NEXT";
	protected override readonly idleText = "No more meetings";
	protected override readonly reverseRing = false; // drains from the top-left
	protected override readonly pulseBackground = false;

	protected override pick(meetings: Meetings): NextEvent | null {
		return meetings.next;
	}

	protected override targetTime(evt: NextEvent): number {
		return evt.start;
	}

	protected override ringFraction(_evt: NextEvent, remainingMs: number): number {
		return remainingMs / RING_WINDOW_MS; // full at >= 60 min out, empty at zero
	}
}

/** Counts down the time left in the meeting currently in progress. */
@action({ UUID: "org.henkhaus.next-meeting.current" })
export class CurrentMeeting extends MeetingAction {
	protected override readonly modeLabel = "NOW";
	protected override readonly idleText = "Free";
	protected override readonly reverseRing = true; // opposite direction, to distinguish from Next
	protected override readonly pulseBackground = true; // gently pulse while in a meeting

	protected override pick(meetings: Meetings): NextEvent | null {
		return meetings.current;
	}

	protected override targetTime(evt: NextEvent): number {
		return evt.end;
	}

	protected override ringFraction(evt: NextEvent, remainingMs: number): number {
		const total = evt.end - evt.start; // ring drains across the meeting's duration
		return total > 0 ? remainingMs / total : 0;
	}
}

/** Coerce a possibly-string/undefined setting to a finite positive number, else fall back. */
function num(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Plays a macOS system sound via `afplay`. Validated against the known list to avoid path injection. */
function playSound(name: string, volume: unknown = DEFAULTS.soundVolume): void {
	const safe = SYSTEM_SOUNDS.includes(name) ? name : DEFAULTS.soundName;
	const file = `/System/Library/Sounds/${safe}.aiff`;
	// Volume is a 0–100 scale; map it to an afplay gain (0 = silent, 100 = SOUND_MAX_GAIN).
	const n = Number(volume);
	const percent = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : DEFAULTS.soundVolume;
	if (percent <= 0) {
		return; // 0 = muted
	}
	const gain = (percent / 100) * SOUND_MAX_GAIN;
	// Absolute path — Stream Deck launches the plugin with a minimal PATH that may not include afplay.
	execFile("/usr/bin/afplay", ["-v", gain.toFixed(2), file], (err) => {
		if (err) {
			streamDeck.logger.error(`afplay failed (${file}): ${err.message}`);
		}
	});
}
