/** Minimal Windows 95 widgets: Window, Dialog, MenuBar, GroupBox. Styling lives in win95.css. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export function Window(props: {
  title: string;
  icon?: string;
  className?: string;
  inactive?: boolean;
  onClose?: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class={`window ${props.className ?? ''} ${props.inactive ? 'inactive' : ''}`}>
      <div class="titlebar">
        {props.icon && <span>{props.icon}</span>}
        <span class="t">{props.title}</span>
        <button aria-label="Minimize" tabIndex={-1}>
          _
        </button>
        <button aria-label="Maximize" tabIndex={-1}>
          □
        </button>
        <button aria-label="Close" tabIndex={-1} onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="window-body">{props.children}</div>
    </div>
  );
}

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren; width?: number }) {
  return (
    <div class="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div style={props.width ? { width: `${props.width}px` } : undefined}>
        <Window title={props.title} className="dialog" onClose={props.onClose}>
          {props.children}
        </Window>
      </div>
    </div>
  );
}

export function GroupBox(props: { label: ComponentChildren; children: ComponentChildren }) {
  return (
    <fieldset>
      <legend>{props.label}</legend>
      {props.children}
    </fieldset>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export type MenuEntry = MenuItem | 'sep';
export interface Menu {
  label: string;
  items: MenuEntry[];
}

export function MenuBar(props: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div class="menubar" ref={ref}>
      {props.menus.map((m, i) => (
        <div
          class={`menu ${open === i ? 'open' : ''}`}
          key={m.label}
          onMouseEnter={() => open !== null && setOpen(i)}
        >
          <div class="label" onMouseDown={() => setOpen(open === i ? null : i)}>
            <u>{m.label[0]}</u>
            {m.label.slice(1)}
          </div>
          {open === i && <MenuList items={m.items} onPick={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

export function MenuList(props: { items: MenuEntry[]; onPick: () => void; className?: string }) {
  return (
    <div class={props.className ?? 'dropdown'}>
      {props.items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <div
            key={i}
            class={`item ${it.disabled ? 'disabled' : ''} ${it.checked ? 'checked' : ''}`}
            onMouseUp={() => {
              if (it.disabled) return;
              props.onPick();
              it.onClick?.();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span>{it.hint}</span>}
          </div>
        ),
      )}
    </div>
  );
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}
