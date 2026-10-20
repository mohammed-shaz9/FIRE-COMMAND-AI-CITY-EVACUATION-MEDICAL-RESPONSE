/**
 * STATLESS DATABASE LAYER (In-Memory for Hackathon)
 * Replaces MySQL/SQL requirements with local memory for ultra-fast demo deployment.
 */

export interface Incident {
  id: number;
  type: "fire" | "flood" | "earthquake" | "medical" | "other";
  severity: "critical" | "warning" | "info";
  locationX: number;
  locationY: number;
  locationZ: number;
  buildingName?: string;
  description?: string;
  windDirection?: string;
  windSpeed?: number;
  predictedSpread?: string;
  resolvedAt?: Date | null;
  createdAt: Date;
}

export interface VulnerablePerson {
  id: number;
  name: string;
  type: "elderly" | "mobility_impaired" | "pregnant" | "respiratory";
  locationBuilding: string;
  locationX: number;
  locationY: number;
  vitalSigns?: string;
  status: "safe" | "at_risk" | "evacuating" | "evacuated";
  createdAt: Date;
}

export interface Resource {
  id: number;
  name: string;
  type: "ambulance" | "fire_truck" | "medical_kit" | "security";
  status: "available" | "deployed" | "maintenance";
  locationX: number;
  locationY: number;
  createdAt: Date;
}

// ============ FIRECOMMAND STATE ============

export interface FireCommandState {
  incident_summary: {
    confirmed: boolean;
    location: { zone: string; lat: number; lng: number };
    confidence: number;
  };
  predictions: {
    wind: { direction: string; speed_mps: number; direction_deg: number };
    spread_direction: string;
    evac_window_minutes: number;
  };
  evacuation: {
    population_total: number;
    vulnerable_total: number;
    evacuated_count: number;
    routes: Array<{ type: string; eta_min: number; description: string }>;
  };
  resources: {
    ambulances_dispatched: Array<{ id: number; name: string; target_zone: string; eta_minutes: number; status: string }>;
    medical_teams_dispatched: Array<{ id: number; name: string; target_zone: string; status: string }>;
    fire_response: Array<{ id: number; name: string; status: string }>;
  };
  broadcast: {
    message: string;
    target_count: number;
    sent_count: number;
    seen_count: number;
    channels: string[];
  };
  health_ops: {
    triage_summary: { green: number; yellow: number; red: number };
  };
  sdg_scores: {
    sdg11: number;
    sdg13: number;
    sdg03: number;
    combined: number;
  };
  counterfactuals: {
    traditional_time_min: number;
    traditional_casualties: number;
    traditional_detection_delay_min: number;
  };
  agent_log: Array<{
    agent: string;
    phase: string;
    reasoning: string;
    timestamp: number;
    duration_ms?: number;
  }>;
  success_metrics: {
    evacuated_count: number;
    time_minutes: number;
    casualties: number;
    vulnerable_prioritized: boolean;
  };
  timer_seconds: number;
  phase: 'IDLE' | 'DETECTING' | 'SPREADING' | 'ROUTING' | 'DISPATCHING' | 'BROADCASTING' | 'MONITORING' | 'COMPLETE';
}

let _fireCommandState: FireCommandState | null = null;

export function getFireCommandState(): FireCommandState | null {
  return _fireCommandState;
}

export function setFireCommandState(state: FireCommandState) {
  _fireCommandState = state;
}

export function clearFireCommandState() {
  _fireCommandState = null;
}

// In-Memory Cache
const _incidents: Incident[] = [];
let _incidentIdCounter = 1;

const _vulnerablePeople: VulnerablePerson[] = [];
let _vulnerableIdCounter = 1;

const _resources: Resource[] = [];
let _resourceIdCounter = 1;

const _campusZones: any[] = [];
const _evacuationRoutes: any[] = [];
const _users: any[] = [];

export async function getDb() {
  return null; // Signals we are using stateless mode
}

// ============ VULNERABLE PEOPLE (SDG 03) ============

export async function getVulnerablePeople() {
  return [..._vulnerablePeople];
}

export async function createVulnerablePerson(person: Omit<VulnerablePerson, "id" | "createdAt">) {
  const newPerson: VulnerablePerson = {
    ...person,
    id: _vulnerableIdCounter++,
    createdAt: new Date(),
  };
  _vulnerablePeople.push(newPerson);
  return newPerson;
}

export async function updateVulnerablePersonStatus(id: number, status: VulnerablePerson["status"]) {
  const person = _vulnerablePeople.find(p => p.id === id);
  if (person) person.status = status;
}

// ============ RESOURCES (SDG 11) ============

export async function getResources() {
  return [..._resources];
}

export async function createResource(resource: Omit<Resource, "id" | "createdAt">) {
  const newResource: Resource = {
    ...resource,
    id: _resourceIdCounter++,
    createdAt: new Date(),
  };
  _resources.push(newResource);
  return newResource;
}

export async function updateResourceStatus(id: number, status: Resource["status"]) {
  const resource = _resources.find(r => r.id === id);
  if (resource) resource.status = status;
}

/** Return demo entities to their initial state so a new FireCommand run starts clean. */
export function resetSimulationEntities() {
  for (const p of _vulnerablePeople) p.status = "safe";
  for (const r of _resources) if (r.status === "deployed") r.status = "available";
}

// ============ SEEDING (Demo) ============

export async function seedDemoData() {
  if (_vulnerablePeople.length > 0) return;

  // SDG 03: Seed exactly 33 vulnerable people (elderly, mobility_impaired, pregnant, respiratory)
  const vulnerableConfigs: Array<{ name: string, type: VulnerablePerson["type"], building: string }> = [];
  const buildings = ["Engineering Block", "Science Block", "Library", "Hostel A", "Medical Center"];
  const types: VulnerablePerson["type"][] = ["elderly", "mobility_impaired", "pregnant", "respiratory"];

  for (let i = 0; i < 33; i++) {
    const type = types[i % types.length];
    const building = buildings[i % buildings.length];
    await createVulnerablePerson({
      name: `Vulnerable Person ${i + 1}`,
      type: type,
      locationBuilding: building,
      locationX: (Math.random() - 0.5) * 400,
      locationY: (Math.random() - 0.5) * 400,
      status: "safe",
      vitalSigns: JSON.stringify({ heartRate: 72 + Math.floor(Math.random() * 10), spo2: 98, status: "Normal" })
    });
  }

  // SDG 11: Seed Resources
  const resourceTypes: Resource["type"][] = ["ambulance", "fire_truck", "medical_kit", "security"];
  for (let i = 0; i < 10; i++) {
    const type = resourceTypes[i % resourceTypes.length];
    await createResource({
      name: `${type.toUpperCase()} UNIT ${i + 1}`,
      type: type,
      status: "available",
      locationX: 250,
      locationY: 250
    });
  }
}

export async function upsertUser(user: any): Promise<void> {
  const existing = _users.find(u => u.openId === user.openId);
  if (existing) {
    Object.assign(existing, user, { lastSignedIn: new Date() });
  } else {
    _users.push({ ...user, id: _users.length + 1, lastSignedIn: new Date() });
  }
}

export async function getUserByOpenId(openId: string) {
  return _users.find(u => u.openId === openId);
}

// ============ INCIDENT MANAGEMENT (In-Memory) ============

export async function createIncident(incident: Omit<Incident, "id" | "createdAt">) {
  const newIncident: Incident = {
    ...incident,
    id: _incidentIdCounter++,
    createdAt: new Date(),
    resolvedAt: null
  };
  _incidents.push(newIncident);
  console.log("[Stateless DB] Incident Created:", newIncident.id, newIncident.type);
  return { insertId: newIncident.id };
}

export async function getActiveIncidents() {
  return _incidents.filter(i => !i.resolvedAt);
}

export async function getAllIncidents() {
  return [..._incidents];
}

export async function resolveIncident(incidentId: number) {
  const incident = _incidents.find(i => i.id === incidentId);
  if (incident) {
    incident.resolvedAt = new Date();
  }
  return { affectedRows: incident ? 1 : 0 };
}

export async function clearAllIncidents() {
  _incidents.length = 0;
  console.log("[Stateless DB] All Incidents Cleared");
  return { success: true };
}

export async function deleteIncident(incidentId: number) {
  const index = _incidents.findIndex(i => i.id === incidentId);
  if (index !== -1) {
    _incidents.splice(index, 1);
  }
  return { affectedRows: 1 };
}

// ============ CAMPUS ZONES (In-Memory) ============

export async function initializeCampusZones() {
  _campusZones.length = 0;
  const gridSize = 10;
  const cellSize = 50;

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      _campusZones.push({
        id: _campusZones.length + 1,
        name: `Zone-${x}-${y}`,
        // Cell centres, in the same -250..250 world frame as incidents, exits and buildings
        zoneX: (x - gridSize / 2) * cellSize + cellSize / 2,
        zoneY: (y - gridSize / 2) * cellSize + cellSize / 2,
        zoneRadius: cellSize / 2,
        buildingName: null,
      });
    }
  }
}

export async function getCampusZones() {
  if (_campusZones.length === 0) await initializeCampusZones();
  return [..._campusZones];
}

export async function getZoneSeverity(zoneId: number) {
  const zone = _campusZones.find(z => z.id === zoneId);
  if (!zone) return "info";

  let maxSeverity = "info";
  const activeIncidents = _incidents.filter(i => !i.resolvedAt);

  for (const incident of activeIncidents) {
    const distance = Math.sqrt(
      Math.pow(incident.locationX - zone.zoneX, 2) +
      Math.pow(incident.locationY - zone.zoneY, 2)
    );

    if (distance < zone.zoneRadius * 3) {
      if (incident.severity === "critical") return "critical";
      if (incident.severity === "warning") maxSeverity = "warning";
    }
  }
  return maxSeverity;
}

// ============ EVACUATION ROUTES (In-Memory) ============

export async function createEvacuationRoute(route: any) {
  _evacuationRoutes.push(route);
  return { success: true };
}

export async function getEvacuationRoute(fromBuilding: string, toExit: string) {
  return _evacuationRoutes.find(r => r.fromBuilding === fromBuilding) || null;
}

export async function getAllEvacuationRoutes() {
  return [..._evacuationRoutes];
}

// ============ NOTIFICATIONS (Dummy) ============
const _notifications: any[] = [];

export async function createNotification(n: any) {
  _notifications.push({ ...n, id: _notifications.length + 1, createdAt: new Date(), read: 0 });
  return { success: true };
}

export async function getUserNotifications(userId: number) {
  return _notifications.filter(n => n.userId === userId);
}

export async function markNotificationAsRead(id: number) {
  const n = _notifications.find(notif => notif.id === id);
  if (n) n.read = 1;
  return { success: true };
}
