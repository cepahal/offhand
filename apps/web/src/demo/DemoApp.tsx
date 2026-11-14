/** Browser-only demonstration. No hub, no keys, no hardware. Opens straight into the chart. */
import { useEffect } from 'preact/hooks';
import { HospitalApp } from './HospitalApp.js';
import { go, useLocationKey } from './router.js';

export function DemoApp() {
  const locationKey = useLocationKey();
  const pathname = (locationKey.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  const redirect = pathname === '/demo' ? '/demo/app' : null;

  useEffect(() => {
    if (redirect) go(redirect, true);
  }, [redirect]);

  if (redirect) return null;
  if (pathname.startsWith('/demo/app')) return <HospitalApp locationKey={locationKey} />;
  return (
    <main class="cis-missing">
      <p>
        This page does not exist.{' '}
        <button type="button" onClick={() => go('/demo/app')}>
          Open the chart
        </button>
      </p>
    </main>
  );
}
