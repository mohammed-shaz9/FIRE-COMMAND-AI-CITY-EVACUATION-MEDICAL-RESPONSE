/**
 * FireCommand AI Orchestrator — Multi-Agent System
 * Each phase is driven by a real Gemini LLM call with structured JSON output.
 * 
 * Agents:
 *  1. SensorFusion Agent → Confirm fire + confidence
 *  2. SpreadPredictor Agent → Interpret spread + evac window
 *  3. EvacuationPlanner Agent → Prioritize 4 route types
 *  4. VulnerabilityTriage Agent → Wave assignments for 33 people
 *  5. ResourceAllocator Agent → Dispatch ambulances + med teams
 *  6. BroadcastAgent → Craft emergency message for 700
 */

import { invokeLLM, parseLLMJson } from "../_core/llm";

// =============================================
// AGENT 1: SensorFusion — Confirm fire
// =============================================
export interface SensorFusionResult {
  confirmed: boolean;
  confidence: number;
  fire_type: string;
  reasoning: string;
}

export async function agentSensorFusion(sensorData: {
  zone: string;
  smoke_level: number;
  temperature_c: number;
  cctv_alert: boolean;
}): Promise<SensorFusionResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are SensorFusion, a fire detection AI agent for MRUH Campus. 
You analyze multi-sensor data (smoke detectors, temperature sensors, CCTV alerts) to confirm or deny a fire incident.
You must return a confidence score (0-1) and fire type classification.
Be aggressive in detection — false negatives cost lives.`,
      },
      {
        role: "user",
        content: `SENSOR DATA:
- Zone: ${sensorData.zone}
- Smoke Level: ${sensorData.smoke_level}/100
- Temperature: ${sensorData.temperature_c}°C
- CCTV Motion Alert: ${sensorData.cctv_alert}

Analyze and confirm/deny fire. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sensor_fusion",
        strict: true,
        schema: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
            confidence: { type: "number" },
            fire_type: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["confirmed", "confidence", "fire_type", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) return { confirmed: true, confidence: 0.95, fire_type: "structural", reasoning: "Fallback: high smoke + temperature detected" };
  return parseLLMJson<SensorFusionResult>(content);
}

// =============================================
// AGENT 2: SpreadPredictor — Wind/terrain analysis
// =============================================
export interface SpreadPredictionResult {
  spread_direction: string;
  evac_window_minutes: number;
  risk_zones: string[];
  reasoning: string;
}

export async function agentSpreadPredictor(data: {
  fire_zone: string;
  wind_direction: string;
  wind_speed_mps: number;
  terrain: string;
}): Promise<SpreadPredictionResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are SpreadPredictor, a fire spread analysis AI agent (SDG 13 Climate Action).
You analyze wind direction, speed, and terrain to predict fire spread patterns.
Wind blows FROM a direction — fire spreads in the OPPOSITE direction.
Uphill terrain accelerates spread. Roads and open spaces slow it.
You must provide an evacuation window in minutes.`,
      },
      {
        role: "user",
        content: `FIRE DATA:
- Origin: ${data.fire_zone}
- Wind: FROM ${data.wind_direction} at ${data.wind_speed_mps} m/s
- Terrain: ${data.terrain}

Campus Layout:
- Engineering Block (center), Science Block (south), Library (east)
- Hostel A (west), Medical Center (southeast)
- Main corridors run North-South and East-West

Predict spread direction, at-risk zones, and evacuation window. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "spread_prediction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            spread_direction: { type: "string" },
            evac_window_minutes: { type: "number" },
            risk_zones: { type: "array", items: { type: "string" } },
            reasoning: { type: "string" },
          },
          required: ["spread_direction", "evac_window_minutes", "risk_zones", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) return { spread_direction: "South", evac_window_minutes: 15, risk_zones: ["Science Block", "Library"], reasoning: "Fallback prediction" };
  return parseLLMJson<SpreadPredictionResult>(content);
}

// =============================================
// AGENT 3: EvacuationPlanner — 4 route strategy
// =============================================
export interface EvacPlanResult {
  route_priorities: Array<{ type: string; reasoning: string; eta_min: number }>;
  assembly_points: string[];
  strategy: string;
  reasoning: string;
}

export async function agentEvacuationPlanner(data: {
  fire_zone: string;
  spread_direction: string;
  population: number;
  vulnerable_count: number;
  available_routes: Array<{ type: string; eta_min: number; description: string }>;
}): Promise<EvacPlanResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are EvacuationPlanner, an AI agent specializing in SDG 11 Resilient Cities.
Your task is to prioritize 4 evacuation routes computed by the pathfinder.
1) fastest 2) safest (away from spread) 3) accessible (slope/ramps) 4) low crowd.
Recommend the primary strategy for 700 people and 33 vulnerable people.`,
      },
      {
        role: "user",
        content: `INCIDENT: Fire at ${data.fire_zone}. SPREAD: ${data.spread_direction}. 
POPULATION: ${data.population}. VULNERABLE: ${data.vulnerable_count}.
AVAILABLE ROUTES: ${JSON.stringify(data.available_routes)}

Prioritize these 4 routes and define the overall evacuation strategy. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "evac_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            route_priorities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  reasoning: { type: "string" },
                  eta_min: { type: "number" },
                },
                required: ["type", "reasoning", "eta_min"],
                additionalProperties: false,
              },
            },
            assembly_points: { type: "array", items: { type: "string" } },
            strategy: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["route_priorities", "assembly_points", "strategy", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      route_priorities: data.available_routes.map(r => ({ type: r.type, reasoning: "Auto-assigned", eta_min: r.eta_min })),
      assembly_points: ["North Parking Lot", "South Field"],
      strategy: "Standard evacuation protocol",
      reasoning: "LLM fallback: Standard protocol active.",
    };
  }
  return parseLLMJson<EvacPlanResult>(content);
}

// =============================================
// AGENT 4: VulnerabilityTriage — SDG 3
// =============================================
export interface TriageResult {
  wave_1_critical: number;
  wave_2_priority: number;
  wave_3_standard: number;
  medical_stations_needed: number;
  reasoning: string;
}

export async function agentVulnerabilityTriage(data: {
  total_vulnerable: number;
  types: Record<string, number>;
  fire_zone: string;
}): Promise<TriageResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are VulnerabilityTriage, a medical triage AI agent (SDG 3 Good Health).
You prioritize ${data.total_vulnerable} vulnerable individuals into 3 evacuation waves based on risk.
Wave 1: Highest risk (respiratory near fire, immobile). Wave 2: Priority (elderly, pregnant). Wave 3: Standard.
You must also recommend medical station count.`,
      },
      {
        role: "user",
        content: `VULNERABLE POPULATION: ${data.total_vulnerable}
- Types: ${JSON.stringify(data.types)}
- Fire Zone: ${data.fire_zone}

Assign wave counts and recommend medical response. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "triage",
        strict: true,
        schema: {
          type: "object",
          properties: {
            wave_1_critical: { type: "number" },
            wave_2_priority: { type: "number" },
            wave_3_standard: { type: "number" },
            medical_stations_needed: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["wave_1_critical", "wave_2_priority", "wave_3_standard", "medical_stations_needed", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) return { wave_1_critical: 8, wave_2_priority: 12, wave_3_standard: 13, medical_stations_needed: 3, reasoning: "Fallback triage" };
  return parseLLMJson<TriageResult>(content);
}

// =============================================
// AGENT 5: ResourceAllocator — SDG 11
// =============================================
export interface AllocationResult {
  ambulance_assignments: Array<{ target_zone: string; priority: string }>;
  medical_team_assignments: Array<{ target_zone: string; role: string }>;
  fire_response_strategy: string;
  reasoning: string;
}

export async function agentResourceAllocator(data: {
  ambulances_available: number;
  medical_kits_available: number;
  fire_trucks_available: number;
  assembly_points: string[];
  wave_1_count: number;
}): Promise<AllocationResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are ResourceAllocator, a resource dispatch AI agent (SDG 11 Sustainable Cities).
You allocate emergency resources to maximize survival probability.
Consider: nearest-available units, predicted congestion, vulnerable clusters, and assembly point locations.`,
      },
      {
        role: "user",
        content: `RESOURCES:
- Ambulances: ${data.ambulances_available}
- Medical Kits: ${data.medical_kits_available}
- Fire Trucks: ${data.fire_trucks_available}
- Assembly Points: ${JSON.stringify(data.assembly_points)}
- Wave 1 (Critical): ${data.wave_1_count} people

Allocate resources optimally. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resource_allocation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            ambulance_assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target_zone: { type: "string" },
                  priority: { type: "string" },
                },
                required: ["target_zone", "priority"],
                additionalProperties: false,
              },
            },
            medical_team_assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target_zone: { type: "string" },
                  role: { type: "string" },
                },
                required: ["target_zone", "role"],
                additionalProperties: false,
              },
            },
            fire_response_strategy: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["ambulance_assignments", "medical_team_assignments", "fire_response_strategy", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      ambulance_assignments: [{ target_zone: "North Assembly", priority: "critical" }],
      medical_team_assignments: [{ target_zone: "South Assembly", role: "triage" }],
      fire_response_strategy: "Contain + Suppress",
      reasoning: "Fallback allocation",
    };
  }
  return parseLLMJson<AllocationResult>(content);
}

// =============================================
// AGENT 6: BroadcastAgent — Emergency Comms
// =============================================
export interface BroadcastResult {
  push_message: string;
  detailed_message: string;
  do_not_list: string[];
  urgency: string;
}

export async function agentBroadcast(data: {
  fire_zone: string;
  spread_direction: string;
  evac_window_minutes: number;
  assembly_points: string[];
  population: number;
}): Promise<BroadcastResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are BroadcastAgent, an emergency communications AI agent.
Create two messages: a short push notification (under 200 chars) and a detailed in-app message.
Include: hazard type, where to go, route type, evacuation deadline, and "do not" safety list.
Be direct, clear, and urgent. Lives depend on clarity.`,
      },
      {
        role: "user",
        content: `EMERGENCY:
- Fire at: ${data.fire_zone}
- Spreading: ${data.spread_direction}
- Window: ${data.evac_window_minutes} minutes
- Assembly: ${JSON.stringify(data.assembly_points)}
- Population: ${data.population}

Craft emergency broadcasts. Return JSON.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "broadcast",
        strict: true,
        schema: {
          type: "object",
          properties: {
            push_message: { type: "string" },
            detailed_message: { type: "string" },
            do_not_list: { type: "array", items: { type: "string" } },
            urgency: { type: "string" },
          },
          required: ["push_message", "detailed_message", "do_not_list", "urgency"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      push_message: "🚨 FIRE: Evacuate immediately via assigned routes. Assembly at North/South lots.",
      detailed_message: "Fire detected. Follow evacuation signs. Do not use elevators.",
      do_not_list: ["Do not use elevators", "Do not re-enter building"],
      urgency: "critical",
    };
  }
  return parseLLMJson<BroadcastResult>(content);
}
