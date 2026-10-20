/**
 * SpreadPredictor Agent — Cellular Automata Fire Spread Simulation
 * Factors: wind direction/speed, terrain slope, barriers
 * SDG 13: Climate Action — physics-based spread prediction
 */

export interface WindData {
  direction_deg: number; // 0=N, 90=E, 180=S, 270=W
  speed_mps: number;
}

export interface SpreadCell {
  x: number;
  y: number;
  intensity: number; // 0-1
  timeToReach: number; // seconds
}

export interface SpreadResult {
  spread_direction: string;
  evac_window_minutes: number;
  heatmap: SpreadCell[];
  grid: number[][]; // 60x60 intensity grid
}

const GRID_SIZE = 60;
const CELL_SIZE_M = 5; // 5 meters per cell = 300m campus

// Direction labels from degrees (normalised so negative / >=360 / NaN inputs can't index out of range)
function degToLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const d = Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0;
  return dirs[Math.round(d / 45) % 8];
}

// Opposite direction (where fire spreads TO)
function oppositeDir(deg: number): string {
  return degToLabel((Number.isFinite(deg) ? deg : 0) + 180);
}

// Barrier zones (roads, open ground) — hardcoded for MRUH campus. Precomputed once.
const BARRIER: Uint8Array = (() => {
  const barriers = [
    { x: 30, y: 20, r: 3 }, // Main road
    { x: 30, y: 40, r: 3 }, // Secondary road
  ];
  const m = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let x = 0; x < GRID_SIZE; x++)
    for (let y = 0; y < GRID_SIZE; y++)
      if (barriers.some(b => Math.hypot(x - b.x, y - b.y) < b.r)) m[x * GRID_SIZE + y] = 1;
  return m;
})();

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Run a cellular automata fire spread for T steps.
 * Wind pushes fire in opposite direction.
 * Returns heatmap + evacuation window.
 */
export function simulateSpread(
  ignitionX: number,
  ignitionY: number,
  wind: WindData,
  terrain: number[][] | null, // elevation grid, optional
  steps: number = 20 // each step = ~1 minute
): SpreadResult {
  const N = GRID_SIZE;
  const windDeg = num(wind?.direction_deg, 0);
  const windSpeed = Math.max(0, num(wind?.speed_mps, 0));
  steps = Math.min(200, Math.max(0, Math.floor(num(steps, 20))));

  // Flat double buffers (no per-step allocation)
  let cur = new Float64Array(N * N);
  let next = new Float64Array(N * N);
  const timeGrid = new Int16Array(N * N).fill(-1);

  // Map world coords to grid coords
  const clampCell = (v: number) => Math.min(N - 1, Math.max(0, Math.floor((num(v, 0) + 150) / CELL_SIZE_M)));
  const cx = clampCell(ignitionX);
  const cy = clampCell(ignitionY);

  // Ignite origin
  cur[cx * N + cy] = 1.0;
  timeGrid[cx * N + cy] = 0;

  // Wind vector (wind blows FROM direction_deg, fire spreads OPPOSITE)
  const windRad = ((windDeg + 180) % 360) * (Math.PI / 180);
  const windDx = Math.sin(windRad) * (windSpeed / 10); // normalized
  const windDy = -Math.cos(windRad) * (windSpeed / 10);

  // Per-direction base rate (wind boosts downwind, reduces upwind) — constant across cells
  const DX = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DY = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dirRate = DX.map((dx, i) => 0.15 + (dx * windDx + DY[i] * windDy) * 0.25);
  const dirMul = DX.map((dx, i) => (dx !== 0 && DY[i] !== 0 ? 0.7 : 1)); // diagonal penalty

  for (let t = 1; t <= steps; t++) {
    next.set(cur);

    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const i = x * N + y;
        const src = cur[i];
        if (src < 0.1) continue; // Not burning
        if (BARRIER[i]) continue;

        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const j = nx * N + ny;
          if (BARRIER[j]) continue;

          let rate = dirRate[d];
          // Slope factor (fire spreads faster uphill)
          if (terrain) rate += Math.max(0, ((terrain[nx]?.[ny] ?? 0) - (terrain[x]?.[y] ?? 0)) * 0.02);
          rate = Math.max(0, Math.min(1, rate * dirMul[d]));

          const v = Math.min(1, next[j] + src * rate);
          if (v > next[j]) {
            next[j] = v;
            if (timeGrid[j] < 0) timeGrid[j] = t;
          }
        }
      }
    }
    [cur, next] = [next, cur];
  }

  const grid: number[][] = Array.from({ length: N }, (_, x) => Array.from(cur.subarray(x * N, (x + 1) * N)));

  // Build heatmap cells (only cells with intensity > 0.05)
  const heatmap: SpreadCell[] = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (grid[x][y] > 0.05) {
        heatmap.push({
          x: x * CELL_SIZE_M - 150,
          y: y * CELL_SIZE_M - 150,
          intensity: Math.round(grid[x][y] * 100) / 100,
          timeToReach: timeGrid[x * GRID_SIZE + y] >= 0 ? timeGrid[x * GRID_SIZE + y] * 60 : -1, // seconds
        });
      }
    }
  }

  // Evacuation window: time until fire reaches any main corridor (y=25-35 band)
  let evacWindowSteps = steps;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 25; y <= 35; y++) {
      const tg = timeGrid[x * GRID_SIZE + y];
      if (tg > 0 && tg < evacWindowSteps) {
        evacWindowSteps = tg;
      }
    }
  }

  return {
    spread_direction: oppositeDir(windDeg),
    evac_window_minutes: Math.max(1, evacWindowSteps),
    heatmap,
    grid,
  };
}
