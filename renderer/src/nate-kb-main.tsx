import React from 'react';
import { createRoot } from 'react-dom/client';
import { NateJonesKnowledgeApp } from './NateJonesKnowledgeApp';
import './nate-kb.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NateJonesKnowledgeApp />
  </React.StrictMode>
);
