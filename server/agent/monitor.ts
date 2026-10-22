import { getActiveIncidents, getVulnerablePeople, updateVulnerablePersonStatus, getResources, updateResourceStatus, getFireCommandState, setFireCommandState, FireCommandState } from "../db";
import { pathfinder } from "../pathfinding";
import { broadcastIncident, broadcastAIDecision, broadcastFireCommand, broadcastSpreadUpdate, broadcastEvacProgress, broadcastVitals, broadcastBroadcastStatus } from "../_core/socket";
import { simulateSpread, WindData } from "./spread";
import { agentSensorFusion, agentSpreadPredictor, agentEvacuationPlanner, agentVulnerabilityTriage, agentResourceAllocator, agentBroadcast } from "./orchestrator";

/**
 * FireCommand AI Orchestrator — Real Multi-Agent Monitor Loop
 * Each phase calls a real Gemini LLM agent for decision-making.
 * Phases: DETECTING → SPREADING → ROUTING → DISPATCHING → BROADCASTING → MONITORING → COMPLETE
 */

let _tickCount = 0;
let _spreadStep = 0;
let _heatmap: Array<{ x: number; y: number; intensity: number }> = [];
let _agentLog: Array<{ agent: string; phase: string; result: any; timestamp: number }> = [];

export function getAgentLog() {
  return _agentLog;
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _busy = false; // ticks are async (LLM calls can exceed the 2s interval) — never run two at once
let _lastState: FireCommandState | null = null;

export function stopMonitorLoop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

// LLM output is untrusted: coerce to a sane finite number
const finite = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function startMonitorLoop() {
  if (_timer) return; // idempotent: no duplicate loops
  console.log("[FireCommand] Starting AI Agent orchestration loop...");

  _timer = setInterval(tickOnce, 2000); // 2-second tick
}

// One orchestration tick. Exported so serverless hosts (no long-lived timer) can drive it on demand.
export async function tickOnce() {
    if (_busy) return;
    _busy = true;
    try {
      const state = getFireCommandState();
      if (!state || state.phase === 'IDLE' || state.phase === 'COMPLETE') {
        return;
      }
      // New incident (trigger/reset replaced the state object) -> reset per-run counters
      if (state !== _lastState) {
        _lastState = state;
        _tickCount = 0;
        _spreadStep = 0;
      }

      _tickCount++;
      state.timer_seconds += 30; // Each tick = 30 simulated seconds

      // ========== PHASE: DETECTING (AI Agent: SensorFusion) ==========
      if (state.phase === 'DETECTING') {
        const start = Date.now();
        console.log("[FireCommand] 🤖 Agent: SensorFusion analyzing sensors...");

        try {
          const sensorResult = await agentSensorFusion({
            zone: state.incident_summary.location.zone,
            smoke_level: 87,
            temperature_c: 340,
            cctv_alert: true,
          });

          state.incident_summary.confirmed = Boolean(sensorResult.confirmed);
          state.incident_summary.confidence = finite(sensorResult.confidence, 0.95, 0, 1);

          state.agent_log.push({
            agent: "SensorFusion",
            phase: "DETECTING",
            reasoning: sensorResult.reasoning,
            timestamp: Date.now(),
            duration_ms: Date.now() - start
          });

          // SDG 11: Detection score
          state.sdg_scores.sdg11 = 25;
          state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

          console.log(`[FireCommand] 🤖 SensorFusion: ${sensorResult.confirmed ? 'CONFIRMED' : 'DENIED'} (${(sensorResult.confidence * 100).toFixed(0)}%) — ${sensorResult.reasoning}`);
        } catch (err) {
          console.log("[FireCommand] SensorFusion fallback (LLM unavailable)");
          state.incident_summary.confirmed = true;
          state.incident_summary.confidence = 0.97;
        }

        state.phase = 'SPREADING';
      }

      // ========== PHASE: SPREADING (AI Agent: SpreadPredictor + Physics Sim) ==========
      else if (state.phase === 'SPREADING') {
        _spreadStep = Math.min(20, _spreadStep + 2);

        // Physics simulation (cellular automata)
        const wind: WindData = {
          direction_deg: state.predictions.wind.direction_deg,
          speed_mps: state.predictions.wind.speed_mps,
        };
        const spreadResult = simulateSpread(0, 20, wind, null, _spreadStep);

        _heatmap = spreadResult.heatmap.slice().sort((a, b) => b.intensity - a.intensity).slice(0, 200);
        broadcastSpreadUpdate({
          heatmap: _heatmap,
          evac_window: spreadResult.evac_window_minutes,
          spread_direction: spreadResult.spread_direction,
          step: _spreadStep,
        });

        // After 2 ticks of physics sim, call AI agent for interpretation
        if (_tickCount >= 2) {
          const start = Date.now();
          console.log("[FireCommand] 🤖 Agent: SpreadPredictor analyzing wind/terrain...");

          try {
            const spreadAI = await agentSpreadPredictor({
              fire_zone: state.incident_summary.location.zone,
              wind_direction: state.predictions.wind.direction,
              wind_speed_mps: state.predictions.wind.speed_mps,
              terrain: "Flat campus with mild slope (Engineering Block lower, Science Block higher)",
            });

            state.predictions.spread_direction = String(spreadAI.spread_direction || spreadResult.spread_direction);
            state.predictions.evac_window_minutes = finite(spreadAI.evac_window_minutes, spreadResult.evac_window_minutes, 1, 120);

            state.agent_log.push({
              agent: "SpreadPredictor",
              phase: "SPREADING",
              reasoning: spreadAI.reasoning,
              timestamp: Date.now(),
              duration_ms: Date.now() - start
            });

            // SDG 13: Climate analysis score
            state.sdg_scores.sdg13 = 45;
            state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

            console.log(`[FireCommand] 🤖 SpreadPredictor: Spreads ${spreadAI.spread_direction}, Window: ${spreadAI.evac_window_minutes}min — ${spreadAI.reasoning}`);
          } catch (err) {
            console.log("[FireCommand] SpreadPredictor fallback");
            state.predictions.spread_direction = spreadResult.spread_direction;
            state.predictions.evac_window_minutes = spreadResult.evac_window_minutes;
          }

          state.phase = 'ROUTING';
        }
      }

      // ========== PHASE: ROUTING (AI Agent: EvacuationPlanner) ==========
      else if (state.phase === 'ROUTING') {
        const start = Date.now();
        // Compute routes with pathfinder
        const routes = pathfinder.compute4Routes(0, 20, _heatmap);

        console.log("[FireCommand] 🤖 Agent: EvacuationPlanner strategizing 4 routes...");

        try {
          const evacPlan = await agentEvacuationPlanner({
            fire_zone: state.incident_summary.location.zone,
            spread_direction: state.predictions.spread_direction,
            population: 700,
            vulnerable_count: 33,
            available_routes: routes.map(r => ({ type: r.type, eta_min: r.eta_min || 3, description: r.description })),
          });

          // Merge AI priorities with computed routes
          state.evacuation.routes = evacPlan.route_priorities.map((rp, i) => ({
            type: String(rp.type),
            eta_min: finite(rp.eta_min, routes[i]?.eta_min || 3, 0, 120),
            description: String(rp.reasoning ?? ""),
          }));

          state.agent_log.push({
            agent: "EvacuationPlanner",
            phase: "ROUTING",
            reasoning: evacPlan.reasoning || evacPlan.strategy,
            timestamp: Date.now(),
            duration_ms: Date.now() - start
          });

          // SDG 11: Routing score
          state.sdg_scores.sdg11 = 60;
          state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

          console.log(`[FireCommand] 🤖 EvacuationPlanner: Strategy — ${evacPlan.strategy}`);
        } catch (err) {
          console.log("[FireCommand] EvacuationPlanner fallback");
          state.evacuation.routes = routes.map(r => ({
            type: r.type,
            eta_min: r.eta_min || 3,
            description: r.description,
          }));
        }

        // SDG 03: Identify vulnerable
        const vulnerable = await getVulnerablePeople();
        for (const person of vulnerable) {
          if (person.status === 'safe') {
            await updateVulnerablePersonStatus(person.id, 'at_risk');
          }
        }
        state.evacuation.vulnerable_total = vulnerable.length;

        // AI Agent: VulnerabilityTriage
        const triageStart = Date.now();
        console.log("[FireCommand] 🤖 Agent: VulnerabilityTriage assigning waves...");
        try {
          const triageResult = await agentVulnerabilityTriage({
            total_vulnerable: vulnerable.length,
            types: {
              elderly: vulnerable.filter(p => p.type === 'elderly').length,
              mobility_impaired: vulnerable.filter(p => p.type === 'mobility_impaired').length,
              pregnant: vulnerable.filter(p => p.type === 'pregnant').length,
              respiratory: vulnerable.filter(p => p.type === 'respiratory').length,
            },
            fire_zone: state.incident_summary.location.zone,
          });

          state.agent_log.push({
            agent: "VulnerabilityTriage",
            phase: "ROUTING",
            reasoning: triageResult.reasoning,
            timestamp: Date.now(),
            duration_ms: Date.now() - triageStart
          });

          // SDG 03: Vulnerable identification score
          state.sdg_scores.sdg03 = 40;
          state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

          console.log(`[FireCommand] 🤖 VulnerabilityTriage: Wave1=${triageResult.wave_1_critical}, Wave2=${triageResult.wave_2_priority}, Wave3=${triageResult.wave_3_standard} — ${triageResult.reasoning}`);
        } catch (err) {
          console.log("[FireCommand] VulnerabilityTriage fallback");
        }

        state.phase = 'DISPATCHING';
      }

      // ========== PHASE: DISPATCHING (AI Agent: ResourceAllocator) ==========
      else if (state.phase === 'DISPATCHING') {
        const start = Date.now();
        const resources = await getResources();
        const ambulances = resources.filter(r => r.type === 'ambulance' && r.status === 'available');
        const fireTrucks = resources.filter(r => r.type === 'fire_truck' && r.status === 'available');
        const medKits = resources.filter(r => r.type === 'medical_kit' && r.status === 'available');

        console.log("[FireCommand] 🤖 Agent: ResourceAllocator optimizing dispatch...");

        try {
          const allocation = await agentResourceAllocator({
            ambulances_available: ambulances.length,
            medical_kits_available: medKits.length,
            fire_trucks_available: fireTrucks.length,
            assembly_points: ["North Assembly Point", "South Field", "Medical Tent A"],
            wave_1_count: 8,
          });

          // Apply AI-driven dispatch
          state.resources.ambulances_dispatched = [];
          for (let i = 0; i < ambulances.length; i++) {
            await updateResourceStatus(ambulances[i].id, 'deployed');
            state.resources.ambulances_dispatched.push({
              id: ambulances[i].id,
              name: ambulances[i].name,
              target_zone: allocation.ambulance_assignments?.[i]?.target_zone || 'North Assembly Point',
              eta_minutes: 3 + Math.floor(Math.random() * 4),
              status: 'en_route',
            });
          }

          state.resources.fire_response = [];
          for (const truck of fireTrucks) {
            await updateResourceStatus(truck.id, 'deployed');
            state.resources.fire_response.push({
              id: truck.id,
              name: truck.name,
              status: 'deployed',
            });
          }

          state.resources.medical_teams_dispatched = [];
          for (let i = 0; i < medKits.length; i++) {
            await updateResourceStatus(medKits[i].id, 'deployed');
            state.resources.medical_teams_dispatched.push({
              id: medKits[i].id,
              name: `MED_TEAM_${medKits[i].id}`,
              target_zone: allocation.medical_team_assignments?.[i]?.target_zone || 'Assembly Point',
              status: 'deployed',
            });
          }

          state.agent_log.push({
            agent: "ResourceAllocator",
            phase: "DISPATCHING",
            reasoning: allocation.reasoning,
            timestamp: Date.now(),
            duration_ms: Date.now() - start
          });

          // SDG 11: Dispatch score
          state.sdg_scores.sdg11 = 85;
          state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

          console.log(`[FireCommand] 🤖 ResourceAllocator: ${allocation.fire_response_strategy} — ${allocation.reasoning}`);
        } catch (err) {
          console.log("[FireCommand] ResourceAllocator fallback");
          state.resources.ambulances_dispatched = ambulances.map(a => ({
            id: a.id, name: a.name, target_zone: 'North Assembly', eta_minutes: 4, status: 'en_route'
          }));
          state.resources.fire_response = fireTrucks.map(t => ({ id: t.id, name: t.name, status: 'deployed' }));
          state.resources.medical_teams_dispatched = medKits.map(m => ({ id: m.id, name: `MED_TEAM_${m.id}`, target_zone: 'Assembly', status: 'deployed' }));
          for (const r of [...ambulances, ...fireTrucks, ...medKits]) await updateResourceStatus(r.id, 'deployed');
        }

        state.phase = 'BROADCASTING';
      }

      // ========== PHASE: BROADCASTING (AI Agent: BroadcastAgent) ==========
      else if (state.phase === 'BROADCASTING') {
        const start = Date.now();
        // First tick: Call AI agent for message crafting
        if (!state.broadcast.message) {
          console.log("[FireCommand] 🤖 Agent: BroadcastAgent crafting emergency message...");

          try {
            const broadcastResult = await agentBroadcast({
              fire_zone: state.incident_summary.location.zone,
              spread_direction: state.predictions.spread_direction,
              evac_window_minutes: state.predictions.evac_window_minutes,
              assembly_points: ["North Assembly Point", "South Field"],
              population: 700,
            });

            state.broadcast.message = broadcastResult.push_message;
            state.broadcast.channels = ['push', 'in_app', 'sms'];

            state.agent_log.push({
              agent: "BroadcastAgent",
              phase: "BROADCASTING",
              reasoning: broadcastResult.detailed_message,
              timestamp: Date.now(),
              duration_ms: Date.now() - start
            });

            // SDG 11: Broadcast score (finalizing SDG 11)
            state.sdg_scores.sdg11 = 100;
            state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

            console.log(`[FireCommand] 🤖 BroadcastAgent: "${broadcastResult.push_message}"`);
          } catch (err) {
            console.log("[FireCommand] BroadcastAgent fallback");
            state.broadcast.message = `🚨 EMERGENCY: Fire at ${state.incident_summary.location.zone}. Evacuate NOW. Assembly at North/South points. Window: ${state.predictions.evac_window_minutes} min.`;
            state.broadcast.channels = ['push', 'in_app', 'sms'];
          }
        }

        // Simulate climbing counter
        if (state.broadcast.sent_count < state.broadcast.target_count) {
          state.broadcast.sent_count = Math.min(state.broadcast.target_count, state.broadcast.sent_count + 120 + Math.floor(Math.random() * 80));
          state.broadcast.seen_count = Math.min(state.broadcast.sent_count, state.broadcast.seen_count + 80 + Math.floor(Math.random() * 50));
        }

        broadcastBroadcastStatus({
          sent: state.broadcast.sent_count,
          seen: state.broadcast.seen_count,
          target: state.broadcast.target_count,
        });

        if (state.broadcast.sent_count >= state.broadcast.target_count) {
          state.phase = 'MONITORING';
        }
      }

      // ========== PHASE: MONITORING (SDG 03 — Vitals + Evacuation Progress) ==========
      else if (state.phase === 'MONITORING') {
        state.evacuation.evacuated_count = Math.min(
          state.evacuation.population_total,
          state.evacuation.evacuated_count + 80 + Math.floor(Math.random() * 40)
        );

        // Update vulnerable people status
        const vulnerable = await getVulnerablePeople();
        for (const person of vulnerable) {
          if (person.status === 'at_risk' && Math.random() > 0.3) {
            await updateVulnerablePersonStatus(person.id, 'evacuating');
          } else if (person.status === 'evacuating' && Math.random() > 0.4) {
            await updateVulnerablePersonStatus(person.id, 'evacuated');
          }
        }

        const evacuatedCount = vulnerable.filter(p => p.status === 'evacuated').length;
        const evacuatingCount = vulnerable.filter(p => p.status === 'evacuating').length;
        const atRiskCount = vulnerable.length - evacuatedCount - evacuatingCount;

        state.health_ops.triage_summary = { green: evacuatedCount, yellow: evacuatingCount, red: atRiskCount };

        // SDG 03: Vitals score
        state.sdg_scores.sdg03 = vulnerable.length ? Math.min(100, 40 + Math.round((evacuatedCount / vulnerable.length) * 60)) : 100;
        // SDG 13: Finalizing score
        state.sdg_scores.sdg13 = 100;
        state.sdg_scores.combined = Math.round((state.sdg_scores.sdg11 + state.sdg_scores.sdg13 + state.sdg_scores.sdg03) / 3);

        broadcastVitals(state.health_ops.triage_summary);
        broadcastEvacProgress({
          evacuated: state.evacuation.evacuated_count,
          total: state.evacuation.population_total,
          timer: state.timer_seconds,
        });

        // Completion
        if (state.evacuation.evacuated_count >= state.evacuation.population_total) {
          state.phase = 'COMPLETE';
          state.success_metrics = {
            evacuated_count: state.evacuation.population_total,
            time_minutes: Math.ceil(state.timer_seconds / 60),
            casualties: 0,
            vulnerable_prioritized: true,
          };

          state.sdg_scores.sdg03 = 100;
          state.sdg_scores.combined = 100;

          console.log("[FireCommand] ✅ MISSION COMPLETE:", state.success_metrics);
          console.log("[FireCommand] 🤖 Total AI Agent calls:", state.agent_log.length);
          state.agent_log.forEach(log => console.log(`  → ${log.agent} (${log.phase})`));
        }
      }

      // State was reset/replaced while we were awaiting an agent: drop this stale tick
      if (getFireCommandState() !== state) return;

      // Broadcast full state to all clients
      setFireCommandState(state);
      broadcastFireCommand(state);

    } catch (error) {
      console.error("[FireCommand] Orchestration error:", error);
    } finally {
      _busy = false;
    }
  }
