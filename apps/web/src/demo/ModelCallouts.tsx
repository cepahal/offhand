/**
 * Labels sit around the model. A line points at the anatomy they describe.
 * Cards stay in the margins so they do not cover the mesh.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

type Label = { id: string; text: string; x: number; y: number; behind?: boolean };

function cardWidth(text: string): number {
  return Math.min(220, Math.max(88, 22 + text.length * 7.4));
}

/** Four corner / side slots kept clear of the model center and the top-right tools. */
function slotsFor(count: number, width: number, height: number, cardH: number) {
  const margin = 12;
  const toolClear = 44; // leave room for zoom / reset buttons
  const midY = Math.max(margin, (height - cardH) / 2);
  const lowY = Math.max(margin, height - cardH - margin);
  const highLeft = margin;
  const highRight = margin + toolClear;
  // Even ring around the viewport: prefer corners, then mid-edges for extras.
  const ring: Array<{ side: 'left' | 'right'; top: number }> = [
    { side: 'left', top: highLeft },
    { side: 'right', top: highRight },
    { side: 'left', top: lowY },
    { side: 'right', top: lowY },
    { side: 'left', top: midY },
    { side: 'right', top: midY },
  ];
  return ring.slice(0, Math.max(count, 1));
}

function placeCards(labels: Label[], width: number, height: number): Array<Label & { left: number; top: number; w: number }> {
  const visible = labels.filter((label) => !label.behind);
  if (visible.length === 0 || width < 40 || height < 40) return [];
  const cardH = 30;
  const margin = 12;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const slots = slotsFor(visible.length, width, height, cardH);
  const sized = visible.map((label) => ({ ...label, w: cardWidth(label.text) }));
  // Match each label to the nearest free slot so leaders stay short and cards spread out.
  const taken = new Set<number>();
  const placed: Array<Label & { left: number; top: number; w: number }> = [];
  const ordered = [...sized].sort((a, b) => {
    const aa = Math.atan2(a.y - cy, a.x - cx);
    const bb = Math.atan2(b.y - cy, b.x - cx);
    return aa - bb;
  });
  for (const label of ordered) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < slots.length; i += 1) {
      if (taken.has(i)) continue;
      const slot = slots[i]!;
      const left = slot.side === 'left' ? margin : Math.max(margin, width - label.w - margin);
      const dx = left + label.w * 0.5 - label.x;
      const dy = slot.top + cardH * 0.5 - label.y;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    taken.add(best);
    const slot = slots[best]!;
    placed.push({
      ...label,
      left: slot.side === 'left' ? margin : Math.max(margin, width - label.w - margin),
      top: slot.top,
    });
  }
  return placed;
}

export function ModelCallouts({ labels }: { labels: Label[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const node = host.current?.parentElement;
    if (!node) return;
    const read = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const placed = placeCards(labels, size.w, size.h);
  return (
    <div class="cf-callouts" ref={host}>
      <svg class="cf-leaders" aria-hidden="true">
        {placed.map((label) => {
          const x1 = label.left < size.w * 0.5 ? label.left + label.w : label.left;
          const y1 = label.top + 15;
          return (
            <g key={label.id}>
              <line x1={x1} y1={y1} x2={label.x} y2={label.y} />
              <circle cx={label.x} cy={label.y} r="3.5" />
            </g>
          );
        })}
      </svg>
      {placed.map((label) => (
        <span key={label.id} class="cf-callout" style={{ left: `${label.left}px`, top: `${label.top}px` }}>{label.text}</span>
      ))}
    </div>
  );
}
