import { useMemo } from "react";
import type { Node } from "@xyflow/react";

interface Props {
  allProcessNodes: Node[];
  hiddenNodes: Set<string>;
  onToggle: (nodeId: string) => void;
  onHideAll: () => void;
  onShowAll: () => void;
}

export default function ProcessListPanel({
  allProcessNodes,
  hiddenNodes,
  onToggle,
  onHideAll,
  onShowAll,
}: Props) {
  const sorted = useMemo(
    () => [...allProcessNodes].sort((a, b) => a.id.localeCompare(b.id)),
    [allProcessNodes]
  );

  const visibleCount = sorted.filter((n) => !hiddenNodes.has(n.id)).length;

  return (
    <div className="process-list-panel">
      <div className="process-list-header">
        <h4>Processes ({visibleCount}/{sorted.length})</h4>
        <div className="process-list-actions">
          <button onClick={onShowAll}>All On</button>
          <button onClick={onHideAll}>All Off</button>
        </div>
      </div>
      <div className="process-list-body">
        {sorted.map((n) => {
          const data = n.data as any;
          const isVisible = !hiddenNodes.has(n.id);
          return (
            <label className="process-list-item" key={n.id} title={n.id}>
              <input
                type="checkbox"
                checked={isVisible}
                onChange={() => onToggle(n.id)}
              />
              <span className="process-list-name">{data.label}</span>
              {data.address && (
                <span className="process-list-addr">{data.address}</span>
              )}
            </label>
          );
        })}
        {sorted.length === 0 && (
          <div className="process-list-empty">No processes in current bigraph</div>
        )}
      </div>
    </div>
  );
}
