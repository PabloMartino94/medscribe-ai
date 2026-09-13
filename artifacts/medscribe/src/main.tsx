import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { initSupabase } from '@/lib/supabase';

import './index.css';

const root = createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
});

function renderFatal(message: string) {
  root.render(
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: 'Inter, system-ui, sans-serif',
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      <p>{message}</p>
    </div>,
  );
}

// The app cannot authenticate without this configuration, so it is fetched
// before the first render rather than racing the auth provider.
initSupabase()
  .then(() => {
    root.render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    );
  })
  .catch((error) => {
    console.error('Failed to load runtime configuration', error);
    renderFatal(
      'No se pudo contactar al servidor. Revisá tu conexión y volvé a cargar la página.',
    );
  });
