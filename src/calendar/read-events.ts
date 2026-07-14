import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { EVENTKIT_SCRIPT, LIST_CALENDARS_SCRIPT } from "./eventkit-script";

const execFileAsync = promisify(execFile);

/** A single upcoming meeting, normalized for the UI. */
export type NextEvent = {
	title: string;
	/** Event start, epoch milliseconds. */
	start: number;
	/** Event end, epoch milliseconds. */
	end: number;
	location: string;
	/** Best-guess video-call link (Meet/Zoom/Teams/Webex/…), or null. */
	url: string | null;
};

/**
 * The meetings in progress right now, and the imminent upcoming ones — each a list so the
 * Stream Deck + dial can turn between concurrent/overlapping events. Either list may be empty.
 */
export type Meetings = {
	/** Every event with start <= now < end (all overlap "now"), soonest-ending first. */
	current: NextEvent[];
	/** Every upcoming event (start > now) within the look-ahead window, soonest-starting first. */
	next: NextEvent[];
};

/** Result of a calendar poll. */
export type CalendarResult =
	| { kind: "ok"; meetings: Meetings }
	| { kind: "no-access" }
	| { kind: "error"; message: string };

export type ReadOptions = {
	/** How far ahead to look for the next event. */
	windowHours: number;
	/** Drop all-day events (they aren't "meetings"). */
	ignoreAllDay: boolean;
	/** Drop events the current user has declined. */
	skipDeclined: boolean;
	/** Drop events with no detectable video-call link (Meet/Zoom/Teams/…). */
	requireMeetingLink: boolean;
	/** Restrict to these calendar identifiers. Empty/undefined means all calendars. */
	calendarIds?: string[];
};

/** A calendar available in macOS Calendar.app. */
export type CalendarInfo = {
	id: string;
	title: string;
	/** Owning account/source, e.g. "Google" or "iCloud". */
	account: string;
};

export type CalendarListResult =
	| { kind: "ok"; calendars: CalendarInfo[] }
	| { kind: "no-access" }
	| { kind: "error"; message: string };

/** Raw event shape as produced by the EventKit AppleScript. */
export type RawEvent = {
	title: string;
	start: string;
	end: string;
	allday: boolean;
	status: number; // EKEventStatus: 3 = canceled
	declined: boolean;
	location: string;
	notes: string;
	url: string;
	calendarId: string;
};

type RawResult = { status: "ok"; events: RawEvent[] } | { status: "no-access" };

const OSASCRIPT_TIMEOUT_MS = 10_000;
const EK_EVENT_STATUS_CANCELED = 3;

/**
 * Reads upcoming events from macOS Calendar.app (via EventKit) and returns the next
 * meeting that hasn't started yet. Never throws — a failed read becomes an `error`
 * result so the caller can keep the last-known value and retry on the next poll.
 */
export async function readUpcomingEvents(opts: ReadOptions): Promise<CalendarResult> {
	const windowSeconds = Math.max(60, Math.round(opts.windowHours * 3600));

	let stdout: string;
	try {
		const res = await execFileAsync("osascript", ["-e", EVENTKIT_SCRIPT, String(windowSeconds)], {
			timeout: OSASCRIPT_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
		});
		stdout = res.stdout;
	} catch (err) {
		return { kind: "error", message: err instanceof Error ? err.message : String(err) };
	}

	let raw: RawResult;
	try {
		raw = JSON.parse(stdout.trim());
	} catch {
		return { kind: "error", message: `Unparseable calendar output: ${stdout.slice(0, 200)}` };
	}

	if (raw.status === "no-access") {
		return { kind: "no-access" };
	}

	return { kind: "ok", meetings: selectMeetings(raw.events, opts, Date.now()) };
}

/**
 * Pure selection of the current and upcoming meetings from a raw event list. Exposed for testing.
 * Current = every event in progress now, soonest-ending first. Next = every upcoming event,
 * soonest-starting first (the dial turns through them all; the key shows the first).
 */
export function selectMeetings(
	events: RawEvent[],
	opts: Pick<ReadOptions, "ignoreAllDay" | "skipDeclined" | "requireMeetingLink" | "calendarIds">,
	nowMs: number,
): Meetings {
	const calendarFilter = opts.calendarIds && opts.calendarIds.length > 0 ? new Set(opts.calendarIds) : null;
	const usable = events
		.map((e) => ({ raw: e, start: Date.parse(e.start), end: Date.parse(e.end) }))
		.filter(({ raw: e, start }) => {
			if (!Number.isFinite(start)) return false;
			if (e.status === EK_EVENT_STATUS_CANCELED) return false;
			if (opts.ignoreAllDay && e.allday) return false;
			if (opts.skipDeclined && e.declined) return false;
			if (opts.requireMeetingLink && extractMeetingLink(e) === null) return false;
			if (calendarFilter && !calendarFilter.has(e.calendarId)) return false;
			return true;
		});

	const current = usable
		.filter((c) => c.start <= nowMs && Number.isFinite(c.end) && c.end > nowMs)
		.sort((a, b) => a.end - b.end)
		.map(toEvent);

	// Everything still to come, soonest first. A dial turns through the whole list; the key (and a
	// dial's default selection) shows the first — the soonest upcoming meeting.
	const next = usable
		.filter((c) => c.start > nowMs)
		.sort((a, b) => a.start - b.start)
		.map(toEvent);

	return { current, next };
}

/** Builds a normalized {@link NextEvent} from a parsed raw event. */
function toEvent(c: { raw: RawEvent; start: number; end: number }): NextEvent {
	return {
		title: c.raw.title.trim(),
		start: c.start,
		end: c.end,
		location: c.raw.location,
		url: extractMeetingLink(c.raw),
	};
}

/** Video-call domains we prefer when several links are present. */
const PREFERRED_HOSTS = ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "webex.com", "whereby.com"];
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Picks the most likely "join" link for an event. Prefers a known video-conferencing
 * host found anywhere in the URL field, location, or notes; otherwise falls back to
 * the event's URL field, then the first URL in the notes.
 */
export function extractMeetingLink(e: Pick<RawEvent, "url" | "location" | "notes">): string | null {
	const haystacks = [e.url, e.location, e.notes].filter((s): s is string => !!s);
	const urls: string[] = [];
	for (const h of haystacks) {
		const matches = h.match(URL_RE);
		if (matches) urls.push(...matches);
	}
	if (urls.length === 0) {
		return e.url && /^https?:\/\//i.test(e.url) ? e.url : null;
	}

	const preferred = urls.find((u) => PREFERRED_HOSTS.some((host) => u.toLowerCase().includes(host)));
	return preferred ?? urls[0];
}

/** Lists all calendars in macOS Calendar.app for the Property Inspector picker. Never throws. */
export async function listCalendars(): Promise<CalendarListResult> {
	let stdout: string;
	try {
		const res = await execFileAsync("osascript", ["-e", LIST_CALENDARS_SCRIPT], {
			timeout: OSASCRIPT_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
		});
		stdout = res.stdout;
	} catch (err) {
		return { kind: "error", message: err instanceof Error ? err.message : String(err) };
	}

	try {
		const raw = JSON.parse(stdout.trim()) as { status: "ok"; calendars: CalendarInfo[] } | { status: "no-access" };
		if (raw.status === "no-access") {
			return { kind: "no-access" };
		}
		// De-dupe by id and sort by account then title for a tidy picker.
		const seen = new Set<string>();
		const calendars = raw.calendars
			.filter((c) => c.id && !seen.has(c.id) && seen.add(c.id))
			.sort((a, b) => a.account.localeCompare(b.account) || a.title.localeCompare(b.title));
		return { kind: "ok", calendars };
	} catch {
		return { kind: "error", message: `Unparseable calendar list: ${stdout.slice(0, 200)}` };
	}
}
