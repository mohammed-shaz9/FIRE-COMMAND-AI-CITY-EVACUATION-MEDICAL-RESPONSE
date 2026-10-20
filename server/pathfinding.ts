/**
 * A* Pathfinding Algorithm for Campus Evacuation (PHYSICS-AWARE)
 * Finds the shortest safe path considering terrain elevation and slope gravity.
 */

interface GridCell {
  x: number;
  y: number;
  walkable: boolean;
  gCost: number;
  hCost: number;
  fCost: number;
  elevation: number;
  parent: GridCell | null;
}

interface Point {
  x: number;
  y: number;
}

export class CampusPathfinder {
  private gridSize = 10; // 10x10 grid
  private cellSize = 50; // 50 meters per cell
  private grid: GridCell[][] = [];
  private blockedZones: Array<{ x: number; y: number; radius: number }> = [];
  // World coords span -250..250 (exits sit at +-250); grid cell 0 starts at -250.
  private readonly origin = -250;

  private cellIdx(v: number): number {
    return Math.floor((v - this.origin) / this.cellSize);
  }

  private cellAt(p: Point): GridCell | undefined {
    const c = (v: number) => Math.min(this.gridSize - 1, Math.max(0, this.cellIdx(v)));
    return this.grid[c(p.x)]?.[c(p.y)];
  }

  constructor() {
    this.initializeGrid();
    this.applySyntheticTerrain();
  }

  private initializeGrid() {
    this.grid = [];
    for (let x = 0; x < this.gridSize; x++) {
      this.grid[x] = [];
      for (let y = 0; y < this.gridSize; y++) {
        this.grid[x][y] = {
          x,
          y,
          walkable: true,
          gCost: 0,
          hCost: 0,
          fCost: 0,
          elevation: 0, // Ground level by default
          parent: null,
        };
      }
    }
  }

  /**
   * Generates synthetic sloping terrain map matching the "Hillside" demo
   */
  private applySyntheticTerrain() {
    // Top of the hill (Science block coordinates ~100) -> elevation 40
    // Bottom of the hill (Engineering block ~0) -> elevation 0
    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        // Simple linear interpolation: (x+y) / 2 mapped onto a 0-40 height slope
        this.grid[x][y].elevation = ((x + y) / (this.gridSize * 2 - 2)) * 40;
      }
    }
  }

  public updateBlockedZones(incidents: Array<{ locationX: number; locationY: number; type: string; severity: string }>) {
    this.blockedZones = [];
    this.initializeGrid(); // Reset costs
    this.applySyntheticTerrain(); // Restore elevations

    for (const incident of incidents) {
      let radius = 2; // Default radius in cells

      if (incident.type === "fire") {
        radius = incident.severity === "critical" ? 3 : 2;
      } else if (incident.type === "flood") {
        radius = incident.severity === "critical" ? 4 : 3;
      } else if (incident.type === "earthquake") {
        radius = 5;
      }

      this.blockedZones.push({
        x: incident.locationX,
        y: incident.locationY,
        radius,
      });

      const cellX = this.cellIdx(incident.locationX);
      const cellY = this.cellIdx(incident.locationY);

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const nx = cellX + dx;
          const ny = cellY + dy;

          if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= radius) {
              this.grid[nx][ny].walkable = false;
            }
          }
        }
      }
    }
  }

  /**
   * Physics-Aware Math
   */
  private calculateSlope(a: GridCell, b: GridCell): number {
    const dist = this.distance(a, b) * this.cellSize;
    const heightDiff = b.elevation - a.elevation;
    if (dist === 0) return 0;
    // Return angle in degrees
    return Math.atan(heightDiff / dist) * (180 / Math.PI);
  }

  private calculateMovementSpeed(slopeDegrees: number): number {
    const baseSpeed = 1.4; // m/s
    if (slopeDegrees > 10) return baseSpeed * 0.50;  // Steep uphill
    if (slopeDegrees > 5) return baseSpeed * 0.71;   // Uphill
    if (slopeDegrees >= -5 && slopeDegrees <= 5) return baseSpeed; // Flat
    if (slopeDegrees < -10) return baseSpeed * 1.43; // Steep downhill
    if (slopeDegrees < -5) return baseSpeed * 1.14;  // Downhill
    return baseSpeed;
  }

  public findPath(start: Point, goal: Point): Point[] {
    const startCell = this.cellAt(start);
    const goalCell = this.cellAt(goal);

    if (!startCell || !goalCell || !goalCell.walkable) {
      return [start]; 
    }

    // Reset per-search state (cells are shared; stale parents caused cyclic paths / infinite loops)
    for (const row of this.grid) for (const c of row) { c.parent = null; c.gCost = 0; c.hCost = 0; c.fCost = 0; }

    const openSet: GridCell[] = [startCell];
    const closedSet: Set<GridCell> = new Set();

    startCell.gCost = 0;
    startCell.hCost = this.heuristic(startCell, goalCell);
    startCell.fCost = startCell.hCost;

    const GRAVITY_FACTOR = 0.5;
    const BLOCKED_PENALTY_S = 1000;

    while (openSet.length > 0) {
      let current = openSet[0];
      let currentIndex = 0;

      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].fCost < current.fCost) {
          current = openSet[i];
          currentIndex = i;
        }
      }

      if (current === goalCell) {
        return this.reconstructPath(current);
      }

      openSet.splice(currentIndex, 1);
      closedSet.add(current);

      const neighbors = this.getNeighbors(current);

      for (const neighbor of neighbors) {
        if (closedSet.has(neighbor)) {
          continue;
        }

        const slope = this.calculateSlope(current, neighbor);
        const movementSpeed = this.calculateMovementSpeed(slope);
        const physicalDistance = this.distance(current, neighbor) * this.cellSize;
        const traversalTime = physicalDistance / movementSpeed;
        
        // Penalize climbing
        const elevationCost = Math.abs(neighbor.elevation - current.elevation) * GRAVITY_FACTOR;
        
        // ponytail: blocked cells are a heavy penalty, not a wall, so a start inside the hazard can still escape
        const tentativeGCost = current.gCost + traversalTime + elevationCost + (neighbor.walkable ? 0 : BLOCKED_PENALTY_S);

        if (!openSet.includes(neighbor)) {
          openSet.push(neighbor);
        } else if (tentativeGCost >= neighbor.gCost) {
          continue;
        }

        neighbor.parent = current;
        neighbor.gCost = tentativeGCost;
        neighbor.hCost = this.heuristic(neighbor, goalCell);
        neighbor.fCost = neighbor.gCost + neighbor.hCost;
      }
    }

    return [start];
  }

  private getNeighbors(cell: GridCell): GridCell[] {
    const neighbors: GridCell[] = [];
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1],
    ];

    for (const [dx, dy] of directions) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;

      if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
        neighbors.push(this.grid[nx][ny]);
      }
    }
    return neighbors;
  }

  private heuristic(a: GridCell, b: GridCell): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.elevation - b.elevation);
  }

  private distance(a: GridCell, b: GridCell): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private reconstructPath(cell: GridCell): Point[] {
    const path: Point[] = [];
    let current: GridCell | null = cell;

    while (current !== null) {
      path.unshift({
        x: current.x * this.cellSize + this.cellSize / 2 + this.origin,
        y: current.y * this.cellSize + this.cellSize / 2 + this.origin,
      });
      current = current.parent;
    }

    return path;
  }

  /** Seconds to walk `pathLengthMeters` on flat ground. */
  public calculateEvacuationTime(pathLengthMeters: number): number {
    return pathLengthMeters / 1.4;
  }

  public getSafeExits(): Point[] {
    return [
      { x: 250, y: 250 },   // North Assembly
      { x: -250, y: 250 },  // West Assembly
      { x: 250, y: -250 },  // East Assembly
      { x: -250, y: -250 }, // South Assembly
    ];
  }

  /**
   * FireCommand: Compute 4 typed evacuation routes
   */
  public compute4Routes(
    originX: number,
    originY: number,
    heatmap?: Array<{ x: number; y: number; intensity: number }>
  ): Array<{ type: string; eta_min: number; path: Point[]; description: string }> {
    const origin = { x: originX, y: originY };
    // One A* per exit; every route type below is a different pick over the same candidates.
    const cands = this.getSafeExits().map((exit) => {
      const path = this.findPath(origin, exit);
      return { exit, path, time: this.estimatePathTime(path), maxSlope: this.maxAbsSlope(path) };
    });
    type Cand = (typeof cands)[number];
    const reachable = cands.filter((c) => c.path.length >= 2);
    const pick = (list: Cand[]): Cand | undefined => [...list].sort((a, b) => a.time - b.time)[0];
    const none: Cand = { exit: cands[0].exit, path: [origin], time: Infinity, maxSlope: 0 };

    // 1. FASTEST: shortest time to any exit
    const fastest = pick(reachable) ?? none;

    // 2. SAFEST: highest mean clearance from the predicted fire heatmap
    let safest = fastest;
    if (heatmap && heatmap.length > 0) {
      let maxSafety = -Infinity;
      for (const c of reachable) {
        let safety = 0;
        for (const p of c.path) {
          let minDist = Infinity;
          for (const h of heatmap) minDist = Math.min(minDist, Math.hypot(p.x - h.x, p.y - h.y));
          safety += minDist;
        }
        safety /= c.path.length; // mean clearance, so longer paths aren't favoured just for having more points
        if (safety > maxSafety) { maxSafety = safety; safest = c; }
      }
    }

    // 3. ACCESSIBLE: gentlest steepest segment, ties broken by time. Slower pace (x1.3).
    const accessible = [...reachable].sort((a, b) => a.maxSlope - b.maxSlope || a.time - b.time)[0] ?? none;

    // 4. LOW CROWD: fastest exit that the other three routes are NOT already sending people to.
    const used = new Set([fastest, safest, accessible].map((c) => c.exit));
    const lowCrowd = pick(reachable.filter((c) => !used.has(c.exit))) ?? pick(reachable.filter((c) => c.exit !== fastest.exit)) ?? fastest;

    const eta = (t: number) => (Number.isFinite(t) ? Math.max(1, Math.ceil(t / 60)) : 0); // 0 = no route found
    const slopeNote = (c: Cand) => `steepest segment ${c.maxSlope.toFixed(1)}°${c.maxSlope <= 5 ? ", wheelchair passable" : ", exceeds 5° wheelchair limit"}`;
    return [
      { type: 'fastest', eta_min: eta(fastest.time), path: fastest.path, description: `Direct route to Exit (${fastest.exit.x}, ${fastest.exit.y}) via shortest corridor` },
      { type: 'safest', eta_min: eta(safest.time), path: safest.path, description: `Route avoiding predicted fire spread zone` },
      { type: 'accessible', eta_min: eta(accessible.time * 1.3), path: accessible.path, description: `Gentlest-grade route to Exit (${accessible.exit.x}, ${accessible.exit.y}): ${slopeNote(accessible)}` },
      { type: 'low_crowd', eta_min: eta(lowCrowd.time), path: lowCrowd.path, description: `Least congested: Exit (${lowCrowd.exit.x}, ${lowCrowd.exit.y}) is not used by the other routes when possible` },
    ];
  }

  private maxAbsSlope(path: Point[]): number {
    let m = 0;
    for (let i = 1; i < path.length; i++) {
      const a = this.cellAt(path[i - 1]), b = this.cellAt(path[i]);
      if (a && b) m = Math.max(m, Math.abs(this.calculateSlope(a, b)));
    }
    return m;
  }

  private estimatePathTime(path: Point[]): number {
    if (path.length < 2) return Infinity; // findPath returns [start] when no route exists
    let totalSeconds = 0;
    for (let i = 1; i < path.length; i++) {
      const cellA = this.cellAt(path[i - 1]);
      const cellB = this.cellAt(path[i]);
      if (cellA && cellB) {
        const dist = this.distance(cellA, cellB) * this.cellSize;
        const slope = this.calculateSlope(cellA, cellB);
        totalSeconds += dist / this.calculateMovementSpeed(slope);
      }
    }
    return totalSeconds;
  }

  public calculateAllEvacuationRoutes(
    buildings: Array<{ name: string; x: number; y: number }>,
    incidents: Array<{ locationX: number; locationY: number; type: string; severity: string }>
  ) {
    this.updateBlockedZones(incidents);

    const routes = [];
    const exits = this.getSafeExits();

    // Find the building closest to the incident or specifically requested
    const distressedBuilding = buildings.find(b => 
      incidents.some(i => Math.sqrt(Math.pow(b.x - i.locationX, 2) + Math.pow(b.y - i.locationY, 2)) < 100)
    ) || buildings[0];

    // SDG 11: Calculate exactly 4 evacuation routes for the building in distress
    for (const exit of exits) {
      const path = this.findPath(
        { x: distressedBuilding.x, y: distressedBuilding.y },
        exit
      );

      const timeSeconds = this.estimatePathTime(path);

      routes.push({
        building: distressedBuilding.name,
        exit: `Exit (${exit.x}, ${exit.y})`,
        path,
        timeSeconds: Number.isFinite(timeSeconds) ? Math.ceil(timeSeconds) : 0,
        priority: exit === exits[0] ? "primary" : "secondary"
      });
    }

    // Still include basic routes for other buildings
    for (const building of buildings) {
      if (building.name === distressedBuilding.name) continue;
      
      let closestExit = exits[0];
      let closestDistance = Infinity;

      for (const exit of exits) {
        const distance = Math.sqrt(
          Math.pow(building.x - exit.x, 2) + Math.pow(building.y - exit.y, 2)
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestExit = exit;
        }
      }

      const path = this.findPath(
        { x: building.x, y: building.y },
        closestExit
      );

      routes.push({
        building: building.name,
        exit: `Exit (${closestExit.x}, ${closestExit.y})`,
        path,
        timeSeconds: 300, // Fixed placeholder for non-distressed
      });
    }

    return routes;
  }
}

export const pathfinder = new CampusPathfinder();
