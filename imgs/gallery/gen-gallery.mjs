// Generates Elgato Marketplace gallery panels (1920x960) for Next Meeting Countdown.
// Reproduces the plugin's REAL key/dial SVG visuals (colors + geometry copied verbatim
// from src/render/countdown-svg.ts) so the media accurately depicts the product.
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = process.argv[2] || ".";
mkdirSync(OUT, { recursive: true });

// ---- exact palette + geometry from countdown-svg.ts ------------------------
const GREEN = { bg: "#0f241a", ring: "#31c46b", track: "#1c3a2b", time: "#ffffff" };
const AMBER = { bg: "#2a2109", ring: "#ffb020", track: "#3d3316", time: "#ffffff" };
const RED = { bg: "#2c0f0f", ring: "#ff4d4f", track: "#3d1c1d", time: "#ffffff" };
const NEUTRAL = { bg: "#17181c", ring: "#3a3d45", track: "#26282e", time: "#e6e8ec" };
const SUBTLE = "#9aa0aa";

function borderPath(w, h, inset, rr) {
  const loX = inset, hiX = w - inset, loY = inset, hiY = h - inset, cx = w / 2;
  return `M ${cx} ${loY} L ${hiX - rr} ${loY} A ${rr} ${rr} 0 0 1 ${hiX} ${loY + rr} L ${hiX} ${hiY - rr} A ${rr} ${rr} 0 0 1 ${hiX - rr} ${hiY} L ${loX + rr} ${hiY} A ${rr} ${rr} 0 0 1 ${loX} ${hiY - rr} L ${loX} ${loY + rr} A ${rr} ${rr} 0 0 1 ${loX + rr} ${loY} L ${cx} ${loY} Z`;
}
function perimeter(w, h, inset, rr) {
  return 2 * (w - 2 * inset - 2 * rr) + 2 * (h - 2 * inset - 2 * rr) + 2 * Math.PI * rr;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function t(c, x, y, size, fill, weight = 400, family = "Helvetica, Arial, sans-serif", anchor = "middle") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${c}</text>`;
}

// ---- KEY (144x144) ---------------------------------------------------------
const K = 144, KC = 72;
const KBP = borderPath(K, K, 6, 18), KPER = perimeter(K, K, 6, 18), KW = 8;
function progress(path, per, w, mirrorW, track, color, frac, reverse) {
  const dash = (per * Math.max(0, Math.min(1, frac))).toFixed(2);
  const m = reverse ? ` transform="translate(${mirrorW} 0) scale(-1 1)"` : "";
  return `<path d="${path}" fill="none" stroke="${track}" stroke-width="${w}"/>` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${dash} ${per.toFixed(2)}"${m}/>`;
}
function keyShell(bg, kids) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${K}" height="${K}" viewBox="0 0 ${K} ${K}"><path d="${KBP}" fill="${bg}"/>${kids.join("")}</svg>`;
}
// countdown key: label(top) / time(mid) / name(bottom) + draining border
function keyCountdown({ ph, time, label, name, frac, reverse = false }) {
  const timeSize = time.length >= 7 ? 24 : time.length >= 6 ? 28 : time.length >= 5 ? 33 : 40;
  return keyShell(ph.bg, [
    t(esc(name), KC, 122, 18, SUBTLE, 700),
    progress(KBP, KPER, KW, K, ph.track, ph.ring, frac, reverse),
    t(esc(label), KC, 44, 18, SUBTLE, 700),
    t(time, KC, 88, timeSize, ph.time, 700, "Menlo, monospace"),
  ]);
}
function keyIdle({ label, big, small }) {
  const kids = [t(esc(label), KC, 40, 12, SUBTLE, 700)];
  if (small) { kids.push(t(esc(big), KC, 84, 22, NEUTRAL.time, 700)); kids.push(t(esc(small), KC, 110, 22, NEUTRAL.time, 700)); }
  else kids.push(t(esc(big), KC, 94, 34, NEUTRAL.time, 700));
  return keyShell(NEUTRAL.bg, kids);
}
function keyConfirm(name) {
  return keyShell("#13345c", [
    `<path d="M62 46 L86 60 L62 74 Z" fill="#7fb0ff"/>`,
    t(esc(name), KC, 34, 13, "#9db9e6", 600),
    t("Join?", KC, 104, 30, "#ffffff", 700),
    t("tap again", KC, 128, 12, "#7fb0ff", 500),
  ]);
}

// ---- DIAL (200x100) --------------------------------------------------------
const DW = 200, DH = 100;
const DBP = borderPath(DW, DH, 6, 16), DPER = perimeter(DW, DH, 6, 16), DWID = 8;
function dialShell(bg, kids) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DW}" height="${DH}" viewBox="0 0 ${DW} ${DH}"><path d="${DBP}" fill="${bg}"/>${kids.join("")}</svg>`;
}
function dialCountdown({ ph, time, label, name, frac, reverse = false }) {
  const ts = time.length >= 7 ? 27 : time.length >= 6 ? 31 : time.length >= 5 ? 35 : 42;
  return dialShell(ph.bg, [
    t(esc(name), DW / 2, 82, 13, SUBTLE, 700),
    progress(DBP, DPER, DWID, DW, ph.track, ph.ring, frac, reverse),
    t(esc(label), DW / 2, 27, 13, SUBTLE, 700),
    t(time, DW / 2, 62, ts, ph.time, 700, "Menlo, monospace"),
  ]);
}

// ---- keycap wrapper (evokes a Stream Deck key without any Elgato branding) --
function cap(svg, px) {
  const pad = Math.round(px * 0.11);
  const inner = px - pad * 2;
  return `<div class="cap" style="width:${px}px;height:${px}px;padding:${pad}px">
    <div class="capinner" style="width:${inner}px;height:${inner}px">${svg}</div></div>`;
}
function capW(svg, w, ratio = DH / DW) {
  const pad = Math.round(w * 0.055);
  const iw = w - pad * 2, ih = Math.round(iw * ratio);
  return `<div class="cap" style="width:${w}px;height:${ih + pad * 2}px;padding:${pad}px">
    <div class="capinner" style="width:${iw}px;height:${ih}px">${svg}</div></div>`;
}

// ---- page shell ------------------------------------------------------------
function page(inner, extraCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1920px;height:960px;overflow:hidden}
  body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;
    background:radial-gradient(120% 120% at 20% 0%,#1b1e26 0%,#101218 45%,#0a0b0f 100%);
    color:#fff;position:relative}
  .stage{width:1920px;height:960px;display:flex;flex-direction:column;justify-content:center;padding:0 130px}
  h1{font-size:82px;font-weight:800;letter-spacing:-2px;line-height:1.02}
  h1 .accent{color:#31c46b}
  p.sub{font-size:34px;font-weight:400;color:#aab1bd;margin-top:26px;max-width:1180px;line-height:1.28}
  .keys{display:flex;align-items:center;gap:56px}
  .cap{background:linear-gradient(180deg,#2a2d34,#1a1c22);border-radius:22px;
    box-shadow:0 26px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08),inset 0 -3px 8px rgba(0,0,0,.5);
    display:flex;align-items:center;justify-content:center;flex:none}
  .capinner{border-radius:12px;overflow:hidden;background:#0a0b0f;display:flex;align-items:center;justify-content:center}
  .capinner svg{width:100%;height:100%;display:block}
  .caption{font-size:26px;color:#8b93a1;font-weight:600;text-align:center;margin-top:22px;letter-spacing:.2px}
  .colwrap{display:flex;flex-direction:column;align-items:center}
  .brand{position:absolute;left:130px;bottom:56px;font-size:26px;color:#5b6270;font-weight:600;letter-spacing:.4px}
  .brand b{color:#aab1bd}
  .badge{display:inline-block;font-size:24px;font-weight:700;color:#31c46b;background:rgba(49,196,107,.12);
    border:1px solid rgba(49,196,107,.35);padding:10px 20px;border-radius:100px;margin-bottom:30px;letter-spacing:.5px}
  ${extraCss}
  </style></head><body>${inner}
  </body></html>`;
}

// A labelled column (keycap + caption under it)
const col = (svg, px, caption) => `<div class="colwrap">${cap(svg, px)}<div class="caption">${caption}</div></div>`;

// ---- PANELS ----------------------------------------------------------------
const panels = {};

// 1) HERO
panels["01-hero"] = page(`
  <div class="stage" style="flex-direction:row;align-items:center;gap:120px">
    <div style="flex:1">
      <div class="badge">STREAM DECK PLUGIN</div>
      <h1>Your next meeting,<br><span class="accent">always in view.</span></h1>
      <p class="sub">A live countdown on your Stream Deck — so you're never caught off guard, and you jump into the call with one tap.</p>
    </div>
    <div class="keys" style="flex:none">
      ${cap(keyCountdown({ ph: GREEN, time: "24:15", label: "NEXT", name: "Design review", frac: 0.4 }), 380)}
    </div>
  </div>`);

// 2) COLOR URGENCY
panels["02-urgency"] = page(`
  <div class="stage" style="align-items:center;text-align:center">
    <h1 style="font-size:70px">Urgency you read at a glance</h1>
    <p class="sub" style="text-align:center;margin:24px auto 60px">The key shades <b style="color:#31c46b">green</b> → <b style="color:#ffb020">amber</b> → <b style="color:#ff4d4f">red</b> as time runs down, at thresholds you set.</p>
    <div class="keys" style="justify-content:center">
      ${col(keyCountdown({ ph: GREEN, time: "45:00", label: "NEXT", name: "Design review", frac: 0.75 }), 300, "Plenty of time")}
      ${col(keyCountdown({ ph: AMBER, time: "12:00", label: "NEXT", name: "Weekly sync", frac: 0.2 }), 300, "Getting close")}
      ${col(keyCountdown({ ph: RED, time: "3:25", label: "NEXT", name: "1:1 with Sam", frac: 0.06 }), 300, "Wrap up now")}
    </div>
  </div>`);

// 3) TWO MODES
panels["03-modes"] = page(`
  <div class="stage" style="align-items:center;text-align:center">
    <h1 style="font-size:70px">Two ways to keep time</h1>
    <p class="sub" style="text-align:center;margin:24px auto 60px">Count down to your <b>next</b> meeting, or the time <b>left</b> in the one you're in right now.</p>
    <div class="keys" style="justify-content:center;gap:150px">
      ${col(keyCountdown({ ph: GREEN, time: "18:40", label: "NEXT", name: "Roadmap", frac: 0.31 }), 300, "NEXT — time until it starts")}
      ${col(keyCountdown({ ph: AMBER, time: "9:12", label: "NOW", name: "Sprint plan", frac: 0.4, reverse: true }), 300, "NOW — time left in the meeting")}
    </div>
  </div>`);

// 4) ONE-TAP JOIN
panels["04-join"] = page(`
  <div class="stage" style="flex-direction:row;align-items:center;gap:120px">
    <div style="flex:1">
      <h1>One tap<br>and you're <span class="accent">in.</span></h1>
      <p class="sub">Press the key for a quick "Join?" confirmation, then it opens the meeting's video link — Meet, Zoom, Teams, and more. No more digging through the invite.</p>
    </div>
    <div class="keys" style="flex:none">
      ${cap(keyCountdown({ ph: RED, time: "0:45", label: "NEXT", name: "Standup", frac: 0.02 }), 300)}
      <div style="font-size:80px;color:#5b6270">→</div>
      ${cap(keyConfirm("Standup"), 300)}
    </div>
  </div>`);

// 5) DIALS
panels["05-dials"] = page(`
  <div class="stage" style="align-items:center;text-align:center">
    <h1 style="font-size:70px">Made for Stream Deck + dials, too</h1>
    <p class="sub" style="text-align:center;margin:24px auto 56px">The touchscreen shows the same live countdown and draining border — push to join, turn to switch between overlapping meetings.</p>
    <div class="keys" style="justify-content:center;gap:70px">
      ${capW(dialCountdown({ ph: GREEN, time: "45:00", label: "NEXT", name: "Design review", frac: 0.75 }), 500)}
      ${capW(dialCountdown({ ph: RED, time: "3:25", label: "NEXT", name: "1:1 with Sam", frac: 0.06 }), 500)}
    </div>
  </div>`);

// 6) STATES / IDLE + ALERT
panels["06-states"] = page(`
  <div class="stage" style="align-items:center;text-align:center">
    <h1 style="font-size:70px">Clear at every moment</h1>
    <p class="sub" style="text-align:center;margin:24px auto 60px">A calm, legible state for whatever your calendar is doing.</p>
    <div class="keys" style="justify-content:center">
      ${col(keyIdle({ label: "NEXT", big: "No more", small: "meetings" }), 260, "Done for the day")}
      ${col(keyIdle({ label: "NOW", big: "Free" }), 260, "Between meetings")}
      ${col(keyCountdown({ ph: GREEN, time: "1h 5m", label: "NOW", name: "Offsite", frac: 0.9, reverse: true }), 260, "Long session, left to run")}
    </div>
  </div>`);

for (const [name, html] of Object.entries(panels)) {
  writeFileSync(`${OUT}/${name}.html`, html);
}
console.log(`Wrote ${Object.keys(panels).length} panels to ${OUT}`);
console.log(Object.keys(panels).join("\n"));
