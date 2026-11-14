/**
 * The note card stays at the top-right of its parent. The dot follows a world point.
 */
import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import type { CaseNote } from './annotations.js';

export type NotePin = {
  project: (camera: THREE.Camera, anchor: THREE.Vector3) => void;
};

export function TrackingNotes({
  notes,
  pin,
}: {
  notes: CaseNote[];
  pin: { current: NotePin | null };
}) {
  const root = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLElement>(null);
  const line = useRef<SVGLineElement>(null);
  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pin.current = {
      project(camera, anchor) {
        const host = root.current?.parentElement;
        const callout = root.current;
        const mark = dot.current;
        const rule = line.current;
        const card = stack.current;
        if (!host || !callout || !mark || !rule || !card || notes.length === 0) return;
        const scratch = anchor.clone().project(camera);
        const width = host.clientWidth;
        const height = host.clientHeight;
        const x = (scratch.x * 0.5 + 0.5) * width;
        const y = (-scratch.y * 0.5 + 0.5) * height;
        const cardX = Math.max(12, width - 210);
        const cardY = 12;
        mark.style.left = `${x}px`;
        mark.style.top = `${y}px`;
        card.style.left = `${cardX}px`;
        card.style.top = `${cardY}px`;
        rule.setAttribute('x1', String(x));
        rule.setAttribute('y1', String(y));
        rule.setAttribute('x2', String(cardX));
        rule.setAttribute('y2', String(cardY + 16));
        callout.style.visibility = scratch.z > 1 ? 'hidden' : 'visible';
      },
    };
    return () => {
      pin.current = null;
    };
  }, [notes, pin]);

  if (notes.length === 0) return null;
  return (
    <div class="dv-callout" ref={root}>
      <svg class="dv-note-line" aria-hidden="true"><line ref={line} stroke="#c8a96f" stroke-width="1.5" /></svg>
      <i class="dv-anchor-dot" ref={dot} />
      <div class="dv-note-stack" ref={stack}>
        {notes.map((note) => <article class="dv-note" key={note.id}>{note.text}</article>)}
      </div>
    </div>
  );
}
