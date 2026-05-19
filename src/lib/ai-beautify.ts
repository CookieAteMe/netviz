import type { AppNode, LabeledEdge } from "@/store/flow-store";
import { ACCENT_CLASSES, type Accent } from "@/blocks/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export type AiBeautifyLayout = Record<string, { x: number; y: number }>;
export type AiBeautifyStyle = Record<string, { accent?: Accent; bgColor?: string; borderColor?: string }>;
export type AiBeautifyEdgeData = Record<string, { color?: string; label?: string }>;

export type AiBeautifyResult = {
  layout: AiBeautifyLayout;
  style?: AiBeautifyStyle;
  edges?: AiBeautifyEdgeData;
  summary?: string;
};

export type BeautifyDiffEntry = {
  nodeId?: string;
  edgeId?: string;
  field: string;
  from: unknown;
  to: unknown;
};

const AI_CONFIG_KEY = "netviz-ai-config";
const LLM_HISTORY_KEY = "netviz-llm-history";
const MAX_LLM_HISTORY = 50;

// ---------------------------------------------------------------------------
// LLM call history (tracks which endpoints/models were used)
// ---------------------------------------------------------------------------

export type LlmCallRecord = {
  id: string;
  timestamp: number;
  endpoint: string;
  model: string;
  apiKeyPrefix: string;
};

export function maskApiKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 4) + "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export function loadLlmHistory(): LlmCallRecord[] {
  try {
    const raw = localStorage.getItem(LLM_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LlmCallRecord[];
  } catch {
    return [];
  }
}

export function addLlmHistory(record: LlmCallRecord): void {
  const history = loadLlmHistory();
  history.unshift(record);
  if (history.length > MAX_LLM_HISTORY) history.length = MAX_LLM_HISTORY;
  localStorage.setItem(LLM_HISTORY_KEY, JSON.stringify(history));
}

export function clearLlmHistory(): void {
  localStorage.removeItem(LLM_HISTORY_KEY);
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

export function saveAiConfig(config: AiConfig): void {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
}

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AiConfig;
  } catch {
    return null;
  }
}

export function clearAiConfig(): void {
  localStorage.removeItem(AI_CONFIG_KEY);
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a diagram layout optimizer. Given a list of nodes and edges from a network/architecture diagram, return a JSON object that improves the layout.

Rules:
1. Return ONLY a JSON object with NO markdown fences or extra text.
2. Every node ID in the response must match an existing node ID from the input.
3. For "layout": position nodes in a clean hierarchical/topological layout. Group related nodes close together. Use 200px horizontal spacing and 120px vertical spacing as default.
4. For "style": assign accent colors ("slate","red","orange","amber","yellow","lime","emerald","teal","cyan","sky","blue","indigo","violet","fuchsia","pink") to nodes. Nodes in the same layer/subgraph should share the same accent color. Set bgColor as a subtle hex (light) and borderColor as the full accent hex. ONLY use accent values from this list — no others.
5. For "edges": optionally adjust edge colors to match connected node accents.
6. Keep "summary" brief (under 100 chars).

Response format:
{
  "layout": { "<nodeId>": { "x": number, "y": number }, ... },
  "style": { "<nodeId>": { "accent": "blue", "bgColor": "#eff6ff", "borderColor": "#3b82f6" }, ... },
  "edges": { "<edgeId>": { "color": "#94a3b8" }, ... },
  "summary": "Reorganized into 3 layers with consistent spacing and accent colors"
}`;

function serializeNodes(nodes: AppNode[]): string {
  return JSON.stringify(
    nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: getDisplayLabel(n),
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      w: (n.style as { width?: number })?.width ?? 200,
      h: (n.style as { height?: number })?.height ?? 60,
      accent: (n.data as { accent?: string }).accent,
      connections: [],
    }))
  );
}

function serializeEdges(edges: LabeledEdge[]): string {
  return JSON.stringify(
    edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.label,
      color: e.data?.color,
    }))
  );
}

function getDisplayLabel(n: AppNode): string {
  switch (n.type) {
    case "infra":
      return n.data.label || "";
    case "shape":
      return n.data.label || "";
    case "text":
      return n.data.text || "";
    case "step":
      return n.data.label || `Step ${n.data.step}`;
    case "tunnel":
      return n.data.label || "";
    case "code":
      return n.data.label || "";
    default:
      return "";
  }
}

export function buildPrompt(nodes: AppNode[], edges: LabeledEdge[]): string {
  return [
    SYSTEM_PROMPT,
    "",
    "Nodes:",
    serializeNodes(nodes),
    "",
    "Edges:",
    serializeEdges(edges),
    "",
    "Respond using the JSON format described above.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

export async function callAiBeautify(
  config: AiConfig,
  nodes: AppNode[],
  edges: LabeledEdge[]
): Promise<AiBeautifyResult> {
  const prompt = buildPrompt(nodes, edges);

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`AI API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned empty response");
  }

  return JSON.parse(content) as AiBeautifyResult;
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

export function computeDiff(
  nodes: AppNode[],
  edges: LabeledEdge[],
  result: AiBeautifyResult
): BeautifyDiffEntry[] {
  const diffs: BeautifyDiffEntry[] = [];

  if (result.layout) {
    for (const node of nodes) {
      const pos = result.layout[node.id];
      if (!pos) continue;
      const fx = Math.round(node.position.x);
      const fy = Math.round(node.position.y);
      if (Math.round(pos.x) !== fx || Math.round(pos.y) !== fy) {
        diffs.push({
          nodeId: node.id,
          field: "position",
          from: { x: node.position.x, y: node.position.y },
          to: { x: pos.x, y: pos.y },
        });
      }
    }
  }

  if (result.style) {
    for (const node of nodes) {
      const style = result.style[node.id];
      if (!style) continue;
      const currentAccent = (node.data as { accent?: string }).accent;
      if (style.accent && style.accent !== currentAccent) {
        diffs.push({
          nodeId: node.id,
          field: "accent",
          from: currentAccent,
          to: style.accent,
        });
      }
    }
  }

  if (result.edges) {
    for (const edge of edges) {
      const ed = result.edges[edge.id];
      if (!ed) continue;
      if (ed.color && ed.color !== edge.data?.color) {
        diffs.push({
          edgeId: edge.id,
          field: "color",
          from: edge.data?.color,
          to: ed.color,
        });
      }
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Apply result to current state
// ---------------------------------------------------------------------------

export function applyResult(
  nodes: AppNode[],
  edges: LabeledEdge[],
  result: AiBeautifyResult
): { nodes: AppNode[]; edges: LabeledEdge[] } {
  const newNodes = structuredClone(nodes) as AppNode[];
  const newEdges = structuredClone(edges) as LabeledEdge[];

  if (result.layout) {
    for (const node of newNodes) {
      const pos = result.layout[node.id];
      if (pos) {
        node.position = { x: pos.x, y: pos.y };
      }
    }
  }

  if (result.style) {
    const validAccents = new Set(Object.keys(ACCENT_CLASSES));
    for (const node of newNodes) {
      const style = result.style[node.id];
      if (style) {
        const data = node.data as Record<string, unknown>;
        if (style.accent && validAccents.has(style.accent)) data.accent = style.accent;
        if (style.bgColor) data.bgColor = style.bgColor;
        if (style.borderColor) data.borderColor = style.borderColor;
      }
    }
  }

  if (result.edges) {
    for (const edge of newEdges) {
      const ed = result.edges[edge.id];
      if (ed) {
        if (ed.color) edge.data = { ...edge.data, color: ed.color };
        if (ed.label !== undefined) edge.data = { ...edge.data, label: ed.label };
      }
    }
  }

  return { nodes: newNodes, edges: newEdges };
}
