import { useEffect } from 'react';
import type { ExtensionMessage } from '@ftpmanager/shared';
import { useConnectionStore } from '../stores/connection.js';
import { postMessage } from '../vscode-api.js';

export function useExtensionMessages(): void {
  const { setConnections, setTestResult } = useConnectionStore();

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'stateSync':
          setConnections(msg.connections);
          break;
        case 'connectionTestResult':
          setTestResult({ success: msg.success, error: msg.error });
          break;
        case 'filePicked':
          useConnectionStore.getState().setPickedFile(msg.target, msg.path);
          break;
        case 'error':
          console.error('[FTPManager]', msg.message);
          break;
      }
    };

    window.addEventListener('message', handler);
    postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [setConnections, setTestResult]);
}
