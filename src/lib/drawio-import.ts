import type { FlowSnapshot } from "@/lib/storage";
import type {
  AppNode,
  LabeledEdge,
  ShapeKind,
  ArrowShape,
  EdgeLineStyle,
} from "@/store/flow-store";

// ---------------------------------------------------------------------------
// Types for parsed draw.io model
// ---------------------------------------------------------------------------

interface DrawioCell {
  id: string;
  value: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent: string;
  source?: string;
  target?: string;
  geometry: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    relative?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function importDrawioFile(file: File): Promise<FlowSnapshot> {
  const text = await file.text();
  return parseDrawioContent(text);
}

export async function parseDrawioContent(xmlText: string): Promise<FlowSnapshot> {
  const outerDoc = parseXml(xmlText);

  // Find the first <diagram>
  const diagramEl = outerDoc.querySelector("diagram");
  if (!diagramEl) throw new Error("No <diagram> element found in .drawio file");

  let innerXml: string;

  // The diagram content may be compressed (base64) or raw XML
  const raw = diagramEl.innerHTML.trim();
  if (raw.startsWith("<")) {
    innerXml = raw;
  } else {
    // Compressed — base64 → inflate → URI-decode
    innerXml = await decompressDiagram(raw);
  }

  return convertGraphXml(innerXml);
}

// ---------------------------------------------------------------------------
// Decompress base64 + deflate (draw.io compressed format)
// ---------------------------------------------------------------------------

async function decompressDiagram(encoded: string): Promise<string> {
  let raw: string;
  try {
    raw = await decompressWithStream(encoded);
  } catch {
    // Fallback: just base64-decode (some draw.io files use plain base64)
    raw = decodeBase64ToString(encoded);
  }

  // Draw.io may apply encodeURIComponent before compression
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function decompressWithStream(encoded: string): Promise<string> {
  const bytes = base64ToBytes(encoded);

  // Try standard deflate (zlib header) first, fall back to deflate-raw
  let result: Uint8Array;
  try {
    result = await inflate(bytes, "deflate");
  } catch {
    result = await inflate(bytes, "deflate-raw");
  }

  return new TextDecoder().decode(result);
}

async function inflate(
  data: Uint8Array,
  format: CompressionFormat
): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  await writer.write(data.buffer as ArrayBuffer);
  await writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Convert the inner mxGraphModel XML to a FlowSnapshot
// ---------------------------------------------------------------------------

let nodeSeq = 0;
const genId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

function convertGraphXml(graphXml: string): FlowSnapshot {
  const doc = parseXml(graphXml);

  // Root is either <mxGraphModel> directly, or wrapped in <root>
  const root =
    doc.querySelector("mxGraphModel > root") ??
    doc.querySelector("root") ??
    doc.documentElement;

  const cellEls = Array.from(root.children).filter(
    (el) => el.tagName === "mxCell"
  );

  // Parse all cells first for reference
  const allCells: DrawioCell[] = cellEls.map(parseCellElement);

  // Separate vertices from edges (only top-level cells — parent="1")
  const vertexCells = allCells.filter((c) => c.vertex && c.parent === "1");
  const edgeCells = allCells.filter((c) => c.edge && c.parent === "1");

  // Build id mapping (draw.io id → NetViz id)
  const nodeIdMap = new Map<string, string>();

  const nodes: AppNode[] = [];
  const edges: LabeledEdge[] = [];

  // Convert vertices
  for (const cell of vertexCells) {
    const netvizId = genId("n");
    nodeIdMap.set(cell.id, netvizId);
    const node = convertVertex(cell, netvizId);
    if (node) nodes.push(node);
  }

  // Convert edges
  for (const cell of edgeCells) {
    const sourceId = nodeIdMap.get(cell.source ?? "");
    const targetId = nodeIdMap.get(cell.target ?? "");
    if (!sourceId || !targetId) continue;
    const edge = convertEdge(cell, sourceId, targetId);
    if (edge) edges.push(edge);
  }

  return {
    version: 1,
    nodes,
    edges,
    customBlocks: [],
    groups: [],
  } satisfies FlowSnapshot;
}

// ---------------------------------------------------------------------------
// Parse a single <mxCell> element
// ---------------------------------------------------------------------------

function parseCellElement(el: Element): DrawioCell {
  const geometryEl = el.querySelector("mxGeometry");
  return {
    id: el.getAttribute("id") ?? "",
    value: el.getAttribute("value") ?? "",
    style: el.getAttribute("style") ?? "",
    vertex: el.getAttribute("vertex") === "1",
    edge: el.getAttribute("edge") === "1",
    parent: el.getAttribute("parent") ?? "",
    source: el.getAttribute("source") ?? undefined,
    target: el.getAttribute("target") ?? undefined,
    geometry: {
      x: geometryEl ? num(geometryEl.getAttribute("x")) : undefined,
      y: geometryEl ? num(geometryEl.getAttribute("y")) : undefined,
      width: geometryEl ? num(geometryEl.getAttribute("width")) : undefined,
      height: geometryEl ? num(geometryEl.getAttribute("height")) : undefined,
      relative: geometryEl?.getAttribute("relative") === "1",
    },
  };
}

// ---------------------------------------------------------------------------
// Convert a draw.io vertex to a NetViz node
// ---------------------------------------------------------------------------

function convertVertex(cell: DrawioCell, newId: string): AppNode | null {
  const style = parseDrawioStyle(cell.style);

  const g = cell.geometry;
  const x = g.x ?? 0;
  const y = g.y ?? 0;
  const w = g.width ?? 120;
  const h = g.height ?? 60;

  const bgColor = style.fillColor ? normalizeColor(style.fillColor) : undefined;
  const borderColor = style.strokeColor
    ? normalizeColor(style.strokeColor)
    : undefined;
  const titleColor = style.fontColor
    ? normalizeColor(style.fontColor)
    : undefined;
  const label = cell.value ? stripHtml(cell.value).trim() : undefined;
  const borderRadius = style.rounded === "1" ? 8 : undefined;
  const borderWidth = style.strokeWidth
    ? parseInt(style.strokeWidth, 10)
    : undefined;

  // Determine shape type
  const shape = style.shape ?? "rectangle";

  // Detect text-only nodes (no fill, no stroke, or explicit text shape)
  const isText =
    shape === "text" ||
    (shape === "rectangle" &&
      !bgColor &&
      !borderColor &&
      label &&
      !style.fillColor &&
      !style.strokeColor &&
      (style.whiteSpace === "wrap" || style.html === "1"));

  if (isText) {
    return {
      id: newId,
      type: "text",
      position: { x, y },
      zIndex: 1,
      data: {
        text: label || "Text",
        titleColor,
      },
    } as AppNode;
  }

  // Circle/ellipse → shape node (circle)
  if (shape === "ellipse" || shape === "circle") {
    return {
      id: newId,
      type: "shape",
      position: { x, y },
      style: { width: Math.max(w, 40), height: Math.max(h, 40) },
      zIndex: 0,
      data: {
        shape: "circle" as ShapeKind,
        label,
        bgColor,
        borderColor,
        titleColor,
        borderRadius,
        borderWidth,
        borderStyle: style.dashed === "1" ? "dashed" : "solid",
      },
    } as AppNode;
  }

  // Default: rectangle shape node
  return {
    id: newId,
    type: "shape",
    position: { x, y },
    style: { width: Math.max(w, 20), height: Math.max(h, 20) },
    zIndex: 0,
    data: {
      shape: "rectangle" as ShapeKind,
      label,
      bgColor,
      borderColor,
      titleColor,
      borderRadius,
      borderWidth,
      borderStyle: style.dashed === "1" ? "dashed" : "solid",
    },
  } as AppNode;
}

// ---------------------------------------------------------------------------
// Convert a draw.io edge to a NetViz LabeledEdge
// ---------------------------------------------------------------------------

function convertEdge(
  cell: DrawioCell,
  sourceId: string,
  targetId: string
): LabeledEdge | null {
  const style = parseDrawioStyle(cell.style);

  const label = cell.value ? stripHtml(cell.value).trim() : undefined;

  const color = style.strokeColor
    ? normalizeColor(style.strokeColor)
    : "#94a3b8";

  const lineStyle: EdgeLineStyle =
    style.dashed === "1" ? "dashed" : "solid";

  const dashGap = style.dashPattern
    ? parseInt(style.dashPattern.split(" ")[0] ?? "6", 10)
    : 6;

  // Arrow mapping
  const endArrow = mapArrow(style.endArrow);
  const startArrow = mapArrow(style.startArrow);

  const arrowEnd = endArrow !== undefined;
  const arrowStart = startArrow !== undefined;

  return {
    id: genId("e"),
    source: sourceId,
    target: targetId,
    type: "labeled",
    data: {
      label,
      color,
      lineStyle,
      dashGap,
      arrowEnd,
      arrowStart,
      arrowEndShape: endArrow,
      arrowStartShape: startArrow,
    },
  } as LabeledEdge;
}

// ---------------------------------------------------------------------------
// Draw.io arrow → NetViz ArrowShape
// ---------------------------------------------------------------------------

function mapArrow(arrow?: string): ArrowShape | undefined {
  switch (arrow) {
    case "classic":
    case "classicThin":
    case "block":
    case "blockThin":
      return "triangle";
    case "open":
    case "openThin":
    case "openBlock":
    case "openBlockThin":
      return "open";
    case "oval":
    case "ovalThin":
    case "circle":
    case "circlePlus":
      return "circle";
    case "diamond":
    case "diamondThin":
    case "openDiamond":
      return "diamond";
    case "dash":
      return "bar";
    case "none":
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseXml(text: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    throw new Error("Invalid XML: " + err.textContent);
  }
  return doc;
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

/** Parse a draw.io style string into a key-value map */
function parseDrawioStyle(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!style) return result;
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      result[trimmed] = "1";
    } else {
      result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  return result;
}

/** Strip HTML tags and decode common entities */
function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ");
}

/** Normalize hex color (ensure # prefix) */
function normalizeColor(color: string): string {
  const c = color.trim();
  if (/^[0-9a-f]{6}$/i.test(c)) return `#${c}`;
  if (/^[0-9a-f]{3}$/i.test(c)) return `#${c}`;
  if (c.startsWith("#")) return c;
  return c;
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64ToString(encoded: string): string {
  return new TextDecoder().decode(base64ToBytes(encoded));
}
