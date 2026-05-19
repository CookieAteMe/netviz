import type { FlowSnapshot } from "@/lib/storage";
import type { AppNode, LabeledEdge, ShapeKind } from "@/store/flow-store";

// ---------------------------------------------------------------------------
// SVG import — extracts basic shapes from SVG files
//
// Limitations:
// - Only detects <rect>, <circle>, <ellipse>, <text>, <line> elements
// - Does NOT handle SVG transforms (assumes translate-only)
// - Does NOT extract edges/arrows from SVG paths
// - Complex SVGs (icons, detailed illustrations) will not import well
// ---------------------------------------------------------------------------

export function importSvgFile(file: File): Promise<FlowSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseSvgText(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function parseSvgText(svgText: string): FlowSnapshot {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.tagName !== "svg") throw new Error("Not an SVG file");

  const nodes: AppNode[] = [];
  const edges: LabeledEdge[] = [];

  let ox = 0, oy = 0;
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4) { ox = parts[0]; oy = parts[1]; }
  }

  // <rect> → shape nodes (rectangle)
  for (const el of svg.querySelectorAll("rect")) {
    if (inDefsOrInvisible(el)) continue;
    const a = readAttrs(el);
    const x = (n(a.x) ?? 0) - ox;
    const y = (n(a.y) ?? 0) - oy;
    const w = n(a.width) ?? 0;
    const h = n(a.height) ?? 0;
    if (w < 5 || h < 5) continue;

    nodes.push({
      id: genId("n"),
      type: "shape",
      position: { x, y },
      style: { width: w, height: h },
      zIndex: 0,
      data: {
        shape: "rectangle" as ShapeKind,
        label: siblingText(el),
        bgColor: s(a.fill) && a.fill !== "none" ? a.fill : undefined,
        borderColor: s(a.stroke) && a.stroke !== "none" ? a.stroke : undefined,
        borderRadius: a.rx ? Math.min(n(a.rx) ?? 0, 12) : undefined,
      },
    } as AppNode);
  }

  // <circle>, <ellipse> → shape nodes (circle)
  for (const el of svg.querySelectorAll("circle, ellipse")) {
    if (inDefsOrInvisible(el)) continue;
    const a = readAttrs(el);
    let x: number, y: number, w: number, h: number;

    if (el.tagName.toLowerCase() === "circle") {
      const cx = (n(a.cx) ?? 0) - ox;
      const cy = (n(a.cy) ?? 0) - oy;
      const r = n(a.r) ?? 20;
      x = cx - r; y = cy - r;
      w = r * 2; h = r * 2;
    } else {
      const cx = (n(a.cx) ?? 0) - ox;
      const cy = (n(a.cy) ?? 0) - oy;
      const rx = n(a.rx) ?? 20;
      const ry = n(a.ry) ?? 20;
      x = cx - rx; y = cy - ry;
      w = rx * 2; h = ry * 2;
    }
    if (w < 5 || h < 5) continue;

    nodes.push({
      id: genId("n"),
      type: "shape",
      position: { x, y },
      style: { width: w, height: h },
      zIndex: 0,
      data: {
        shape: "circle" as ShapeKind,
        label: siblingText(el),
        bgColor: s(a.fill) && a.fill !== "none" ? a.fill : undefined,
        borderColor: s(a.stroke) && a.stroke !== "none" ? a.stroke : undefined,
      },
    } as AppNode);
  }

  // <text> → text nodes (only standalone text, not inside shape groups)
  for (const el of svg.querySelectorAll("text")) {
    if (inDefsOrInvisible(el)) continue;
    if (hasShapeSibling(el)) continue;
    const a = readAttrs(el);
    const x = (n(a.x) ?? 0) - ox;
    const y = (n(a.y) ?? 0) - oy;
    const text = el.textContent?.trim();
    if (!text) continue;

    nodes.push({
      id: genId("n"),
      type: "text",
      position: { x, y: y - 10 },
      zIndex: 1,
      data: {
        text,
        titleColor: s(a.fill) && a.fill !== "#000000" && a.fill !== "none"
          ? a.fill : undefined,
      },
    } as AppNode);
  }

  // <line> → edges
  for (const el of svg.querySelectorAll("line")) {
    if (inDefsOrInvisible(el)) continue;
    const a = readAttrs(el);
    const x1 = (n(a.x1) ?? 0) - ox;
    const y1 = (n(a.y1) ?? 0) - oy;
    const x2 = (n(a.x2) ?? 0) - ox;
    const y2 = (n(a.y2) ?? 0) - oy;
    const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (len < 20) continue;

    const sourceId = anchorNode(nodes, x1, y1);
    const targetId = anchorNode(nodes, x2, y2);

    edges.push({
      id: genId("e"),
      source: sourceId,
      target: targetId,
      type: "labeled",
      data: {
        color: s(a.stroke) && a.stroke !== "none" ? a.stroke : "#94a3b8",
        lineStyle: a.strokeDasharray ? "dashed" : "solid",
      },
    } as LabeledEdge);
  }

  return { version: 1, nodes, edges, customBlocks: [], groups: [] } satisfies FlowSnapshot;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nodeSeq = 0;
const genId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

function inDefsOrInvisible(el: Element): boolean {
  return !!(
    el.closest("defs") ||
    el.closest("clipPath") ||
    el.closest("pattern") ||
    el.closest("mask") ||
    el.closest("symbol")
  );
}

function hasShapeSibling(el: Element): boolean {
  const p = el.parentElement;
  if (!p) return false;
  return !!p.querySelector("rect, circle, ellipse");
}

function siblingText(el: Element): string | undefined {
  const p = el.parentElement;
  if (!p) return undefined;
  return p.querySelector("text")?.textContent?.trim() || undefined;
}

/** Read SVG attributes, keeping all values as strings */
function readAttrs(el: Element): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const attr of el.attributes) {
    out[attr.name] = attr.value;
  }
  return out;
}

function n(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const num = Number(v);
  return isFinite(num) ? num : undefined;
}

function s(v: string | undefined): string | undefined {
  return v && v !== "none" ? v : undefined;
}

function anchorNode(nodes: AppNode[], x: number, y: number): string {
  for (const n of nodes) {
    const s = n.style as { width?: number; height?: number } | undefined;
    const w = s?.width ?? 20;
    const h = s?.height ?? 20;
    if (Math.abs(x - n.position.x - w / 2) < 5 && Math.abs(y - n.position.y - h / 2) < 5) {
      return n.id;
    }
  }
  const id = genId("n");
  nodes.push({
    id,
    type: "shape",
    position: { x: x - 4, y: y - 4 },
    style: { width: 8, height: 8 },
    zIndex: 0,
    data: { shape: "circle" as ShapeKind, bgColor: "#94a3b8", borderColor: "#64748b" },
  } as AppNode);
  return id;
}
