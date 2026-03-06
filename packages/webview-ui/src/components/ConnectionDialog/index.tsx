import React, { useState, useEffect } from 'react';
import type { FtpConnectionConfig, FtpProtocol } from '@ftpmanager/shared';
import { DEFAULT_PORTS } from '@ftpmanager/shared';
import { useConnectionStore } from '../../stores/connection.js';
import { postMessage } from '../../vscode-api.js';
import { randomUUID } from './uuid.js';

interface Props {
  editId?: string;
}

const emptyConfig = (): FtpConnectionConfig => ({
  id: randomUUID(),
  name: '',
  protocol: 'ftp',
  host: '',
  port: 21,
  username: '',
  remotePath: '',
});

export function ConnectionDialog({ editId }: Props) {
  const { connections, testResult, isTesting, setViewState, setTestResult, setIsTesting, pickedFiles } =
    useConnectionStore();

  const existing = editId ? connections.find((c) => c.id === editId) : undefined;
  const [config, setConfig] = useState<FtpConnectionConfig>(existing ?? emptyConfig());
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Sync picked private key file path
  useEffect(() => {
    if (pickedFiles['privateKey']) {
      setConfig((c) => ({ ...c, privateKeyPath: pickedFiles['privateKey'] }));
    }
  }, [pickedFiles]);

  // Update port when protocol changes
  const handleProtocolChange = (protocol: FtpProtocol) => {
    setConfig((c) => ({
      ...c,
      protocol,
      port: DEFAULT_PORTS[protocol] ?? c.port,
    }));
  };

  const handleSave = () => {
    if (!config.name.trim() || !config.host.trim()) return;
    postMessage({ type: 'saveConnection', config, password: password || undefined, passphrase: passphrase || undefined });
    setViewState({ view: 'welcome' });
  };

  const handleTest = () => {
    setIsTesting(true);
    setTestResult(null);
    postMessage({ type: 'testConnection', config, password: password || undefined, passphrase: passphrase || undefined });
  };

  return (
    <div className="connection-dialog">
      <div className="dialog-header">
        <h1>{editId ? 'Edit Server' : 'Add Server'}</h1>
        <button className="back-btn" onClick={() => setViewState({ view: 'welcome' })}>
          ← Back
        </button>
      </div>

      <div className="form">
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
            placeholder="My Server"
          />
        </div>

        <div className="form-group">
          <label>Protocol</label>
          <div className="protocol-selector">
            {(['ftp', 'ftps', 'sftp'] as FtpProtocol[]).map((p) => (
              <button
                key={p}
                className={`protocol-btn ${config.protocol === p ? 'active' : ''}`}
                onClick={() => handleProtocolChange(p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-3">
            <label>Host</label>
            <input
              type="text"
              value={config.host}
              onChange={(e) => setConfig((c) => ({ ...c, host: e.target.value }))}
              placeholder="ftp.example.com"
            />
          </div>
          <div className="form-group flex-1">
            <label>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => setConfig((c) => ({ ...c, port: Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label>Username</label>
            <input
              type="text"
              value={config.username}
              onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))}
              placeholder="anonymous"
            />
          </div>
          <div className="form-group flex-1">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editId ? '(unchanged)' : ''}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Remote Path</label>
          <input
            type="text"
            value={config.remotePath}
            onChange={(e) => setConfig((c) => ({ ...c, remotePath: e.target.value }))}
            placeholder="/public_html  (empty = home directory)"
          />
        </div>

        {config.protocol === 'sftp' && (
          <div className="sftp-section">
            <h3>SSH Key Authentication (optional)</h3>
            <div className="form-group">
              <label>Private Key</label>
              <div className="file-input-row">
                <input
                  type="text"
                  value={config.privateKeyPath ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, privateKeyPath: e.target.value }))}
                  placeholder="~/.ssh/id_rsa"
                  readOnly
                />
                <button onClick={() => postMessage({ type: 'browsePrivateKey' })}>Browse...</button>
              </div>
            </div>
            {config.privateKeyPath && (
              <div className="form-group">
                <label>Passphrase</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="(if key is encrypted)"
                />
              </div>
            )}
          </div>
        )}

        {testResult && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? '✓ Connection successful!' : `✗ ${testResult.error}`}
          </div>
        )}

        <div className="form-actions">
          <button onClick={handleTest} disabled={isTesting || !config.host.trim()}>
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          <div className="spacer" />
          <button onClick={() => setViewState({ view: 'welcome' })}>Cancel</button>
          <button
            className="primary"
            onClick={handleSave}
            disabled={!config.name.trim() || !config.host.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
