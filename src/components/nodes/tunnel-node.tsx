import { memo } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from "@xyflow/react";
import type { TunnelNode } from "@/store/flow-store";
import { ACCENT_CLASSES } from "@/blocks/registry";
import { cn } from "@/lib/utils";

const HANDLE_POSITIONS: { pos: Position; key: string }[] = [
  { pos: Position.Top, key: "top" },
  { pos: Position.Right, key: "right" },
  { pos: Position.Bottom, key: "bottom" },
  { pos: Position.Left, key: "left" },
];

function TunnelNodeComponent({ data, selected }: NodeProps<TunnelNode>) {
  const accent = (data.accent && ACCENT_CLASSES[data.accent]) ?? ACCENT_CLASSES.sky;

  return (
    <div
      className={cn(
        "tunnel-card relative h-full w-full select-none",
        selected && "rounded-full"
      )}
    >
      <NodeResizer
        isVisible={selected}

        lineClassName="!border-ring/40 !rounded-full"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-ring !bg-background"
      />
      {HANDLE_POSITIONS.map(({ pos, key }) => (
        <Handle key={key} type="source" position={pos} id={key} />
      ))}

      <div
        className={cn(
          "tunnel-body relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 shadow-sm",
          !data.bgColor && accent.tile,
          !data.borderColor && accent.border
        )}
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(255,255,255,0.22), transparent 50%, rgba(255,255,255,0.14))",
          ...(data.bgColor ? { backgroundColor: data.bgColor } : {}),
          ...(data.borderColor ? { borderColor: data.borderColor } : {}),
        }}
      >
        <div
          className={cn(
            "tunnel-portal-left pointer-events-none absolute left-0 top-0 h-full rounded-full border-r-2 bg-foreground/20 dark:bg-black/40",
            accent.border
          )}
          style={{
            width: "min(38%, 44px)",
            boxShadow: "inset 6px 0 10px rgba(0,0,0,0.35)",
          }}
        />
        <div
          className={cn(
            "tunnel-portal-right pointer-events-none absolute right-0 top-0 h-full rounded-full border-l-2 bg-foreground/20 dark:bg-black/40",
            accent.border
          )}
          style={{
            width: "min(38%, 44px)",
            boxShadow: "inset -6px 0 10px rgba(0,0,0,0.35)",
          }}
        />
        <span
          className={cn(
            "relative z-10 truncate px-12 text-sm font-semibold tracking-wide",
            !data.titleColor && accent.icon
          )}
          style={data.titleColor ? { color: data.titleColor } : undefined}
        >
          {data.label || "Tunnel"}
        </span>
      </div>
    </div>
  );
}

export const TunnelNodeView = memo(TunnelNodeComponent);
