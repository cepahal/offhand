/**
 * `/` is the NeuroVision screen. `/demo` is the blue hospital UI. `/kiosk` is the older clinician screen.
 */
const path = location.pathname.replace(/\/+$/, '') || '/';

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  const { render } = await import('preact');
  if (path === '/demo' || path.startsWith('/demo/')) {
    const { DemoApp } = await import('./demo/DemoApp.js');
    await import('./demo/demo.css');
    render(<DemoApp />, root);
    return;
  }
  if (path === '/kiosk' || path === '/debug') {
    await import('./ui/screen.css');
    const { App } = await import('./app/App.js');
    const { controller } = await import('./app/controller.js');
    const { DebugPage } = await import('./app/Debug.js');
    const { mockSource } = await import('./mocks/mockCases.js');
    controller.registerLocal(mockSource);
    controller.start();
    render(path === '/debug' ? <DebugPage /> : <App />, root);
    return;
  }
  const { DentalView } = await import('./demo/DentalView.js');
  await import('./demo/dental-view.css');
  render(<DentalView />, root);
}

void boot();
