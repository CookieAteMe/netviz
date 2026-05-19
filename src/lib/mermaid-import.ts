import type { FlowSnapshot } from "@/lib/storage";
import type { AppNode, LabeledEdge, ShapeKind } from "@/store/flow-store";

// ---------------------------------------------------------------------------
// Basic Mermaid flowchart parser
//
// Supported syntax:
//   flowchart TD|LR
//     Node1[Label]
//     Node2{Decision}
//     Node3>Asymmetric]
//     Node1 --> Node2
//     Node1 -->|edge label| Node3
//
// Limitations:
//   - Only flowchart diagrams (not sequence, gantt, etc.)
//   - No subgraph support
//   - No styling/class support
// ---------------------------------------------------------------------------

export function importMermaidFile(file: File): Promise<FlowSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseMermaidText(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function parseMermaidText(text: string): FlowSnapshot {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%") && !l.startsWith("---"));

  // Detect diagram type
  const dirLine = lines.find((l) => /^(graph|flowchart)\s+(TD|LR|BT|RL)$/i.test(l));
  if (!dirLine) {
    throw new Error("Unsupported or missing diagram type. Only flowchart TD/LR/RL/BT is supported.");
  }

  const direction = dirLine.split(/\s+/)[1].toUpperCase();
  const isHorizontal = direction === "LR" || direction === "RL";

  const nodes: AppNode[] = [];
  const edges: LabeledEdge[] = [];
  const nodeDefs = new Map<string, { label: string; shape: string }>();

  // First pass: collect node definitions
  for (const line of lines) {
    const nodeMatch = line.match(/^(\w[\w-]*)\s*(\[[^\]]*\]|\{[^}]*\}|\([^)]*\)|>[\s\S]*?\])/);
    if (nodeMatch) {
      const id = nodeMatch[1];
      const raw = nodeMatch[2];
      const { label, shape } = parseMermaidShape(raw);
      nodeDefs.set(id, { label, shape });
    }
  }

  // Second pass: collect edges and implicit nodes
  for (const line of lines) {
    const edgeMatch = line.match(
      /^(\w[\w-]*)\s*(=?>|-->|==>|-\.->|---?)\s*(?:\|([^|]*)\|)?\s*(\w[\w-]*)/
    );
    if (edgeMatch) {
      const srcId = edgeMatch[1];
      const edgeStyle = edgeMatch[2];
      const edgeLabel = edgeMatch[3]?.trim() || undefined;
      const tgtId = edgeMatch[4];

      // Ensure source/target nodes exist
      for (const id of [srcId, tgtId]) {
        if (!nodeDefs.has(id)) {
          nodeDefs.set(id, { label: id, shape: "rect" });
        }
      }

      const dashed = edgeStyle === "-.->" || edgeStyle === "-.-";
      const thick = edgeStyle === "==>";

      edges.push({
        id: genId("e"),
        source: srcId,
        target: tgtId,
        type: "labeled",
        data: {
          label: edgeLabel,
          color: thick ? "#3b82f6" : "#94a3b8",
          lineStyle: dashed ? "dashed" : "solid",
          arrowEnd: true,
          arrowEndShape: "triangle",
          arrowStart: false,
        },
      } as LabeledEdge);
    }
  }

  // Layout nodes in a grid
  const ids = Array.from(nodeDefs.keys());
  const spacingX = 220;
  const spacingY = 140;
  const startX = 40;
  const startY = 40;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const def = nodeDefs.get(id)!;
    const isCircle = def.shape === "diamond";
    const col = isHorizontal ? i : 0;
    const row = isHorizontal ? 0 : i;

    nodes.push({
      id,
      type: "shape",
      position: {
        x: startX + col * spacingX,
        y: startY + row * spacingY,
      },
      style: { width: isCircle ? 80 : 160, height: isCircle ? 80 : 50 },
      zIndex: 0,
      data: {
        shape: (isCircle ? "circle" : "rectangle") as ShapeKind,
        label: def.label,
        bgColor: isCircle ? undefined : "#eef2ff",
        borderColor: "#6366f1",
      },
    } as AppNode);
  }

  return { version: 1, nodes, edges, customBlocks: [], groups: [] } satisfies FlowSnapshot;
}

let nodeSeq = 0;
const genId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

function parseMermaidShape(raw: string): { label: string; shape: string } {
  const content = raw.slice(1, -1).trim();
  if (raw.startsWith("[")) return { label: content, shape: "rect" };
  if (raw.startsWith("{")) return { label: content, shape: "diamond" };
  if (raw.startsWith("(")) return { label: content, shape: "rounded" };
  if (raw.startsWith(">")) return { label: content, shape: "asymmetric" };
  return { label: content, shape: "rect" };
}
