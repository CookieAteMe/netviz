import type { FlowSnapshot } from "@/lib/storage";
import { importDrawioFile } from "@/lib/drawio-import";
import { importExcalidrawFile } from "@/lib/excalidraw-import";
import { importSvgFile } from "@/lib/svg-import";
import { importMermaidFile } from "@/lib/mermaid-import";

export type ImportFormat =
  | "drawio"
  | "excalidraw"
  | "svg"
  | "mermaid"
  | "json"
  | "unknown";

export function detectFormat(file: File): ImportFormat {
  const name = file.name.toLowerCase();

  if (name.endsWith(".drawio") || name.endsWith(".dio")) return "drawio";
  if (name.endsWith(".excalidraw") || name.endsWith(".excalidrawlib")) return "excalidraw";
  if (name.endsWith(".svg") || name.endsWith(".svgz")) return "svg";
  if (name.endsWith(".mmd") || name.endsWith(".mermaid")) return "mermaid";
  if (name.endsWith(".json")) return "json";

  // .xml files are likely draw.io uncompressed format
  if (name.endsWith(".xml")) return "drawio";

  return "unknown";
}

export async function importDiagramFile(file: File): Promise<FlowSnapshot> {
  const format = detectFormat(file);

  switch (format) {
    case "drawio":
      return importDrawioFile(file);
    case "excalidraw":
      return importExcalidrawFile(file);
    case "svg":
      return importSvgFile(file);
    case "mermaid":
      return importMermaidFile(file);
    case "json":
      return readJsonSnapshot(file);
    default:
      throw new Error(
        `Unknown file format: ${file.name}\n` +
        "Supported formats: .drawio, .excalidraw, .svg, .mmd, .json"
      );
  }
}

function readJsonSnapshot(file: File): Promise<FlowSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.version !== 1) throw new Error("Unsupported file version");
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error("Invalid snapshot shape");
        }
        resolve(data as FlowSnapshot);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
