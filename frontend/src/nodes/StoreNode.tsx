import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StoreNodeData } from "../types";

function StoreNode({ data }: NodeProps & { data: StoreNodeData }) {
  const hasValue = data.value !== undefined && data.value !== null;
  const isCollapsed = (data as any).isCollapsed;

  return (
    <div className={`store-node ${isCollapsed ? "store-node-collapsed" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="store-label">{data.label}</div>
      {hasValue && (
        <div className="store-value" title={String(data.value)}>
          {String(data.value).slice(0, 20)}
        </div>
      )}
      {(data as any).isGroup && (
        <div className="collapse-indicator">
          {isCollapsed ? "\u25B6" : "\u25BC"}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(StoreNode);
