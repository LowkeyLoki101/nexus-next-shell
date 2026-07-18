import React from 'react';
import ReactDOM from 'react-dom/client';
import GazeVoiceApp from './GazeVoiceApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <GazeVoiceApp />
  </React.StrictMode>,
);
