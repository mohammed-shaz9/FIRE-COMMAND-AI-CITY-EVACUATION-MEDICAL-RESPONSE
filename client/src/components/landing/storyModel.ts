// Pure model for ScrollStory: floor plan, deterministic fire spread, routes, timeline.
// Everything is a function of scroll progress p in [0,1] -> scrubbing backwards just works.

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};

// ---------- floor plan (viewBox 800x500, 20px cells, 36x21) ----------
const COLS = 36;
const X0 = 40;
const Y0 = 40;
const CELL = 20;
const DOOR_COLS = new Set([3, 4, 12, 13, 21, 22, 30, 31]);
const ORIGIN = { c: 22, r: 3 };
export const SENSOR = { x: X0 + ORIGIN.c * CELL + 10, y: Y0 + ORIGIN.r * CELL + 10 };

export const ROOMS = [
  "WARD A", "LAB B", "LAB C", "STORES",
  "OFFICES", "CAFE", "LECTURE", "LIBRARY",
].map((label, i) => ({ label, x: X0 + (i % 4) * 180, y: i < 4 ? 40 : 300 }));

// Walls with doorway gaps (corridor doors + room-to-room doors).
export const WALLS = (() => {
  const s: string[] = [];
  for (const y of [200, 300]) {
    let x = 40;
    for (let i = 0; i < 4; i++) {
      const d = 100 + 180 * i;
      s.push(`M${x} ${y}H${d}`);
      x = d + 40;
    }
    s.push(`M${x} ${y}H760`);
  }
  for (const x of [220, 400, 580]) s.push(`M${x} 40V100M${x} 140V200M${x} 300V360M${x} 400V460`);
  return s.join("");
})();

// Cells fire may occupy (kept clear of the evacuation lanes by design).
const allowed = (c: number, r: number) =>
  (r >= 0 && r < 8 && c >= 15 && c <= 28) || (r >= 8 && r <= 10 && c >= 16 && c <= 28);

const hash = (c: number, r: number) => {
  const x = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Does stepping between two adjacent cells cross a wall (not a doorway)?
const wall = (c1: number, r1: number, c2: number, r2: number) => {
  if (r1 === r2) {
    const L = Math.max(c1, c2);
    const rooms = r1 < 8 || r1 >= 13;
    const door = r1 < 8 ? r1 === 3 || r1 === 4 : r1 === 16 || r1 === 17;
    return rooms && L % 9 === 0 && !door;
  }
  const L = Math.max(r1, r2);
  return (L === 8 || L === 13) && !DOOR_COLS.has(c1);
};

export const CELLS = (() => {
  const dist = new Map<number, number>([[ORIGIN.r * COLS + ORIGIN.c, 0]]);
  const q = [ORIGIN];
  for (let i = 0; i < q.length; i++) {
    const { c, r } = q[i];
    const d = dist.get(r * COLS + c)!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!allowed(nc, nr) || wall(c, r, nc, nr)) continue;
      const nd = d + 1 + 0.9 * hash(nc, nr);
      const k = nr * COLS + nc;
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        q.push({ c: nc, r: nr });
      }
    }
  }
  const max = Math.max(...dist.values());
  return [...dist.entries()]
    .map(([k, d]) => ({
      x: X0 + (k % COLS) * CELL,
      y: Y0 + Math.floor(k / COLS) * CELL,
      t: d / max, // normalised ignition time
      d: +(hash(k, 7) * 0.9).toFixed(2), // flicker delay (s)
    }))
    .sort((a, b) => a.t - b.t);
})();

export const ENVELOPE = (() => {
  const xs = CELLS.map((c) => c.x), ys = CELLS.map((c) => c.y);
  const x = Math.min(...xs) - 8, y = Math.min(...ys) - 8;
  return { x, y, w: Math.max(...xs) + CELL + 8 - x, h: Math.max(...ys) + CELL + 8 - y };
})();

// ---------- routes ----------
// Index order = draw order. Last two segments of each end at an exit (x=28 west / x=772 east).
export const ROUTES = [
  "M130 110L120 190Q120 250 80 250L28 250", // ward A -> W
  "M300 120L300 190Q300 250 250 250L28 250", // lab B -> W (hugs corridor, away from fire)
  "M130 400L120 310Q120 250 80 250L28 250", // offices -> W
  "M300 390L300 314Q300 288 272 288L140 288Q112 288 108 262Q106 250 84 250L28 250", // cafe -> W
  "M660 110L660 190Q660 250 700 250L772 250", // stores -> E
  "M480 400L480 314Q480 286 508 286L690 286C722 286 730 250 760 250L772 250", // lecture -> E, under fire
  "M660 400L660 314Q660 286 688 286C722 286 730 250 760 250L772 250", // library -> E
];
export const DOTS = ROUTES.flatMap((_, r) =>
  [0, 1].map((j) => ({ r, j, d: ((r * 3 + j * 5) % 7) * 0.05 })),
);

// ---------- timeline ----------
export const STEP_AT = [0, 0.16, 0.38, 0.6, 0.85, 1];
export const STEPS = [
  { tag: "Detect", title: "A spark becomes a signal.", body: "Heat and smoke sensors in Lab C cross their threshold. Three nodes agree within seconds, so the alert fires before anyone smells smoke." },
  { tag: "Spread", title: "Fire spreads, cell by cell.", body: "Open doors and corridors feed the flames. The model tracks every cell of the floor plan as heat moves from room to room." },
  { tag: "Decide", title: "Four agents, one decision.", body: "Monitor confirms, Predict forecasts the front, Decide picks the safest exits, Evacuate pushes routes to every phone and PA speaker." },
  { tag: "Route", title: "Safe routes draw themselves.", body: "Paths bend around the fire and the predicted spread zone. People move while the corridor is still passable." },
  { tag: "Clear", title: "All clear.", body: "Every occupant accounted for at an exit. Minutes saved versus an unassisted evacuation." },
];
export const AGENTS = [
  { name: "Monitor", at: 0.03, to: 0.13, log: "3 sensors agree: fire in Lab C" },
  { name: "Predict", at: 0.2, to: 0.34, log: "front hits corridor in ~90 s" },
  { name: "Decide", at: 0.4, to: 0.52, log: "open exits W+E, seal corridor C" },
  { name: "Evacuate", at: 0.56, to: 0.66, log: "routes sent to 700 phones + PA" },
];
export const ROUTE_AT = 0.6, ROUTE_GAP = 0.012, ROUTE_DUR = 0.09;
export const EVAC_AT = 0.64, EVAC_SPAN = 0.22, EVAC_STAGGER = 0.35; // dots done at AT+SPAN
export const TOTAL = 700, ETA_SAVED_S = 252;

export const fireAt = (p: number) => smooth((p - 0.07) / 0.59);
export const routeDraw = (p: number, i: number) => clamp((p - ROUTE_AT - i * ROUTE_GAP) / ROUTE_DUR);
export const dotT = (p: number, d: number) => clamp(((p - EVAC_AT) / EVAC_SPAN) * (1 + EVAC_STAGGER) - d);
export const stepOf = (p: number) => STEP_AT.slice(0, 5).reduce((s, a, i) => (p >= a ? i : s), 0);
// 0..4 position along the rail (node-aligned, not p-aligned)
export const railAt = (p: number) => {
  const i = stepOf(p);
  return Math.min(1, (i + clamp((p - STEP_AT[i]) / (STEP_AT[i + 1] - STEP_AT[i]))) / 4);
};

/** 0 hidden, 1 igniting, 2 burning front, 3 hot core */
export const cellState = (fq: number, t: number) => {
  const u = (fq / 120) * 1.15 - t;
  return u <= 0 ? 0 : u < 0.05 ? 1 : u < 0.4 ? 2 : 3;
};

export type Snap = {
  key: string; step: number; fq: number; lit: number; temp: number;
  chars: number[]; evac: number; eta: number;
};

/** Everything React needs, quantised so a scroll frame re-renders only when something visible changed. */
export function derive(p: number): Snap {
  const F = fireAt(p);
  const fq = Math.round(F * 120);
  const lit = CELLS.reduce((n, c) => n + (cellState(fq, c.t) > 0 ? 1 : 0), 0);
  const temp = Math.round(24 + 63 * clamp(p / 0.14) + 260 * F);
  const chars = AGENTS.map((a) => Math.round(a.log.length * clamp((p - a.at) / (a.to - a.at))));
  const evac = Math.round(clamp((p - EVAC_AT) / 0.21) * 100) * 7;
  const eta = Math.round(ETA_SAVED_S * clamp((p - 0.86) / 0.1));
  const step = stepOf(p);
  return { key: [step, fq, temp, chars.join(), evac, eta].join("|"), step, fq, lit, temp, chars, evac, eta };
}
