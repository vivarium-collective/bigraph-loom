import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import type { StoreNodeData } from "../types";

function GroupNode({ data }: NodeProps & { data: StoreNodeData }) {
  const isCollapsed = (data as any).isCollapsed;

  return (
    <div className={`group-node ${isCollapsed ? "group-node-collapsed" : ""}`}>
      <div className="group-label">
        <span className="collapse-indicator" title="Double-click to toggle">
          {isCollapsed ? "\u25B6" : "\u25BC"}
        </span>
        {" "}{data.label}
      </div>
    </div>
  );
}

export default memo(GroupNode);
