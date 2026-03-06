import React from 'react';
import { useConnectionStore } from './stores/connection.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { ConnectionDialog } from './components/ConnectionDialog/index.js';
import { WelcomeView } from './components/WelcomeView/index.js';

export default function App() {
  const { viewState } = useConnectionStore();
  useExtensionMessages();

  if (viewState.view === 'connectionDialog') {
    return <ConnectionDialog editId={viewState.editId} />;
  }

  return <WelcomeView />;
}
