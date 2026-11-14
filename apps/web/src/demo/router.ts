import { useEffect, useState } from 'preact/hooks';
import type { AppSection } from './types.js';

export function go(path: string, replace = false): void {
  const fn = replace ? history.replaceState : history.pushState;
  fn.call(history, null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Path plus query, so a command-box search updates the open page. */
export function useLocationKey(): string {
  const [key, setKey] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const sync = () => setKey(location.pathname + location.search);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return key;
}

export function parseAppRoute(pathname: string): { section: AppSection; mrn: string | null } {
  const rest = pathname.replace(/\/+$/, '').replace(/^\/demo\/app\/?/, '');
  const [head, id] = rest.split('/');
  if (head === 'patient' && id) return { section: 'patients', mrn: decodeURIComponent(id) };
  if (head === 'surgery' || head === 'imaging' || head === 'messages' || head === 'wards' || head === 'theatres' || head === 'audit' || head === 'settings') {
    return { section: head, mrn: null };
  }
  return { section: 'patients', mrn: null };
}
