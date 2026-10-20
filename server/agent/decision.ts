import { invokeLLM, parseLLMJson } from "../_core/llm";
import { RetrievedKnowledge } from "./rag";

export interface DecisionResult {
  action: "evacuate" | "shelter" | "medical" | "rescue" | "optimize_transit" | "reoute_waste" | "manage_density";
  priority: "critical" | "warning" | "info";
  reasoning: string;
}

const ACTIONS: DecisionResult["action"][] = ["evacuate", "shelter", "medical", "rescue", "optimize_transit", "reoute_waste", "manage_density"];
const PRIORITIES: DecisionResult["priority"][] = ["critical", "warning", "info"];

/** Rule-based decision used when the LLM is unavailable (no API key / network / bad output). */
function heuristicDecision(incident: any): DecisionResult {
  const t = incident?.type;
  const action = t === "medical" ? "medical" : t === "flood" ? "shelter" : t === "fire" || t === "earthquake" ? "evacuate" : "rescue";
  const priority = PRIORITIES.includes(incident?.severity) ? incident.severity : "warning";
  return { action, priority, reasoning: `Rule-based fallback (AI unavailable): ${t ?? "unknown"} incident at ${priority} priority -> ${action}.` };
}

/**
 * Intelligent Decision Maker for SDG 11 Urban Resilience
 * Never throws: degrades to a rule-based decision.
 */
export async function makeDecision(
  incident: any,
  knowledge: RetrievedKnowledge
): Promise<DecisionResult> {
  try {
    const d = await llmDecision(incident, knowledge);
    if (!ACTIONS.includes(d?.action) || !PRIORITIES.includes(d?.priority)) throw new Error("Invalid LLM decision");
    return { ...d, reasoning: String(d.reasoning ?? "") };
  } catch (err) {
    console.warn("[Decision] LLM unavailable, using heuristic:", (err as Error).message);
    return heuristicDecision(incident);
  }
}

async function llmDecision(
  incident: any,
  knowledge: RetrievedKnowledge
): Promise<DecisionResult> {
  const systemPrompt = "You are an Urban Resilience AI for MRUH Campus (SDG 11 Focused). Your goal is to ensure sustainable city operations and safety. You evaluate incidents, transit flow, waste management, and housing density.";

  const userPrompt = `
INCIDENT/METRIC: ${JSON.stringify(incident)}
KNOWLEDGE: ${JSON.stringify(knowledge)}

Decide:
1. Primary action:
   - evacuate/rescue/medical/shelter (for emergencies)
   - optimize_transit (for traffic congestion or transport failures)
   - reoute_waste (for waste surge or collection optimization)
   - manage_density (for housing/occupancy stress)
2. Priority level based on severity and operational impact.
3. Provide reasoning focusing on SDG 11 targets (Safety, Sustainability, Efficiency).

Return valid JSON.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ] as any,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "agent_decision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["evacuate", "shelter", "medical", "rescue", "optimize_transit", "reoute_waste", "manage_density"],
            },
            priority: {
              type: "string",
              enum: ["critical", "warning", "info"],
            },
            reasoning: { type: "string" },
          },
          required: ["action", "priority", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");

  return parseLLMJson<DecisionResult>(content);
}
