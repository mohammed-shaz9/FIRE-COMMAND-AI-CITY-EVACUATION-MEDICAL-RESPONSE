import { describe, it, expect, beforeEach } from "vitest";
import { emergencyRouter } from "./emergency";
import { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";

// Mock context
function createMockContext(): TrpcContext {
  const user: User = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as any,
    res: {} as any,
  };
}

describe("Emergency Router", () => {
  let caller: any;

  beforeEach(() => {
    const ctx = createMockContext();
    caller = emergencyRouter.createCaller(ctx);
  });

  describe("getActiveIncidents", () => {
    it("should return an empty array initially", async () => {
      const incidents = await caller.getActiveIncidents();
      expect(Array.isArray(incidents)).toBe(true);
    });
  });

  describe("getCampusZones", () => {
    it("should return campus zones with correct structure", async () => {
      const zones = await caller.getCampusZones();
      expect(Array.isArray(zones)).toBe(true);
      
      if (zones.length > 0) {
        const zone = zones[0];
        expect(zone).toHaveProperty("id");
        expect(zone).toHaveProperty("x");
        expect(zone).toHaveProperty("y");
        expect(zone).toHaveProperty("name");
        expect(zone).toHaveProperty("severity");
      }
    });
  });

  describe("getHeatmap", () => {
    it("should return heatmap data with zone severity", async () => {
      const heatmap = await caller.getHeatmap();
      expect(Array.isArray(heatmap)).toBe(true);
      
      if (heatmap.length > 0) {
        const zone = heatmap[0];
        expect(zone).toHaveProperty("id");
        expect(zone).toHaveProperty("x");
        expect(zone).toHaveProperty("y");
        expect(zone).toHaveProperty("severity");
        expect(["info", "warning", "critical"]).toContain(zone.severity);
      }
    });
  });

  describe("calculateEvacuationRoutes", () => {
    it("should calculate routes for given buildings", async () => {
      const buildings = [
        { name: "Engineering Block", x: 0, y: 0 },
        { name: "Science Block", x: 100, y: 0 },
      ];

      const routes = await caller.calculateEvacuationRoutes({ buildings });
      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBe(4 + buildings.length - 1);

      routes.forEach((route: any) => {
        expect(route).toHaveProperty("building");
        expect(route).toHaveProperty("exit");
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("timeSeconds");
        expect(Array.isArray(route.path)).toBe(true);
        expect(route.timeSeconds).toBeGreaterThan(0);
      });
    });

    it("should return paths with waypoints", async () => {
      const buildings = [
        { name: "Library", x: 50, y: 80 },
      ];

      const routes = await caller.calculateEvacuationRoutes({ buildings });
      expect(routes.length).toBe(4);
      
      const route = routes[0];
      expect(route.path.length).toBeGreaterThan(0);
      
      route.path.forEach((waypoint: any) => {
        expect(waypoint).toHaveProperty("x");
        expect(waypoint).toHaveProperty("y");
        expect(typeof waypoint.x).toBe("number");
        expect(typeof waypoint.y).toBe("number");
      });
    });
  });

  describe("getZoneSeverity", () => {
    it("should return severity for a zone", async () => {
      const result = await caller.getZoneSeverity({ zoneId: 1 });
      expect(result).toHaveProperty("severity");
      expect(["info", "warning", "critical"]).toContain(result.severity);
    });
  });
});
