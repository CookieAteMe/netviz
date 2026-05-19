import { get, set, del } from "idb-keyval";
import type { BlockDef } from "@/blocks/registry";
import type { AppNode, Group, LabeledEdge } from "@/store/flow-store";

export type FlowSnapshot = {
  version: 1;
  nodes: AppNode[];
  edges: LabeledEdge[];
  customBlocks: BlockDef[];
  groups?: Group[];
  turbo?: boolean;
  animateEdges?: boolean;
  animationSpeed?: number;
  turboColors?: [string, string];
};

export function downloadSnapshot(snapshot: FlowSnapshot, filename?: string) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = (filename ?? `netviz-${Date.now()}`).trim() || "netviz";
  a.download = base.endsWith(".json") ? base : `${base}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Draft (named snapshot) persistence
// ---------------------------------------------------------------------------

const DRAFT_INDEX_KEY = "netviz-draft-index";

export type DraftMeta = {
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
};

function draftDataKey(name: string): string {
  return `netviz-draft:${name}`;
}

export async function listDrafts(): Promise<DraftMeta[]> {
  try {
    const raw = await get<DraftMeta[]>(DRAFT_INDEX_KEY);
    return raw ?? [];
  } catch {
    return [];
  }
}

async function saveDraftIndex(index: DraftMeta[]): Promise<void> {
  await set(DRAFT_INDEX_KEY, index);
}

export async function saveDraft(
  name: string,
  snapshot: FlowSnapshot
): Promise<void> {
  await set(draftDataKey(name), snapshot);

  const index = await listDrafts();
  const existing = index.findIndex((d) => d.name === name);
  const now = Date.now();
  const meta: DraftMeta = {
    name,
    createdAt: existing >= 0 ? index[existing].createdAt : now,
    updatedAt: now,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
  };

  if (existing >= 0) {
    index[existing] = meta;
  } else {
    index.unshift(meta);
  }

  await saveDraftIndex(index);
}

export async function loadDraft(
  name: string
): Promise<FlowSnapshot | null> {
  try {
    const data = await get<FlowSnapshot>(draftDataKey(name));
    return data ?? null;
  } catch {
    return null;
  }
}

export async function deleteDraft(name: string): Promise<void> {
  await del(draftDataKey(name));

  const index = await listDrafts();
  const filtered = index.filter((d) => d.name !== name);
  await saveDraftIndex(filtered);
}

// ---------------------------------------------------------------------------
// Snapshot file I/O
// ---------------------------------------------------------------------------

export function readSnapshotFromFile(file: File): Promise<FlowSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as FlowSnapshot;
        if (data.version !== 1) throw new Error("Unsupported file version");
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error("Invalid snapshot shape");
        }
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
