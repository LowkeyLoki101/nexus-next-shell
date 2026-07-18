import React from 'react';
import ReactDOM from 'react-dom/client';
import NextApp from './NextApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

const root = ReactDOM.createRoot(rootElement);

function renderApp() {
  root.render(
    <React.StrictMode>
      <NextApp />
    </React.StrictMode>,
  );
}

function renderBootstrapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  root.render(
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        background: '#050505',
        color: '#f7f2e8',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          width: 'min(760px, calc(100vw - 48px))',
          border: '1px solid rgba(215, 174, 91, 0.42)',
          borderRadius: 8,
          padding: 32,
          background: 'rgba(31, 24, 16, 0.86)',
          boxShadow: '0 20px 80px rgba(0, 0, 0, 0.45)',
        }}
      >
        <h1 style={{ margin: '0 0 16px', fontSize: 36, lineHeight: 1.1 }}>NEXUS Next Capsule</h1>
        <p style={{ margin: '0 0 18px', color: '#cfc4b6', fontSize: 18 }}>
          The capsule could not initialize the Nexus connection.
        </p>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#d7ae5b', fontSize: 14 }}>{message}</pre>
      </section>
    </div>,
  );
}

async function ensureNexusApi() {
  if ((window as any).nexus) return;
  const { bootstrap } = await import('../../src/web/bootstrap');
  await bootstrap();
}

void ensureNexusApi()
  .then(renderApp)
  .catch((error) => {
    console.error('[NexusNext] shell bootstrap failed', error);
    renderBootstrapError(error);
  });
