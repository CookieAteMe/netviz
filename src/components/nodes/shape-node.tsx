import { memo } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from "@xyflow/react";
import type { ShapeNode } from "@/store/flow-store";
import { ACCENT_CLASSES } from "@/blocks/registry";
import { cn } from "@/lib/utils";

const HANDLE_POSITIONS: { pos: Position; key: string }[] = [
  { pos: Position.Top, key: "top" },
  { pos: Position.Right, key: "right" },
  { pos: Position.Bottom, key: "bottom" },
  { pos: Position.Left, key: "left" },
];

const BORDER_STYLE_CLASS = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
} as const;

function ShapeNodeComponent({ data, selected }: NodeProps<ShapeNode>) {
  const accent = (data.accent && ACCENT_CLASSES[data.accent]) ?? ACCENT_CLASSES.slate;
  const isCircle = data.shape === "circle";
  const borderStyle = data.borderStyle ?? "dashed";

  return (
    <div
      className={cn(
        "shape-card relative h-full w-full select-none border-2",
        BORDER_STYLE_CLASS[borderStyle],
        !data.bgColor && accent.tile,
        !data.borderColor && accent.border,
        isCircle ? "rounded-full" : "rounded-xl"
      )}
      style={{
        ...(data.bgColor ? { backgroundColor: data.bgColor } : {}),
        ...(data.borderColor ? { borderColor: data.borderColor } : {}),
        ...(!isCircle && typeof data.borderRadius === "number"
          ? { borderRadius: data.borderRadius }
          : {}),
      }}
    >
      <NodeResizer
        isVisible={selected}

        keepAspectRatio={isCircle}
        lineClassName="!border-ring/40"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-ring !bg-background"
      />
      {HANDLE_POSITIONS.map(({ pos, key }) => (
        <Handle key={key} type="source" position={pos} id={key} />
      ))}
      {data.label ? (
        <span
          className={cn(
            "pointer-events-none absolute left-3 top-2 text-[11px] font-semibold tracking-wider",
            !data.titleColor && accent.icon
          )}
          style={data.titleColor ? { color: data.titleColor } : undefined}
        >
          {data.label}
        </span>
      ) : null}
    </div>
  );
}

export const ShapeNodeView = memo(ShapeNodeComponent);
