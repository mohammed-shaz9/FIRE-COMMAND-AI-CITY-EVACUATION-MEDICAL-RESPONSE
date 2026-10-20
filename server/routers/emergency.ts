import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  createIncident,
  getActiveIncidents,
  getAllIncidents,
  resolveIncident,
  deleteIncident,
  clearAllIncidents,
  getCampusZones,
  getZoneSeverity,
  getVulnerablePeople,
  getResources,
  getFireCommandState as getState,
  setFireCommandState,
  clearFireCommandState,
  resetSimulationEntities,
  FireCommandState,
} from "../db";
import { invokeLLM, parseLLMJson } from "../_core/llm";
import { transcribeAudio } from "../_core/voiceTranscription";
import { pathfinder } from "../pathfinding";
import { broadcastIncident, broadcastResolution, broadcastAIDecision, broadcastFireCommand } from "../_core/socket";
import { retrieveKnowledge } from "../agent/rag";
import { makeDecision } from "../agent/decision";

export const emergencyRouter = router({

  // ========== FIRECOMMAND: TRIGGER ==========
  triggerFireCommand: publicProcedure
    .input(z.object({
      zone: z.string().max(120).default("Engineering Block Floor 3"),
      wind_direction_deg: z.number().min(0).max(360).default(0), // 0=North
      wind_speed_mps: z.number().min(0).max(100).default(15),
    }))
    .mutation(async ({ input }) => {
      resetSimulationEntities(); // fresh run: all units available, all vulnerable people 'safe'

      // Initialize full FireCommand state
      const state: FireCommandState = {
        incident_summary: {
          confirmed: false,
          location: { zone: input.zone, lat: 17.5583, lng: 78.4300 },
          confidence: 0,
        },
        predictions: {
          wind: {
            direction: ['N','NE','E','SE','S','SW','W','NW'][Math.round(input.wind_direction_deg / 45) % 8],
            speed_mps: input.wind_speed_mps,
            direction_deg: input.wind_direction_deg,
          },
          spread_direction: 'S',
          evac_window_minutes: 15,
        },
        evacuation: {
          population_total: 700,
          vulnerable_total: 33,
          evacuated_count: 0,
          routes: [],
        },
        resources: {
          ambulances_dispatched: [],
          medical_teams_dispatched: [],
          fire_response: [],
        },
        broadcast: {
          message: '',
          target_count: 700,
          sent_count: 0,
          seen_count: 0,
          channels: [],
        },
        health_ops: {
          triage_summary: { green: 0, yellow: 0, red: 0 },
        },
        sdg_scores: {
          sdg11: 0,
          sdg13: 0,
          sdg03: 0,
          combined: 0,
        },
        counterfactuals: {
          traditional_time_min: 18,
          traditional_casualties: 24,
          traditional_detection_delay_min: 8,
        },
        agent_log: [],
        success_metrics: {
          evacuated_count: 0,
          time_minutes: 0,
          casualties: 0,
          vulnerable_prioritized: false,
        },
        timer_seconds: 0,
        phase: 'DETECTING',
      };

      setFireCommandState(state);
      broadcastFireCommand(state);

      // Re-trigger replaces the previous run's incidents instead of stacking duplicates
      await clearAllIncidents();
      const incident = {
        type: 'fire' as const,
        severity: 'critical' as const,
        locationX: 0,
        locationY: 12,
        locationZ: 20,
        buildingName: input.zone,
        description: 'FIRECOMMAND: Critical fire detected. Multi-agent orchestration initiated.',
        windDirection: state.predictions.wind.direction,
        windSpeed: input.wind_speed_mps,
      };
      const { insertId } = await createIncident(incident);
      broadcastIncident({ id: insertId, ...incident });

      return { success: true, phase: 'DETECTING' };
    }),

  // ========== FIRECOMMAND: GET STATE ==========
  getFireCommandState: publicProcedure.query(() => {
    return getState();
  }),

  // ========== FIRECOMMAND: RESET ==========
  resetFireCommand: publicProcedure.mutation(async () => {
    clearFireCommandState();
    resetSimulationEntities();
    await clearAllIncidents();
    broadcastResolution("ALL");
    broadcastFireCommand(null);
    return { success: true };
  }),


  // Simplified audio upload bypassing storage proxy for rapid demo
  uploadAudio: protectedProcedure
    .input(z.object({
      audioBase64: z.string(),
      fileName: z.string()
    }))
    .mutation(async ({ input }) => {
      // In a stateless demo, we just echo back a temporary marker
      return { url: `data:audio/webm;base64,${input.audioBase64}` };
    }),

  // Create a new incident
  createIncident: protectedProcedure
    .input(
      z.object({
        type: z.enum(["fire", "flood", "earthquake", "medical", "other"]),
        severity: z.enum(["critical", "warning", "info"]),
        locationX: z.number(),
        locationY: z.number(),
        locationZ: z.number(),
        buildingName: z.string().max(200).optional(),
        description: z.string().max(1000).optional(),
        windDirection: z.string().max(20).optional(),
        windSpeed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await createIncident({
        type: input.type,
        severity: input.severity,
        locationX: input.locationX,
        locationY: input.locationY,
        locationZ: input.locationZ,
        buildingName: input.buildingName,
        description: input.description,
        windDirection: input.windDirection,
        windSpeed: input.windSpeed,
      });

      // Construct a broadcast-friendly object
      const incidentData = {
        id: result.insertId,
        ...input
      };

      broadcastIncident(incidentData);

      // AI AGENT: Autonomous Decision Logic
      (async () => {
        try {
          const knowledge = await retrieveKnowledge({ locationX: input.locationX, locationY: input.locationY });
          const decision = await makeDecision(incidentData, knowledge);
          broadcastAIDecision({
            incidentId: result.insertId,
            ...decision
          });
        } catch (err) {
          console.error("[AI_AGENT] Autonomy failure:", err);
        }
      })();

      return { success: true, incident: incidentData };
    }),

  // Process voice report and create incident (Requires AI Key)
  reportVoiceIncident: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string(),
        language: z.enum(["te", "hi", "en"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const transcription = await transcribeAudio({
          audioUrl: input.audioUrl,
          language: input.language || "en",
        });

        const transcriptText = typeof transcription === 'object' && 'text' in transcription ? transcription.text : String(transcription);

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are an emergency dispatcher. Return ONLY JSON: {type: 'fire'|'flood'|'medical', severity: 'critical'|'warning', location: 'string', description: 'string'}",
            },
            { role: "user", content: `Report: ${transcriptText}` },
          ] as any,
        } as any);

        const content = response.choices[0]?.message?.content;
        const raw = parseLLMJson(content);
        // LLM output is untrusted: coerce to the incident enums
        const classified = {
          type: (["fire", "flood", "medical"] as const).includes(raw?.type) ? raw.type as "fire" | "flood" | "medical" : "other" as const,
          severity: (["critical", "warning", "info"] as const).includes(raw?.severity) ? raw.severity as "critical" | "warning" | "info" : "warning" as const,
          location: String(raw?.location ?? "").slice(0, 200),
          description: String(raw?.description ?? transcriptText).slice(0, 1000),
        };

        const locationMap: Record<string, [number, number, number]> = {
          "engineering block": [-50, 0, -50],
          "science block": [200, 0, 200],
          "library": [50, 0, 80],
          "medical center": [120, 0, 80],
        };

        const locationKey = classified.location.toLowerCase();
        const match = Object.keys(locationMap).find((k) => locationKey.includes(k));
        const [x, y, z] = match ? locationMap[match] : [0, 0, 0];

        const incident = await createIncident({
          type: classified.type,
          severity: classified.severity,
          locationX: x,
          locationY: y,
          locationZ: z,
          buildingName: classified.location,
          description: classified.description,
        });

        const incidentData = { id: incident.insertId, ...classified, locationX: x, locationY: y, locationZ: z };
        broadcastIncident(incidentData);

        // AI AGENT: Autonomous Decision Logic
        (async () => {
          try {
            const knowledge = await retrieveKnowledge({ locationX: x, locationY: y });
            const decision = await makeDecision(incidentData, knowledge);
            broadcastAIDecision({
              incidentId: incident.insertId,
              ...decision
            });
          } catch (err) {
            console.error("[AI_AGENT] Autonomy failure:", err);
          }
        })();

        return { success: true, incident, transcription: transcriptText };
      } catch (error) {
        console.error("Voice incident error:", error);
        throw error;
      }
    }),

  getActiveIncidents: publicProcedure.query(async () => {
    return await getActiveIncidents();
  }),

  resolveIncident: protectedProcedure
    .input(z.object({ incidentId: z.number() }))
    .mutation(async ({ input }) => {
      await resolveIncident(input.incidentId);
      broadcastResolution(String(input.incidentId));
      return { success: true };
    }),

  clearAllIncidents: protectedProcedure.mutation(async () => {
    await clearAllIncidents();
    broadcastResolution("ALL");
    return { success: true };
  }),

  getCampusZones: publicProcedure.query(async () => {
    const zones = await getCampusZones();
    return zones.map((z) => ({ id: z.id, x: z.zoneX, y: z.zoneY, name: z.name, severity: "info" }));
  }),

  getZoneSeverity: publicProcedure
    .input(z.object({ zoneId: z.number() }))
    .query(async ({ input }) => ({ severity: await getZoneSeverity(input.zoneId) })),

  calculateEvacuationRoutes: publicProcedure
    .input(z.object({ buildings: z.array(z.object({ name: z.string(), x: z.number(), y: z.number() })) }))
    .query(async ({ input }) => {
      const incidents = await getActiveIncidents();
      return pathfinder.calculateAllEvacuationRoutes(
        input.buildings,
        incidents.map((i) => ({ locationX: i.locationX, locationY: i.locationY, type: i.type, severity: i.severity }))
      );
    }),

  runFireCommandScenario: publicProcedure
    .input(z.object({ incidentId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const activeIncidents = await getActiveIncidents();
      const incident =
        activeIncidents.find((item) => item.id === input?.incidentId) ??
        activeIncidents.find((item) => item.type === "fire" && item.severity === "critical") ??
        activeIncidents[activeIncidents.length - 1];

      const windDirection = (incident?.windDirection || "North") as "North";
      const windSpeed = incident?.windSpeed || 15;

      const buildings = [
        { name: "Engineering Block", x: -50, y: -50 },
        { name: "Science Block", x: 200, y: 200 },
        { name: "Library", x: 50, y: 80 },
        { name: "Hostel A", x: -80, y: 50 },
        { name: "Medical Center", x: 120, y: 80 },
        { name: "Admin Block", x: 0, y: -80 },
      ];

      const pathRoutes = pathfinder.calculateAllEvacuationRoutes(
        buildings,
        incident
          ? [{ locationX: incident.locationX, locationY: incident.locationY, type: incident.type, severity: incident.severity }]
          : []
      );

      const routeTypes = ["fastest", "safest", "accessible", "low_crowd"] as const;
      const routeSet = pathRoutes.slice(0, 4).map((route, index) => ({
        type: routeTypes[index],
        eta_min: Math.max(1, Math.ceil(route.timeSeconds / 60)),
        polyline: route.path,
      }));

      const vulnerablePeople = await getVulnerablePeople();
      const resources = await getResources();
      const ambulances = resources.filter((resource) => resource.type === "ambulance").slice(0, 4);
      const medicalTeams = resources.filter((resource) => resource.type === "medical_kit").slice(0, 4);

      const triage = vulnerablePeople.reduce(
        (acc, person) => {
          if (person.type === "respiratory") acc.red += 1;
          else if (person.type === "elderly" || person.type === "pregnant") acc.yellow += 1;
          else acc.green += 1;
          return acc;
        },
        { green: 0, yellow: 0, red: 0 }
      );

      const spreadCells = Array.from({ length: 60 }, (_, index) => ({
        id: index + 1,
        intensity: Number((1 - index / 60).toFixed(2)),
      }));

      return {
        incident_summary: {
          confirmed: Boolean(incident),
          location: {
            zone: incident?.buildingName || "Engineering Block",
            lat: incident?.locationX ?? -50,
            lng: incident?.locationY ?? -50,
          },
          confidence: 0.97,
        },
        sdg_alignment: {
          sdg11: ["alerts_sent", "routes_computed", "resources_allocated"],
          sdg13: ["wind_used", "spread_predicted", "evac_window_minutes"],
          sdg3: ["vulnerable_count", "accessible_routes", "medical_deployed", "vitals_monitored"],
        },
        predictions: {
          wind: { direction: windDirection, speed_mps: windSpeed },
          spread_direction: "South",
          evac_window_minutes: 15,
          spread_map: { grid_size: 60, cells: spreadCells },
        },
        evacuation: {
          population_total: 700,
          vulnerable_total: 33,
          routes: routeSet,
          assembly_points: ["North Parking Lot", "South Field", "Medical Tent A", "Safe Zone Hilltop"],
        },
        resources: {
          ambulances_dispatched: ambulances.map((resource) => ({
            id: resource.id,
            name: resource.name,
            eta_minutes: 2,
          })),
          medical_teams_dispatched: medicalTeams.map((resource) => ({
            id: resource.id,
            name: resource.name,
            eta_minutes: 3,
          })),
          fire_response: ["Hydrant Grid 3 Enabled", "Containment Team Alpha Deployed"],
        },
        broadcast: {
          message: "FIRE IN ENGINEERING BLOCK. USE ASSIGNED ROUTE. EVACUATE NOW. SAFE WINDOW: 15 MIN.",
          target_count: 700,
          sent_count: 700,
          seen_count: 668,
          channels: ["push", "in_app"],
          urgency: "critical",
        },
        health_ops: {
          triage_summary: triage,
          monitoring_plan: "Vitals checks every 60 seconds for all vulnerable evacuees during movement.",
        },
        success_metrics: {
          evacuated_count: 700,
          time_minutes: 7,
          casualties: 0,
          vulnerable_prioritized: true,
        },
      };
    }),

  getHeatmap: publicProcedure.query(async () => {
    const zones = await getCampusZones();
    const incidents = await getActiveIncidents();

    return zones.map((zone) => {
      let maxSeverity = "info";
      for (const incident of incidents) {
        const distance = Math.sqrt(Math.pow(incident.locationX - zone.zoneX, 2) + Math.pow(incident.locationY - zone.zoneY, 2));

        // Physics-Aware Heatmap (SDG 13: Wind Factor)
        let windFactor = 1;
        if (incident.type === "fire" && incident.windDirection === "North") {
          // If wind is North, fire spreads South (+Y)
          const isSouthOfIncident = zone.zoneY > incident.locationY;
          if (isSouthOfIncident) windFactor = 2; // Severity doubles in wind direction
          else windFactor = 0.5; // Severity halved against wind
        }

        if (distance < zone.zoneRadius * 3 * windFactor) {
          if (incident.severity === "critical") maxSeverity = "critical";
          else if (incident.severity === "warning" && maxSeverity !== "critical") maxSeverity = "warning";
        }
      }
      return { id: zone.id, x: zone.zoneX, y: zone.zoneY, name: zone.name, severity: maxSeverity };
    });
  }),
});
