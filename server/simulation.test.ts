import { describe, it, expect } from "vitest";
import { CampusPathfinder } from "./pathfinding";
import { simulateSpread } from "./agent/spread";

describe("pathfinder regressions", () => {
  it("reaches every exit incl. negative-coordinate ones, repeated searches never loop", () => {
    const pf = new CampusPathfinder();
    const origin = { x: 0, y: 20 };
    for (let round = 0; round < 3; round++) {
      for (const exit of pf.getSafeExits()) {
        const path = pf.findPath(origin, exit);
        expect(path.length).toBeGreaterThan(1);
        const last = path[path.length - 1];
        expect(Math.abs(last.x - exit.x)).toBeLessThanOrEqual(25);
        expect(Math.abs(last.y - exit.y)).toBeLessThanOrEqual(25);
      }
      // reverse direction reuses the same cells (stale parents used to create a cycle)
      expect(pf.findPath(pf.getSafeExits()[0], origin).length).toBeGreaterThan(1);
    }
  });

  it("start inside a blocked zone can still escape; compute4Routes gives real ETAs", () => {
    const pf = new CampusPathfinder();
    pf.updateBlockedZones([{ locationX: 0, locationY: 20, type: "fire", severity: "critical" }]);
    expect(pf.findPath({ x: 0, y: 20 }, { x: 250, y: 250 }).length).toBeGreaterThan(1);
    for (const r of new CampusPathfinder().compute4Routes(0, 20)) expect(r.eta_min).toBeGreaterThan(0);
  });
});

describe("compute4Routes", () => {
  it("low_crowd uses a different exit than fastest; accessible description states its real slope", () => {
    const r = Object.fromEntries(new CampusPathfinder().compute4Routes(0, 20).map((x) => [x.type, x]));
    const end = (t: string) => r[t].path[r[t].path.length - 1];
    expect(end("low_crowd")).not.toEqual(end("fastest"));
    expect(r.accessible.description).toMatch(/steepest segment \d+\.\d°/);
  });
});

describe("spread sim", () => {
  it("spreads downwind, survives bad input, stays bounded", () => {
    const r = simulateSpread(0, 20, { direction_deg: 0, speed_mps: 15 }, null, 10);
    expect(r.spread_direction).toBe("S");
    expect(r.heatmap.length).toBeGreaterThan(1);
    expect(r.evac_window_minutes).toBeGreaterThanOrEqual(1);
    const bad = simulateSpread(NaN, NaN, { direction_deg: -90, speed_mps: NaN }, null, NaN);
    expect(bad.heatmap.length).toBeGreaterThan(0);
    expect(bad.spread_direction).toBe("E"); // wind from W (-90 = 270) -> spreads E
  });
});
