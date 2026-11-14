/** Labels stay in a left column. A line points at the anatomy they describe. */
export function ModelCallouts({ labels }: { labels: Array<{ id: string; text: string; x: number; y: number; behind?: boolean }> }) {
  return (
    <>
      <svg class="cf-leaders" aria-hidden="true">
        {labels.map((label, index) => {
          if (label.behind) return null;
          const top = 12 + index * 34;
          const width = 20 + label.text.length * 7.8;
          const x1 = 12 + width;
          const y1 = top + 15;
          return (
            <g key={label.id}>
              <line x1={x1} y1={y1} x2={label.x} y2={label.y} />
              <circle cx={label.x} cy={label.y} r="3.5" />
            </g>
          );
        })}
      </svg>
      {labels.map((label, index) => (
        <span key={label.id} class="cf-callout" style={{ left: '12px', top: `${12 + index * 34}px` }}>{label.text}</span>
      ))}
    </>
  );
}
