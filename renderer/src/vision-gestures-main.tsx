import React from 'react';
import ReactDOM from 'react-dom/client';
import NexusVisionGesturesApp from './NexusVisionGesturesApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <NexusVisionGesturesApp />,
);
