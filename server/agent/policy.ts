import { invokeLLM, parseLLMJson } from "../_core/llm";

export interface PolicyBrief {
  title: string;
  recommendation: string;
  targetSDG: string;
  impactEstimate: string;
}

/**
 * Generates Urban Policy Briefs based on current simulation metrics
 */
export async function generatePolicyBrief(metrics: {
  waste: number;
  transit: number;
  density: number;
}): Promise<PolicyBrief> {
  try {
    return await llmPolicyBrief(metrics);
  } catch (err) {
    console.warn("[Policy] LLM unavailable, using template brief:", (err as Error).message);
    // Lowest-performing metric (density is "stress": lower is better only when low, so treat 100-density as health)
    const health = { waste: metrics.waste, transit: metrics.transit, density: 100 - metrics.density };
    const worst = (Object.keys(health) as Array<keyof typeof health>).sort((a, b) => health[a] - health[b])[0];
    const text = {
      waste: ["Smart Waste Routing", "Deploy IoT fill-level sensors and dynamic collection routes to lift waste efficiency.", "SDG 11.6"],
      transit: ["Adaptive Transit Flow", "Use real-time demand signals to retime shuttles and reduce congestion on campus corridors.", "SDG 11.2"],
      density: ["Occupancy Balancing", "Rebalance housing allocation and stagger usage to relieve density stress.", "SDG 11.1"],
    }[worst];
    return { title: text[0], recommendation: text[1], targetSDG: text[2], impactEstimate: "Estimated 10-15% improvement (template, AI unavailable)" };
  }
}

async function llmPolicyBrief(metrics: {
  waste: number;
  transit: number;
  density: number;
}): Promise<PolicyBrief> {
  const systemPrompt = "You are an Urban Policy Consultant for the MRUH Fortress (SDG 11). Your goal is to provide strategic, high-level policy recommendations based on urban health metrics.";

  const userPrompt = `
CURRENT METRICS:
- Waste Efficiency: ${metrics.waste}%
- Transit Flow: ${metrics.transit}%
- Housing Density: ${metrics.density}%

Generate one strategic policy recommendation to improve the lowest performing metric. Focus on aggressive, high-tech solutions (e.g., IoT, Blockchain, Autonomous systems).

Return valid JSON with keys: title, recommendation, targetSDG, impactEstimate.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ] as any,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "policy_brief",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            recommendation: { type: "string" },
            targetSDG: { type: "string" },
            impactEstimate: { type: "string" },
          },
          required: ["title", "recommendation", "targetSDG", "impactEstimate"],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");

  return parseLLMJson<PolicyBrief>(content);
}
