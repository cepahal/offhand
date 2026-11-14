/** One icon family: 20 px grid, 1.6 px stroke, round joins. Colour comes from `currentColor`. */
import type { JSX } from 'preact';

type P = { size?: number; class?: string };

function Svg({ size = 20, class: cls, children }: P & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconTooth = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 2.8c1.4 0 2 1.1 3.4 1.1s2-1.1 3.4-1.1c2.2 0 3.6 1.9 3.6 4.3 0 2.6-1.4 4.1-2.1 6.2-.5 1.6-1 3.9-2.1 3.9-1.2 0-1.2-3.3-2.8-3.3s-1.6 3.3-2.8 3.3c-1.1 0-1.6-2.3-2.1-3.9C4.4 11.2 3 9.7 3 7.1c0-2.4 1.4-4.3 3.6-4.3z" />
  </Svg>
);
export const IconScan = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.8 16.4 6.4v7.2L10 17.2 3.6 13.6V6.4z" />
    <path d="M3.6 6.4 10 10l6.4-3.6M10 10v7.2" />
  </Svg>
);
export const IconPressure = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 10.5h3l1.8-4.6 3.4 9 2-6 1.3 1.6h3.5" />
  </Svg>
);
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="5.6" height="5.6" rx="1" />
    <rect x="11.4" y="3" width="5.6" height="5.6" rx="1" />
    <rect x="3" y="11.4" width="5.6" height="5.6" rx="1" />
    <rect x="11.4" y="11.4" width="5.6" height="5.6" rx="1" />
  </Svg>
);
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M5 2.8h6.6L15 6.2v11H5z" />
    <path d="M11.4 2.8v3.6H15M7.6 10h4.8M7.6 13h4.8" />
  </Svg>
);
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" />
  </Svg>
);
export const IconPerson = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="6.8" r="3.2" />
    <path d="M3.6 17c.6-3.3 3.2-5.2 6.4-5.2s5.8 1.9 6.4 5.2" />
  </Svg>
);
export const IconRecord = (p: P) => (
  <Svg {...p}>
    <rect x="4.4" y="3.6" width="11.2" height="13.6" rx="1.4" />
    <path d="M7.6 2.6h4.8v2.2H7.6zM7.4 9h5.2M7.4 12.2h5.2M7.4 15h3" />
  </Svg>
);
export const IconInspector = (p: P) => (
  <Svg {...p}>
    <rect x="2.6" y="3.6" width="14.8" height="12.8" rx="1.6" />
    <path d="M12.4 3.6v12.8" />
  </Svg>
);
export const IconZoomIn = (p: P) => (
  <Svg {...p}>
    <circle cx="8.6" cy="8.6" r="5.2" />
    <path d="m12.4 12.4 4.4 4.4M6.4 8.6h4.4M8.6 6.4v4.4" />
  </Svg>
);
export const IconZoomOut = (p: P) => (
  <Svg {...p}>
    <circle cx="8.6" cy="8.6" r="5.2" />
    <path d="m12.4 12.4 4.4 4.4M6.4 8.6h4.4" />
  </Svg>
);
export const IconRotate = (p: P) => (
  <Svg {...p}>
    <path d="M15.6 9.6A5.6 5.6 0 1 1 13.8 5" />
    <path d="M14.4 2.6 14 5.4l-2.8-.2" />
  </Svg>
);
export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M3.4 9.4 10 3.6l6.6 5.8M5.4 8v8.4h9.2V8" />
  </Svg>
);
export const IconExpand = (p: P) => (
  <Svg {...p}>
    <path d="M3.4 7.4v-4h4M12.6 3.4h4v4M16.6 12.6v4h-4M7.4 16.6h-4v-4" />
  </Svg>
);
export const IconHand = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 10.2V5.4a1.2 1.2 0 0 1 2.4 0v4M9 9.2V4a1.2 1.2 0 0 1 2.4 0v5.2M11.4 9.2V5a1.2 1.2 0 0 1 2.4 0v6.2c0 3.4-2 5.8-4.8 5.8-2.2 0-3.4-1.2-4.6-3.2L3.2 11a1.2 1.2 0 0 1 2-1.2l1.4 1.6" />
  </Svg>
);
export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="7.4" y="2.6" width="5.2" height="9.2" rx="2.6" />
    <path d="M4.6 9.6a5.4 5.4 0 0 0 10.8 0M10 15v2.6" />
  </Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M10 17.4s5-4.8 5-8.8a5 5 0 0 0-10 0c0 4 5 8.8 5 8.8z" />
    <circle cx="10" cy="8.6" r="1.8" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.4l3 1.8" />
  </Svg>
);
export const IconBuilding = (p: P) => (
  <Svg {...p}>
    <path d="M3.6 17V6.6L10 3.4l6.4 3.2V17M8 17v-3.6h4V17M7.2 9h1.6M11.2 9h1.6" />
  </Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.6 11.4 8.6 17.4 10l-6 1.4L10 17.4l-1.4-6L2.6 10l6-1.4z" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m4.4 10.4 3.6 3.6 7.6-8" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m7.6 4.8 5 5.2-5 5.2" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M10 3 17 6.8 10 10.6 3 6.8z" />
    <path d="m3 10.2 7 3.8 7-3.8M3 13.4l7 3.8 7-3.8" />
  </Svg>
);
export const IconWave = (p: P) => (
  <Svg {...p}>
    <path d="M2.6 10c1.2-3 2.4-3 3.6 0s2.4 3 3.6 0 2.4-3 3.6 0 2.4 3 3.6 0" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M3 9.6 17 3l-4.4 14-2.8-5.6z" />
    <path d="M9.8 11.4 17 3" />
  </Svg>
);

/** Arrow for gesture feedback, pointing the way the model moved. */
export function IconArrow({ dir, size = 20, class: cls }: P & { dir: 'left' | 'right' | 'up' | 'down' }) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return (
    <Svg size={size} class={cls}>
      <g transform={`rotate(${rot} 10 10)`}>
        <path d="M3.4 10h12.4M11 5.2l4.8 4.8-4.8 4.8" />
      </g>
    </Svg>
  );
}

/**
 * The gesture puck: the PAJ7620 sensor window in its housing, with a status lamp.
 * Drawn, not a font glyph, so it reads as the actual device.
 */
export function PuckGlyph({ state, size = 22 }: { state: 'live' | 'idle' | 'offline'; size?: number }) {
  const lamp = state === 'live' ? 'var(--ok)' : state === 'idle' ? 'var(--text-3)' : 'var(--err)';
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2" y="5" width="18" height="12" rx="3" fill="var(--chrome-3)" stroke="var(--edge-dark)" />
      <rect x="2.5" y="5.5" width="17" height="1" rx=".5" fill="rgba(255,255,255,.08)" />
      <rect x="6" y="8.2" width="7" height="5.6" rx="1.2" fill="var(--well)" stroke="var(--edge-dark)" />
      <circle cx="8.4" cy="11" r="1.1" fill="#3b4b57" />
      <circle cx="10.8" cy="11" r="1.1" fill="#3b4b57" />
      <circle cx="16" cy="11" r="1.5" fill={lamp} />
    </svg>
  );
}
