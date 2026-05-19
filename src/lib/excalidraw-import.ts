import type { FlowSnapshot } from "@/lib/storage";
import type { AppNode, LabeledEdge, ShapeKind, ArrowShape } from "@/store/flow-store";

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roundness: { type: number } | null;
  roughness: number;
  opacity: number;
  groupIds: string[];
  boundElements: { type: string; id: string }[] | null;
  isDeleted: boolean;
  text?: string;
  containerId?: string;
  points?: [number, number][];
  startArrowhead: string | null;
  endArrowhead: string | null;
}

interface ExcalidrawFile {
  type: string;
  elements: ExcalidrawElement[];
}

export function importExcalidrawFile(file: File): Promise<FlowSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as ExcalidrawFile;
        resolve(convertExcalidraw(data));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

let nodeSeq = 0;
const genId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

function convertExcalidraw(data: ExcalidrawFile): FlowSnapshot {
  const elements = data.elements?.filter((e) => !e.isDeleted) ?? [];

  const textElements = new Map<string, ExcalidrawElement>();
  const shapeElements: ExcalidrawElement[] = [];
  const arrowElements: ExcalidrawElement[] = [];

  for (const el of elements) {
    if (el.type === "text") {
      textElements.set(el.id, el);
    } else if (el.type === "arrow" || el.type === "line") {
      arrowElements.push(el);
    } else if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
      shapeElements.push(el);
    }
  }

  const nodeIdMap = new Map<string, string>();
  const nodes: AppNode[] = [];
  const edges: LabeledEdge[] = [];

  for (const el of shapeElements) {
    const newId = genId("n");
    nodeIdMap.set(el.id, newId);

    const label = getBoundText(el, textElements);

    if (el.type === "ellipse") {
      nodes.push({
        id: newId,
        type: "shape",
        position: { x: el.x, y: el.y },
        style: { width: Math.max(el.width, 40), height: Math.max(el.height, 40) },
        zIndex: 0,
        data: {
          shape: "circle" as ShapeKind,
          label,
          bgColor: el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
          borderColor: el.strokeColor !== "#000000" ? el.strokeColor : undefined,
          borderWidth: el.strokeWidth,
          borderStyle: el.strokeStyle === "dashed" || el.strokeStyle === "dotted"
            ? el.strokeStyle : ("solid" as const),
        },
      } as AppNode);
    } else {
      nodes.push({
        id: newId,
        type: "shape",
        position: { x: el.x, y: el.y },
        style: { width: Math.max(el.width, 20), height: Math.max(el.height, 20) },
        zIndex: 0,
        data: {
          shape: "rectangle" as ShapeKind,
          label,
          bgColor: el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
          borderColor: el.strokeColor !== "#000000" ? el.strokeColor : undefined,
          borderWidth: el.strokeWidth,
          borderRadius: el.roundness?.type === 3 ? 8 : undefined,
          borderStyle: el.strokeStyle === "dashed" || el.strokeStyle === "dotted"
            ? el.strokeStyle : ("solid" as const),
        },
      } as AppNode);
    }
  }

  // Standalone text elements (not bound to shapes)
  for (const el of textElements.values()) {
    const isBoundToShape = shapeElements.some((s) =>
      s.boundElements?.some((be) => be.id === el.id)
    );
    const isBoundToArrow = arrowElements.some((a) =>
      a.boundElements?.some((be) => be.id === el.id)
    );
    if (isBoundToShape || isBoundToArrow) continue;

    const newId = genId("n");
    nodeIdMap.set(el.id, newId);
    nodes.push({
      id: newId,
      type: "text",
      position: { x: el.x, y: el.y },
      zIndex: 1,
      data: {
        text: el.text ?? "",
        titleColor: el.strokeColor !== "#000000" ? el.strokeColor : undefined,
      },
    } as AppNode);
  }

  // Arrows → edges
  for (const el of arrowElements) {
    if (!el.points || el.points.length < 2) continue;

    const startPt = el.points[0];
    const endPt = el.points[el.points.length - 1];
    const absStartX = el.x + startPt[0];
    const absStartY = el.y + startPt[1];
    const absEndX = el.x + endPt[0];
    const absEndY = el.y + endPt[1];

    let sourceId = findNodeIdAt(nodes, absStartX, absStartY);
    let targetId = findNodeIdAt(nodes, absEndX, absEndY);

    if (!sourceId) {
      sourceId = genId("n");
      nodes.push({
        id: sourceId,
        type: "shape",
        position: { x: absStartX - 4, y: absStartY - 4 },
        style: { width: 8, height: 8 },
        zIndex: 0,
        data: { shape: "circle" as ShapeKind, bgColor: "#94a3b8", borderColor: "#64748b" },
      } as AppNode);
    }
    if (!targetId) {
      targetId = genId("n");
      nodes.push({
        id: targetId,
        type: "shape",
        position: { x: absEndX - 4, y: absEndY - 4 },
        style: { width: 8, height: 8 },
        zIndex: 0,
        data: { shape: "circle" as ShapeKind, bgColor: "#94a3b8", borderColor: "#64748b" },
      } as AppNode);
    }

    const label = getBoundText(el, textElements);

    edges.push({
      id: genId("e"),
      source: sourceId,
      target: targetId,
      type: "labeled",
      data: {
        label,
        color: el.strokeColor !== "#000000" ? el.strokeColor : "#94a3b8",
        lineStyle: el.strokeStyle === "dashed" || el.strokeStyle === "dotted"
          ? el.strokeStyle : ("solid" as const),
        arrowEnd: el.endArrowhead !== null,
        arrowStart: el.startArrowhead !== null,
        arrowEndShape: mapArrowhead(el.endArrowhead),
        arrowStartShape: mapArrowhead(el.startArrowhead),
      },
    } as LabeledEdge);
  }

  return { version: 1, nodes, edges, customBlocks: [], groups: [] } satisfies FlowSnapshot;
}

function getBoundText(
  el: ExcalidrawElement,
  textElements: Map<string, ExcalidrawElement>
): string | undefined {
  if (!el.boundElements) return undefined;
  for (const be of el.boundElements) {
    if (be.type === "text") {
      const te = textElements.get(be.id);
      if (te?.text) return te.text.trim();
    }
  }
  return undefined;
}

function findNodeIdAt(nodes: AppNode[], x: number, y: number): string | undefined {
  let best: AppNode | undefined;
  let bestArea = Infinity;
  for (const n of nodes) {
    const s = n.style as { width?: number; height?: number } | undefined;
    const w = s?.width ?? 0;
    const h = s?.height ?? 0;
    if (w <= 0 || h <= 0) continue;
    if (x >= n.position.x && x <= n.position.x + w && y >= n.position.y && y <= n.position.y + h) {
      const area = w * h;
      if (area < bestArea) { bestArea = area; best = n; }
    }
  }
  return best?.id;
}

function mapArrowhead(head: string | null): ArrowShape | undefined {
  switch (head) {
    case "arrow": case "triangle": return "triangle";
    case "bar": return "bar";
    case "dot": return "circle";
    default: return undefined;
  }
}
