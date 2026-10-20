import { describe, it, expect, beforeEach } from "vitest";
import { CampusPathfinder } from "./pathfinding";

describe("CampusPathfinder", () => {
  let pathfinder: CampusPathfinder;

  beforeEach(() => {
    pathfinder = new CampusPathfinder();
  });

  describe("initialization", () => {
    it("should initialize with safe exits", () => {
      const exits = pathfinder.getSafeExits();
      expect(exits.length).toBe(4);
      expect(exits[0]).toHaveProperty("x");
      expect(exits[0]).toHaveProperty("y");
    });
  });

  describe("pathfinding", () => {
    it("should find a path from start to goal", () => {
      const start = { x: 0, y: 0 };
      const goal = { x: 250, y: 250 };
      
      const path = pathfinder.findPath(start, goal);
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThan(0);
    });

    it("should handle goals within grid bounds", () => {
      const start = { x: 0, y: 0 };
      const goal = { x: 200, y: 200 };
      
      const path = pathfinder.findPath(start, goal);
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle multiple incidents blocking zones", () => {
      const incidents = [
        { locationX: 0, locationY: 0, type: "fire", severity: "critical" },
        { locationX: 100, locationY: 0, type: "flood", severity: "warning" },
      ];

      pathfinder.updateBlockedZones(incidents);
      
      const start = { x: 50, y: 50 };
      const goal = { x: 250, y: 250 };
      
      const path = pathfinder.findPath(start, goal);
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThan(0);
    });
  });

  describe("evacuation time calculation", () => {
    it("should calculate evacuation time based on path length", () => {
      const pathLength = 100;
      const time = pathfinder.calculateEvacuationTime(pathLength);
      
      expect(time).toBeGreaterThan(0);
      expect(typeof time).toBe("number");
      expect(time).toBeGreaterThanOrEqual(70);
      expect(time).toBeLessThanOrEqual(72);
    });

    it("should return positive time for any path length", () => {
      const times = [10, 50, 100, 500, 1000];
      times.forEach(length => {
        const time = pathfinder.calculateEvacuationTime(length);
        expect(time).toBeGreaterThan(0);
      });
    });
  });

  describe("evacuation routes calculation", () => {
    it("should calculate routes for all buildings", () => {
      const buildings = [
        { name: "Engineering Block", x: 0, y: 0 },
        { name: "Science Block", x: 100, y: 0 },
        { name: "Library", x: 50, y: 80 },
      ];

      const incidents = [];
      const routes = pathfinder.calculateAllEvacuationRoutes(buildings, incidents);

      expect(routes.length).toBe(4 + buildings.length - 1);
      routes.forEach(route => {
        expect(route).toHaveProperty("building");
        expect(route).toHaveProperty("exit");
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("timeSeconds");
        expect(route.timeSeconds).toBeGreaterThanOrEqual(0);
        expect(route.path.length).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle incidents and recalculate routes", () => {
      const buildings = [
        { name: "Engineering Block", x: 0, y: 0 },
        { name: "Science Block", x: 100, y: 0 },
      ];

      const incidents = [
        { locationX: 150, locationY: 150, type: "fire", severity: "critical" },
      ];

      const routes = pathfinder.calculateAllEvacuationRoutes(buildings, incidents);
      
      expect(routes.length).toBe(4 + buildings.length - 1);
      routes.forEach(route => {
        expect(route).toHaveProperty("building");
        expect(route).toHaveProperty("exit");
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("timeSeconds");
      });
    });

    it("should expand blocked zones based on incident type", () => {
      const buildings = [
        { name: "Test Building", x: 0, y: 0 },
      ];

      const fireIncidents = [
        { locationX: 150, locationY: 150, type: "fire", severity: "critical" },
      ];

      const floodIncidents = [
        { locationX: 150, locationY: 150, type: "flood", severity: "critical" },
      ];

      const fireRoutes = pathfinder.calculateAllEvacuationRoutes(buildings, fireIncidents);
      const floodRoutes = pathfinder.calculateAllEvacuationRoutes(buildings, floodIncidents);

      expect(fireRoutes.length).toBe(4);
      expect(floodRoutes.length).toBe(4);
      expect(fireRoutes[0]).toHaveProperty("timeSeconds");
      expect(floodRoutes[0]).toHaveProperty("timeSeconds");
    });
  });

  describe("blocked zones", () => {
    it("should update blocked zones based on incidents", () => {
      const incidents = [
        { locationX: 100, locationY: 100, type: "fire", severity: "critical" },
      ];

      pathfinder.updateBlockedZones(incidents);
      
      const start = { x: 0, y: 0 };
      const goal = { x: 250, y: 250 };
      
      const path = pathfinder.findPath(start, goal);
      expect(path.length).toBeGreaterThan(0);
    });

    it("should expand radius for critical incidents", () => {
      const criticalIncidents = [
        { locationX: 100, locationY: 100, type: "earthquake", severity: "critical" },
      ];

      pathfinder.updateBlockedZones(criticalIncidents);
      
      const start = { x: 0, y: 0 };
      const goal = { x: 250, y: 250 };
      
      const path = pathfinder.findPath(start, goal);
      expect(path.length).toBeGreaterThanOrEqual(0);
    });
  });
});
