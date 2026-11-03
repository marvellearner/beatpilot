import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './renderer/App';
import { RemoteClient } from './remote/RemoteClient';
import { ErrorBoundary } from './renderer/components/ErrorBoundary';
import './renderer/styles/index.css';

// The phone remote must not create its own audio engine, so pick the root up front
const isRemote = new URLSearchParams(window.location.search).get('remote') === 'true';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="AI DJ Interface Glitch Prevented">
      {isRemote ? <RemoteClient /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
