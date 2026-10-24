import { NODE_COLOR_VAR } from "@/lib/types";
import type { GraphNode } from "@/lib/types";
import { displayLabel, formatConfidence, hostOf, keyProps, matchedVia, nodeDate } from "./model";

function urlValue(value: string) {
  if (!/^https?:\/\//i.test(value)) return value;
  return (
    <a className="clip" href={value} target="_blank" rel="noreferrer" title={value}>
      {value.replace(/^https?:\/\//, "")}
    </a>
  );
}

/** Long prose (descriptions, post text) and URLs read better stacked under their label. */
function isLong(value: string): boolean {
  return value.length > 40 || /^https?:\/\//i.test(value);
}

export function NodeCard({
  node,
  pinned,
  style,
  onAsk,
}: {
  node: GraphNode;
  pinned?: boolean;
  style?: { left: number; top: number };
  onAsk?: (node: GraphNode) => void;
}) {
  const date = nodeDate(node);
  const props = keyProps(node);
  const via = matchedVia(node);
  const confidence = typeof node.confidence === "number" ? formatConfidence(node.confidence) : null;

  return (
    <article
      className={pinned ? "node-card pinned" : "node-card float"}
      style={pinned ? undefined : style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="type">
        <i className="swatch" style={{ background: `var(${NODE_COLOR_VAR[node.type]})` }} />
        {node.type}
      </p>
      <p className="label">{displayLabel(node.label)}</p>
      <dl>
        {date ? (
          <div>
            <dt>Date</dt>
            <dd>{date}</dd>
          </div>
        ) : null}
        {props.map((row) => (
          <div key={row.key} className={isLong(row.value) ? "long" : undefined}>
            <dt>{row.key}</dt>
            <dd>{urlValue(row.value)}</dd>
          </div>
        ))}
        {via ? (
          <div>
            <dt>Matched via</dt>
            <dd>
              <code>{via}</code>
            </dd>
          </div>
        ) : null}
        {confidence ? (
          <div>
            <dt>Confidence</dt>
            <dd>{confidence}</dd>
          </div>
        ) : null}
        {node.source_url ? (
          <div>
            <dt>Source</dt>
            <dd>
              <a href={node.source_url} target="_blank" rel="noreferrer">
                {hostOf(node.source_url)}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {pinned && onAsk ? (
        <button type="button" className="pill sm ask" onClick={() => onAsk(node)}>
          Ask about this
        </button>
      ) : null}
    </article>
  );
}
