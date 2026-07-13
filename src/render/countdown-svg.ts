/**
 * Renders the Stream Deck key as an SVG data URI. SVG is resolution-independent, so a
 * single string looks crisp on both standard (72px) and high-DPI (144px) keys, and it
 * needs no native canvas dependency. Rebuilding this string once per second is cheap.
 */

export type RenderState =
	| { kind: "countdown"; remainingMs: number; title: string; amberMs: number; redMs: number; ringFrac: number; label: string; reverseRing: boolean }
	| { kind: "alarm"; title: string; frame: number }
	| { kind: "confirm"; title: string }
	| { kind: "toast"; text: string }
	| { kind: "loading" }
	| { kind: "idle"; label: string; text: string }
	| { kind: "no-access" }
	| { kind: "error" };

type Phase = { bg: string; ring: string; track: string; time: string };

const GREEN: Phase = { bg: "#0f241a", ring: "#31c46b", track: "#1c3a2b", time: "#ffffff" };
const AMBER: Phase = { bg: "#2a2109", ring: "#ffb020", track: "#3d3316", time: "#ffffff" };
const RED: Phase = { bg: "#2c0f0f", ring: "#ff4d4f", track: "#3d1c1d", time: "#ffffff" };
const NEUTRAL: Phase = { bg: "#17181c", ring: "#3a3d45", track: "#26282e", time: "#e6e8ec" };

const SUBTLE = "#9aa0aa";
const SIZE = 144;
const CENTER = SIZE / 2;
const RADIUS = 62;
/** Real circumference in user units — used for dash math (Stream Deck's renderer ignores `pathLength`). */
const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Returns a `data:image/svg+xml,...` URI suitable for `action.setImage()`. */
export function renderKey(state: RenderState): string {
	return `data:image/svg+xml,${encodeURIComponent(buildSvg(state))}`;
}

function buildSvg(state: RenderState): string {
	switch (state.kind) {
		case "countdown":
			return countdownSvg(state);
		case "alarm":
			return alarmSvg(state.title, state.frame);
		case "confirm":
			return confirmSvg(state.title);
		case "toast":
			return toastSvg(state.text);
		case "loading":
			return simpleSvg(NEUTRAL, [big("…")]);
		case "idle":
			return idleSvg(state.label, state.text);
		case "no-access":
			return simpleSvg(
				{ ...NEUTRAL, bg: "#2c0f0f", ring: "#ff4d4f", track: "#3d1c1d" },
				[
					text("Calendar", CENTER, 62, 21, "#ff9a9a", 700),
					text("access", CENTER, 88, 21, "#ff9a9a", 700),
					text("→ Settings", CENTER, 118, 13, SUBTLE, 400),
				],
			);
		case "error":
			return simpleSvg(NEUTRAL, [big("!", 78, "#ffb020"), sub("retrying", 104)]);
	}
}

/** Font size for the mode label and meeting name (kept equal, per design). */
const NAME_SIZE = 18;
/** Horizontal space (px) available for the meeting name before it scrolls. */
const NAME_BAND = 128;
/** Approximate width of a character at the name font (sans-serif). */
const NAME_CHAR_W = NAME_SIZE * 0.58;

function countdownSvg(s: Extract<RenderState, { kind: "countdown" }>): string {
	const phase = s.remainingMs <= s.redMs ? RED : s.remainingMs <= s.amberMs ? AMBER : GREEN;

	const frac = clamp01(s.ringFrac);

	const time = formatTime(s.remainingMs);
	const title = (s.title || "Meeting").trim();

	return svgShell(phase.bg, [
		ring(phase.track, phase.ring, frac, s.reverseRing),
		text(esc(s.label), CENTER, 42, NAME_SIZE, SUBTLE, 700),
		text(time, CENTER, 86, timeFontSize(time), phase.time, 700, "Menlo, monospace"),
		nameBlock(title, 122),
	]);
}

/**
 * The meeting name at the bottom. Centered when it fits; otherwise scrolled like a ticker.
 * Scrolling is frame-based (the renderer is called repeatedly) — Stream Deck rasterizes the
 * SVG once, so a `Date.now()`-driven offset animates it across successive repaints.
 */
function nameBlock(title: string, y: number): string {
	const textW = title.length * NAME_CHAR_W;
	if (textW <= NAME_BAND) {
		return text(esc(title), CENTER, y, NAME_SIZE, SUBTLE, 600);
	}
	const gap = 28;
	const cycle = textW + gap;
	const offset = ((Date.now() / 1000) * 32) % cycle; // 32 px/sec
	const x1 = 8 - offset;
	const x2 = x1 + cycle; // second copy makes the loop seamless
	const t = esc(title);
	const sans = "Helvetica, Arial, sans-serif";
	return (
		`<clipPath id="mq"><rect x="6" y="${(y - NAME_SIZE).toFixed(1)}" width="132" height="${(NAME_SIZE + 8).toFixed(1)}"/></clipPath>` +
		`<g clip-path="url(#mq)">` +
		text(t, x1, y, NAME_SIZE, SUBTLE, 600, sans, "start") +
		text(t, x2, y, NAME_SIZE, SUBTLE, 600, sans, "start") +
		`</g>`
	);
}

/** The "tap again to join" confirmation prompt. Deliberately ring-less and blue so it
 * reads as a distinct mode, not a countdown. */
function confirmSvg(title: string): string {
	const bg = "#13345c";
	// A small play/join glyph above the prompt.
	const glyph = `<path d="M62 46 L86 60 L62 74 Z" fill="#7fb0ff"/>`;
	return svgShell(bg, [
		glyph,
		text(esc(truncate(title || "Meeting", 12)), CENTER, 34, 13, "#9db9e6", 600),
		text("Join?", CENTER, 104, 30, "#ffffff", 700),
		text("tap again", CENTER, 128, 12, "#7fb0ff", 500),
	]);
}

/** Bell swing angles (degrees) cycled frame-by-frame to animate a ringing shake. */
const BELL_SWING = [0, 9, 13, 9, 0, -9, -13, -9];

/** The going-off alarm — a shaking bell on a pulsing red field, with a dismiss hint. */
function alarmSvg(title: string, frame: number): string {
	const angle = BELL_SWING[frame % BELL_SWING.length];
	const bg = frame % 8 < 4 ? "#3a1414" : "#4d1a1a";
	// Lucide "bell" (24×24) scaled and placed, rotated around its hang point to swing.
	const bell =
		`<g transform="rotate(${angle} 72 38) translate(37 32) scale(2.9)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>` +
		`<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>` +
		`</g>`;
	return svgShell(bg, [
		bell,
		text(esc(truncate(title || "Meeting", 12)), CENTER, 26, 12, "#ffd7d7", 600),
		text("tap to dismiss", CENTER, 130, 11, "#ff9a9a", 500),
	]);
}

/** A brief, neutral, ring-less message shown in response to a press (e.g. "No link"). */
function toastSvg(message: string): string {
	const lines = wrapText(message, 9);
	const fontSize = lines.length === 1 && message.length <= 8 ? 28 : 22;
	const lineHeight = fontSize * 1.15;
	const firstY = 82 - ((lines.length - 1) * lineHeight) / 2;
	const els = lines.map((line, i) => text(esc(line), CENTER, firstY + i * lineHeight, fontSize, NEUTRAL.time, 700));
	return svgShell(NEUTRAL.bg, els);
}

/** The empty state — no ring (nothing to count down), just a centered, word-wrapped message
 * under the mode label. */
function idleSvg(label: string, message: string): string {
	const lines = wrapText(message, 9);
	const fontSize = lines.length === 1 && message.length <= 5 ? 34 : 22;
	const lineHeight = fontSize * 1.15;
	const blockMiddle = 94;
	const firstY = blockMiddle - ((lines.length - 1) * lineHeight) / 2;
	const messageEls = lines.map((line, i) => text(esc(line), CENTER, firstY + i * lineHeight, fontSize, NEUTRAL.time, 700));
	return svgShell(NEUTRAL.bg, [text(esc(label), CENTER, 40, 12, SUBTLE, 700), ...messageEls]);
}

// ---- SVG building blocks ---------------------------------------------------

function svgShell(bg: string, children: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="24" fill="${bg}"/>` +
		children.join("") +
		`</svg>`;
}

function simpleSvg(phase: Phase, children: string[]): string {
	return svgShell(phase.bg, [ring(phase.track, phase.ring, 1), ...children]);
}

/**
 * A progress ring: a full dark track with a colored arc on top, filled `frac` of the way
 * round, starting at 12 o'clock (rotated -90°).
 *
 * The arc is a single dash of length `C * frac` followed by a gap of `C`, sized in real
 * user units. We deliberately avoid the `pathLength`/`stroke-dashoffset` trick because
 * Stream Deck's key renderer ignores `pathLength`, which made the dash pattern tile around
 * the true circumference and render as a split/segmented ring.
 */
function ring(track: string, color: string, frac: number, reverse = false): string {
	const common = `cx="${CENTER}" cy="${CENTER}" r="${RADIUS}" fill="none" stroke-width="8"`;
	const dash = (RING_CIRCUMFERENCE * clamp01(frac)).toFixed(2);
	const circumference = RING_CIRCUMFERENCE.toFixed(2);
	// Both start at 12 o'clock (rotate -90). `reverse` mirrors horizontally, flipping the
	// sweep between counter-clockwise and clockwise so the two actions look distinct.
	const rotate = `rotate(-90 ${CENTER} ${CENTER})`;
	const transform = reverse ? `translate(${SIZE} 0) scale(-1 1) ${rotate}` : rotate;
	return (
		`<circle ${common} stroke="${track}"/>` +
		`<circle ${common} stroke="${color}" stroke-linecap="round" ` +
		`stroke-dasharray="${dash} ${circumference}" ` +
		`transform="${transform}"/>`
	);
}

function text(
	content: string,
	x: number,
	y: number,
	size: number,
	fill: string,
	weight = 400,
	family = "Helvetica, Arial, sans-serif",
	anchor = "middle",
): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${content}</text>`;
}

const big = (c: string, y = 84, fill = NEUTRAL.time, size = 48) => text(c, CENTER, y, size, fill, 700);
const sub = (c: string, y: number) => text(c, CENTER, y, 14, SUBTLE, 500);

// ---- helpers ---------------------------------------------------------------

/** `Xh Ym` (dropping ` 0m` on the hour) at or above an hour, `m:ss` under an hour, clamped at zero. */
export function formatTime(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const sec = totalSec % 60;
	if (h > 0) {
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
	return `${m}:${pad(sec)}`;
}

/** Size the time to sit comfortably inside the ring; smaller for longer/wider values. */
function timeFontSize(time: string): number {
	const n = time.length;
	if (n >= 7) return 24; // e.g. "12h 45m"
	if (n >= 6) return 28; // e.g. "1h 45m"
	if (n >= 5) return 33; // e.g. "12:30", "1h 5m"
	return 40; // e.g. "9:59"
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

function truncate(s: string, n: number): string {
	const t = s.trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Greedy word-wrap into lines of at most `maxChars` (a long single word is kept whole). */
function wrapText(s: string, maxChars: number): string[] {
	const lines: string[] = [];
	let current = "";
	for (const word of s.trim().split(/\s+/)) {
		if (!current) {
			current = word;
		} else if (`${current} ${word}`.length <= maxChars) {
			current += ` ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) {
		lines.push(current);
	}
	return lines.length ? lines : [s];
}

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
