import { ENV } from "./env";

// Google AI API key for Gemini (fallback when Forge key is not set) — read lazily so late-loaded env still works
const googleAiKey = () => process.env.GOOGLE_AI_KEY;

/** Parse JSON from an LLM reply, tolerating ```json fences and surrounding prose. */
export function parseLLMJson<T = any>(content: unknown): T {
  const raw = typeof content === "string" ? content : JSON.stringify(content);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM returned non-JSON content");
    return JSON.parse(m[0]) as T;
  }
}

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const useGoogleAI = () => !ENV.forgeApiKey || ENV.forgeApiKey.trim().length === 0;

const resolveApiUrl = () => {
  if (useGoogleAI()) {
    // Use Google AI Studio's OpenAI-compatible endpoint
    return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  }
  return ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";
};

const resolveApiKey = () => {
  if (useGoogleAI()) return googleAiKey()?.trim();
  return ENV.forgeApiKey;
};

const MOCK_RESPONSES: Record<string, any> = {
  sensor_fusion: {
    confirmed: true,
    confidence: 0.97,
    fire_type: "structural",
    reasoning: "Smoke sensor at 87/100, temperature 340°C exceeds safety threshold. CCTV motion patterns confirmed human-sized thermal anomalies. Fire confirmed at origin."
  },
  spread_prediction: {
    spread_direction: "South",
    evac_window_minutes: 15,
    risk_zones: ["Science Block", "Library"],
    reasoning: "Wind vector North at 15 m/s detected. Terrain slopes downward towards the South, accelerating fire spread towards the Library and Science Block. 15-minute safety window identified."
  },
  evac_plan: {
    route_priorities: [
      { type: "fastest", reasoning: "Primary route for general population via North corridor.", eta_min: 4 },
      { type: "safest", reasoning: "Secondary route avoiding predicted smoke spread in South-East sector.", eta_min: 6 },
      { type: "accessible", reasoning: "Ramp-only route for 33 vulnerable citizens via West perimeter.", eta_min: 7 },
      { type: "low_crowd", reasoning: "Overflow route via Admin Block to prevent bottlenecking.", eta_min: 5 }
    ],
    assembly_points: ["North Parking Lot", "South Field", "Medical Tent A"],
    strategy: "Staged evacuation: Wave 1 (Critical) via West, Wave 2 (General) via North.",
    reasoning: "Prioritizing West-Perimeter (Accessible) for Wave 1 to clear bottleneck near origin. North-Corridor (Fastest) remains safe for Wave 2 general population."
  },
  triage: {
    wave_1_critical: 8,
    wave_2_priority: 12,
    wave_3_standard: 13,
    medical_stations_needed: 3,
    reasoning: "8 individuals identified with respiratory distress or mobility constraints near the origin. 12 elderly/pregnant residents prioritized for Wave 2."
  },
  resource_allocation: {
    ambulance_assignments: [
      { target_zone: "North Assembly", priority: "high" },
      { target_zone: "Medical Tent A", priority: "critical" }
    ],
    medical_team_assignments: [
      { target_zone: "West Perimeter", role: "triage" },
      { target_zone: "South Field", role: "first_aid" }
    ],
    fire_response_strategy: "Surround and Contain: Focus on stopping spread towards Science Block.",
    reasoning: "Allocating 2 ambulances to critical zones identified by VulnerabilityTriage. Fire trucks positioned to block Southward spread."
  },
  broadcast: {
    push_message: "🚨 FIRE: Engineering Block Floor 3. Evacuate IMMEDIATELY via assigned routes. Assembly at North/South fields. Safety window: 15 min.",
    detailed_message: "Critical fire detected. AI Incident Commander FireCommand has computed 4 safe routes. Follow digital signs. Do not use elevators.",
    do_not_list: ["Do not use elevators", "Do not return for belongings", "Do not panic"],
    urgency: "critical"
  }
};

const assertApiKey = () => {
  const key = resolveApiKey();
  if (!key) {
    throw new Error("No API key configured. Set BUILT_IN_FORGE_API_KEY or GOOGLE_AI_KEY.");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const schemaName = params.response_format?.type === 'json_schema' ? params.response_format.json_schema.name : null;
  if (process.env.DEMO_MODE === 'true' && schemaName && MOCK_RESPONSES[schemaName]) {
    console.log(`[LLM MOCK] Returning mock response for: ${schemaName}`);
    return {
      id: "mock-id",
      created: Date.now(),
      model: "mock-model",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(MOCK_RESPONSES[schemaName])
        },
        finish_reason: "stop"
      }]
    };
  }

  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const isGoogle = useGoogleAI();
  const modelName = isGoogle ? (process.env.GEMINI_MODEL || 'gemini-2.0-flash') : 'gemini-2.5-flash';

  const payload: Record<string, unknown> = {
    model: modelName,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = 8192;
  if (!isGoogle) {
    payload.thinking = { budget_tokens: 128 };
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  console.log(`[LLM] Calling ${modelName} via ${isGoogle ? 'Google AI' : 'Forge'}...`);

  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resolveApiKey()}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000), // a hung upstream must not stall the orchestration loop
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
