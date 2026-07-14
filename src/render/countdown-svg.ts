/**
 * Renders the Stream Deck key as an SVG data URI. SVG is resolution-independent, so a
 * single string looks crisp on both standard (72px) and high-DPI (144px) keys, and it
 * needs no native canvas dependency. Rebuilding this string once per second is cheap.
 */

export type RenderState =
	| { kind: "countdown"; remainingMs: number; title: string; amberMs: number; redMs: number; ringFrac: number; label: string; reverseRing: boolean; pulse: boolean }
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

/** Returns a `data:image/svg+xml,...` URI suitable for `action.setImage()`. When `dim` is set,
 * a translucent overlay darkens the whole key to de-emphasize it. */
export function renderKey(state: RenderState, dim = false): string {
	let svg = buildSvg(state);
	if (dim) {
		svg = svg.replace("</svg>", `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="24" fill="#000000" opacity="0.5"/></svg>`);
	}
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
/** A name wider than this (px, centered inside the border) scrolls; anything narrower is centered.
 * Sized so a centered name clears the rounded border corners (see {@link NAME_BAND_X}). */
const NAME_FIT_MAX = 104;
/** Scrolling-name band: inset from the border so text never crosses the ring, even at the corners. */
const NAME_BAND_X = 20;
const NAME_BAND_W = SIZE - 2 * NAME_BAND_X;

function countdownSvg(s: Extract<RenderState, { kind: "countdown" }>): string {
	const phase = s.remainingMs <= s.redMs ? RED : s.remainingMs <= s.amberMs ? AMBER : GREEN;

	const frac = clamp01(s.ringFrac);

	const time = formatTime(s.remainingMs);
	const title = (s.title || "Meeting").trim();
	const bg = s.pulse ? pulseBg(phase.bg, Date.now()) : phase.bg;

	return svgShell(bg, [
		progressBorder(BORDER_PATH, BORDER_PERIMETER, BORDER_WIDTH, SIZE, phase.track, phase.ring, frac, s.reverseRing),
		text(esc(s.label), CENTER, 44, NAME_SIZE, SUBTLE, 700),
		text(time, CENTER, 88, timeFontSize(time), phase.time, 700, "Menlo, monospace"),
		nameBlock(title, 122),
	]);
}

/** Gently brightens a dark background on a slow ~2.8s sine, for the "you're in a meeting" pulse. */
function pulseBg(hex: string, ms: number): string {
	const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / 2800); // smooth 0..1
	const add = Math.round(k * 26);
	const n = parseInt(hex.slice(1), 16);
	const r = Math.min(255, ((n >> 16) & 255) + add);
	const g = Math.min(255, ((n >> 8) & 255) + add);
	const b = Math.min(255, (n & 255) + add);
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * A rounded-rectangle border hugging the key edge that drains like the old ring, but stays
 * out at the perimeter clear of the centered content. Starts at top-center; `reverse` mirrors
 * it so Current and Next sweep opposite ways. Sized in real path units (Stream Deck ignores
 * `pathLength`, which is why the original ring had to as well).
 */
const BORDER_INSET = 6;
const BORDER_RADIUS = 18;
const BORDER_WIDTH = 8;
const BORDER_PATH = buildBorderPath(SIZE, SIZE, BORDER_INSET, BORDER_RADIUS);
const BORDER_PERIMETER = buildPerimeter(SIZE, SIZE, BORDER_INSET, BORDER_RADIUS);

/** A rounded-rectangle border path hugging the canvas edge, from top-center running clockwise. */
function buildBorderPath(w: number, h: number, inset: number, rr: number): string {
	const loX = inset;
	const hiX = w - inset;
	const loY = inset;
	const hiY = h - inset;
	const cx = w / 2;
	return `M ${cx} ${loY} L ${hiX - rr} ${loY} A ${rr} ${rr} 0 0 1 ${hiX} ${loY + rr} L ${hiX} ${hiY - rr} A ${rr} ${rr} 0 0 1 ${hiX - rr} ${hiY} L ${loX + rr} ${hiY} A ${rr} ${rr} 0 0 1 ${loX} ${hiY - rr} L ${loX} ${loY + rr} A ${rr} ${rr} 0 0 1 ${loX + rr} ${loY} L ${cx} ${loY} Z`;
}

/** Total stroke length of {@link buildBorderPath} for the same dimensions. */
function buildPerimeter(w: number, h: number, inset: number, rr: number): number {
	return 2 * (w - 2 * inset - 2 * rr) + 2 * (h - 2 * inset - 2 * rr) + 2 * Math.PI * rr;
}

/**
 * A draining rounded-rectangle border. `frac` (0–1) sets how much is filled; `reverse` mirrors it
 * horizontally so Current and Next sweep opposite ways. `path`/`perimeter` are precomputed per
 * surface (key or dial), and `mirrorW` is that surface's width for the mirror transform.
 */
function progressBorder(path: string, perimeter: number, width: number, mirrorW: number, track: string, color: string, frac: number, reverse: boolean): string {
	const dash = (perimeter * clamp01(frac)).toFixed(2);
	const mirror = reverse ? ` transform="translate(${mirrorW} 0) scale(-1 1)"` : "";
	return (
		`<path d="${path}" fill="none" stroke="${track}" stroke-width="${width}"/>` +
		`<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${dash} ${perimeter.toFixed(2)}"${mirror}/>`
	);
}

/**
 * The meeting name at the bottom. Centered when it fits; otherwise scrolled like a ticker.
 * Scrolling is frame-based (the renderer is called repeatedly) — Stream Deck rasterizes the
 * SVG once, so a `Date.now()`-driven offset animates it across successive repaints.
 */
function nameBlock(title: string, y: number): string {
	const textW = textWidth(title, NAME_SIZE);
	if (textW <= NAME_FIT_MAX) {
		return text(esc(title), CENTER, y, NAME_SIZE, SUBTLE, 700);
	}

	// Overflowing → scroll it like a ticker, clipped to a band well inside the border.
	const bandX = NAME_BAND_X;
	const bandW = NAME_BAND_W;
	const clipY = (y - NAME_SIZE).toFixed(1);
	const clipH = (NAME_SIZE + 6).toFixed(1);
	const gap = 28;
	const cycle = textW + gap;
	const offset = ((Date.now() / 1000) * 32) % cycle; // 32 px/sec
	const x1 = bandX - offset;
	const x2 = x1 + cycle; // second copy makes the loop seamless
	const t = esc(title);
	const sans = "Helvetica, Arial, sans-serif";
	// The clipPath must live in <defs> — Stream Deck's renderer only resolves url(#…) clips defined there.
	return (
		`<defs><clipPath id="mq"><rect x="${bandX}" y="${clipY}" width="${bandW}" height="${clipH}"/></clipPath></defs>` +
		`<g clip-path="url(#mq)">` +
		text(t, x1, y, NAME_SIZE, SUBTLE, 700, sans, "start") +
		text(t, x2, y, NAME_SIZE, SUBTLE, 700, sans, "start") +
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

/** Lucide "bell" (24×24) inner paths — shared by the key and dial alarm renders. */
const BELL_PATHS =
	`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>` +
	`<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`;

/** The bell scaled/placed via `translate`+`scale`, rotated by `angle` around a hang point. */
function bellGlyph(angle: number, rotCx: number, rotCy: number, tx: number, ty: number, scale: number): string {
	return (
		`<g transform="rotate(${angle} ${rotCx} ${rotCy}) translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
		BELL_PATHS +
		`</g>`
	);
}

/** The going-off alarm — a shaking bell on a pulsing red field, with a dismiss hint. */
function alarmSvg(title: string, frame: number): string {
	const angle = BELL_SWING[frame % BELL_SWING.length];
	const bg = frame % 8 < 4 ? "#3a1414" : "#4d1a1a";
	return svgShell(bg, [
		bellGlyph(angle, 72, 38, 37, 32, 2.9),
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
	return svgShell(phase.bg, children);
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

/**
 * Estimates rendered width (px) of a string at a given font size, using per-character width
 * ratios for a bold sans-serif. Proportional (an "i" is far narrower than a "W"), so the
 * "does it fit?" test is accurate enough to only scroll genuinely long names.
 */
function textWidth(str: string, fontSize: number): number {
	let ratio = 0;
	for (const ch of str) {
		if (ch === " ") ratio += 0.28;
		else if ("iIl.,:;'!|`".includes(ch)) ratio += 0.3;
		else if ("fjrt()[]{}/\\-".includes(ch)) ratio += 0.4;
		else if ("mw".includes(ch)) ratio += 0.87;
		else if ("MW".includes(ch)) ratio += 0.9;
		else if (ch >= "A" && ch <= "Z") ratio += 0.66;
		else if (ch >= "0" && ch <= "9") ratio += 0.55;
		else ratio += 0.53;
	}
	return ratio * fontSize;
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

// ---- Stream Deck + dial (encoder touchscreen) ------------------------------

/**
 * The touchscreen segment above each Stream Deck + dial is a 200×100 landscape canvas, so the
 * dial gets its own layout, but shares the key's visual language: the same draining perimeter
 * border, with the mode label, countdown, and meeting name stacked inside. The states mirror
 * {@link renderKey}, re-laid for the strip; colors, border, and text helpers are shared.
 */
const DIAL_W = 200;
const DIAL_H = 100;
const SANS = "Helvetica, Arial, sans-serif";
/** Draining border geometry for the strip (a landscape sibling of the key's border). */
const DIAL_BORDER_INSET = 6;
const DIAL_BORDER_RADIUS = 16;
const DIAL_BORDER_WIDTH = 8;
const DIAL_BORDER_PATH = buildBorderPath(DIAL_W, DIAL_H, DIAL_BORDER_INSET, DIAL_BORDER_RADIUS);
const DIAL_BORDER_PERIMETER = buildPerimeter(DIAL_W, DIAL_H, DIAL_BORDER_INSET, DIAL_BORDER_RADIUS);
/** Horizontal band the meeting name lives in — inset enough to clear the rounded border corners. */
const DIAL_NAME_X = 22;
const DIAL_NAME_W = DIAL_W - 2 * DIAL_NAME_X;

/**
 * Returns a base64 `data:image/svg+xml` URI for the dial touchscreen, suitable as a layout
 * pixmap value via `DialAction.setFeedback`. When `dim` is set, a translucent overlay darkens
 * the whole strip to de-emphasize it (matching {@link renderKey}).
 */
export function renderDial(state: RenderState, dim = false): string {
	let svg = buildDialSvg(state);
	if (dim) {
		svg = svg.replace("</svg>", `<rect x="0" y="0" width="${DIAL_W}" height="${DIAL_H}" fill="#000000" opacity="0.5"/></svg>`);
	}
	// Layout pixmap values take a base64-encoded data URI (setImage also accepts URL-encoded; setFeedback is stricter).
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function buildDialSvg(state: RenderState): string {
	switch (state.kind) {
		case "countdown":
			return dialCountdown(state);
		case "alarm":
			return dialAlarm(state.title, state.frame);
		case "confirm":
			return dialConfirm(state.title);
		case "toast":
			return dialMessage(NEUTRAL.bg, state.text);
		case "loading":
			return dialShell(NEUTRAL.bg, [text("…", DIAL_W / 2, 62, 40, NEUTRAL.time, 700)]);
		case "idle":
			return dialIdle(state.label, state.text);
		case "no-access":
			return dialShell("#2c0f0f", [
				text("Calendar access", DIAL_W / 2, 44, 19, "#ff9a9a", 700),
				text("→ Settings", DIAL_W / 2, 70, 14, SUBTLE, 400),
			]);
		case "error":
			return dialShell(NEUTRAL.bg, [text("!", DIAL_W / 2, 50, 40, "#ffb020", 700), text("retrying", DIAL_W / 2, 78, 14, SUBTLE, 500)]);
	}
}

function dialCountdown(s: Extract<RenderState, { kind: "countdown" }>): string {
	const phase = s.remainingMs <= s.redMs ? RED : s.remainingMs <= s.amberMs ? AMBER : GREEN;
	const time = formatTime(s.remainingMs);
	const title = (s.title || "Meeting").trim();
	const bg = s.pulse ? pulseBg(phase.bg, Date.now()) : phase.bg;
	// Label, time, and name stack vertically inside the draining border, like the key.
	return dialShell(bg, [
		progressBorder(DIAL_BORDER_PATH, DIAL_BORDER_PERIMETER, DIAL_BORDER_WIDTH, DIAL_W, phase.track, phase.ring, clamp01(s.ringFrac), s.reverseRing),
		text(esc(s.label), DIAL_W / 2, 27, 13, SUBTLE, 700),
		text(time, DIAL_W / 2, 62, dialTimeFontSize(time), phase.time, 700, "Menlo, monospace"),
		dialName(title, 82),
	]);
}

/** Time size for the strip; the landscape canvas affords a larger hero than the key. */
function dialTimeFontSize(time: string): number {
	const n = time.length;
	if (n >= 7) return 27; // "12h 45m"
	if (n >= 6) return 31; // "1h 45m"
	if (n >= 5) return 35; // "12:30"
	return 42; // "9:59"
}

/** The meeting name across the bottom band: centered when it fits, else scrolled like the key ticker. */
function dialName(title: string, y: number): string {
	const size = 13;
	if (textWidth(title, size) <= DIAL_NAME_W) {
		return text(esc(title), DIAL_W / 2, y, size, SUBTLE, 700);
	}
	const gap = 26;
	const cycle = textWidth(title, size) + gap;
	const offset = ((Date.now() / 1000) * 32) % cycle; // 32 px/sec
	const x1 = DIAL_NAME_X - offset;
	const x2 = x1 + cycle; // second copy makes the loop seamless
	const t = esc(title);
	// The clipPath must live in <defs> — Stream Deck's renderer only resolves url(#…) clips defined there.
	return (
		`<defs><clipPath id="dm"><rect x="${DIAL_NAME_X}" y="${(y - size).toFixed(1)}" width="${DIAL_NAME_W}" height="${size + 4}"/></clipPath></defs>` +
		`<g clip-path="url(#dm)">` +
		text(t, x1, y, size, SUBTLE, 700, SANS, "start") +
		text(t, x2, y, size, SUBTLE, 700, SANS, "start") +
		`</g>`
	);
}

/** The empty state — mode label above a centered, word-wrapped message. */
function dialIdle(label: string, message: string): string {
	const lines = wrapText(message, 16);
	const size = lines.length === 1 && message.length <= 6 ? 30 : 20;
	const lineHeight = size * 1.15;
	const firstY = 60 - ((lines.length - 1) * lineHeight) / 2;
	return dialShell(NEUTRAL.bg, [
		text(esc(label), DIAL_W / 2, 26, 12, SUBTLE, 700),
		...lines.map((line, i) => text(esc(line), DIAL_W / 2, firstY + i * lineHeight, size, NEUTRAL.time, 700)),
	]);
}

/** A brief, centered, ring-less message (e.g. "No link") shown in response to a press. */
function dialMessage(bg: string, message: string): string {
	const lines = wrapText(message, 16);
	const size = lines.length === 1 && message.length <= 8 ? 28 : 20;
	const lineHeight = size * 1.15;
	const firstY = 58 - ((lines.length - 1) * lineHeight) / 2;
	return dialShell(
		bg,
		lines.map((line, i) => text(esc(line), DIAL_W / 2, firstY + i * lineHeight, size, NEUTRAL.time, 700)),
	);
}

/** The "push again to join" confirmation — blue and ring-less, distinct from a countdown. */
function dialConfirm(title: string): string {
	const glyph = `<path d="M40 34 L66 50 L40 66 Z" fill="#7fb0ff"/>`;
	return dialShell("#13345c", [
		glyph,
		text(esc(truncate(title || "Meeting", 16)), 132, 30, 13, "#9db9e6", 600),
		text("Join?", 132, 60, 26, "#ffffff", 700),
		text("push again", 132, 82, 12, "#7fb0ff", 500),
	]);
}

/** The going-off alarm — a shaking bell with the title and a dismiss hint. */
function dialAlarm(title: string, frame: number): string {
	const angle = BELL_SWING[frame % BELL_SWING.length];
	const bg = frame % 8 < 4 ? "#3a1414" : "#4d1a1a";
	return dialShell(bg, [
		bellGlyph(angle, 52, 34, 28, 26, 2),
		text(esc(truncate(title || "Meeting", 16)), 138, 44, 13, "#ffd7d7", 600),
		text("push to dismiss", 138, 70, 11, "#ff9a9a", 500),
	]);
}

function dialShell(bg: string, children: string[]): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${DIAL_W}" height="${DIAL_H}" viewBox="0 0 ${DIAL_W} ${DIAL_H}">` +
		`<rect x="0" y="0" width="${DIAL_W}" height="${DIAL_H}" fill="${bg}"/>` +
		children.join("") +
		`</svg>`
	);
}
