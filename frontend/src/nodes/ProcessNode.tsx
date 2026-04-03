import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ProcessNodeData } from "../types";

function ProcessNode({ data }: NodeProps & { data: ProcessNodeData }) {
  return (
    <div className="process-node">
      {/* Input port handles on the left */}
      {data.inputPorts.map((port, i) => (
        <Handle
          key={`in-${port}`}
          type="target"
          position={Position.Left}
          id={port}
          style={{ top: `${((i + 1) / (data.inputPorts.length + 1)) * 100}%` }}
          title={port}
        />
      ))}
      <div className="process-label">{data.label}</div>
      <div className="process-type">{data.processType}</div>
      {/* Output port handles on the right */}
      {data.outputPorts.map((port, i) => (
        <Handle
          key={`out-${port}`}
          type="source"
          position={Position.Right}
          id={port}
          style={{ top: `${((i + 1) / (data.outputPorts.length + 1)) * 100}%` }}
          title={port}
        />
      ))}
    </div>
  );
}

export default memo(ProcessNode);
