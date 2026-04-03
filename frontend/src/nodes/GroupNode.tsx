import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import type { StoreNodeData } from "../types";

function GroupNode({ data, selected }: NodeProps & { data: StoreNodeData }) {
  const isCollapsed = (data as any).isCollapsed;

  return (
    <>
      <NodeResizer
        minWidth={120}
        minHeight={100}
        isVisible={selected ?? false}
        lineClassName="group-resize-line"
        handleClassName="group-resize-handle"
      />
      <Handle type="target" position={Position.Top} className="group-handle" />
      <div className={`group-node ${isCollapsed ? "group-node-collapsed" : ""}`}>
        <div className="group-label">
          <span className="collapse-indicator" title="Double-click to toggle">
            {isCollapsed ? "\u25B6" : "\u25BC"}
          </span>
          {" "}{data.label}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="group-handle" />
    </>
  );
}

export default memo(GroupNode);
