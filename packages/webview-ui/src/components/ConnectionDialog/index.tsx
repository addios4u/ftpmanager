import React, { useState, useEffect } from 'react';
import type { FtpConnectionConfig, FtpProtocol } from '@ftpmanager/shared';
import { DEFAULT_PORTS } from '@ftpmanager/shared';
import { createTranslator } from '../../i18n.js';
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
  passiveMode: true,
  defaultFilePermissions: '644',
  defaultFolderPermissions: '755',
});

export function ConnectionDialog({ editId }: Props) {
  const {
    connections,
    isTesting,
    language,
    pickedFiles,
    setIsTesting,
    setTestResult,
    setViewState,
    testResult,
    vscodeLanguage,
  } = useConnectionStore();
  const t = createTranslator(language, vscodeLanguage);

  const existing = editId ? connections.find((c) => c.id === editId) : undefined;
  const [config, setConfig] = useState<FtpConnectionConfig>(existing ?? emptyConfig());
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    if (pickedFiles.privateKey) {
      setConfig((c) => ({ ...c, privateKeyPath: pickedFiles.privateKey }));
    }
  }, [pickedFiles]);

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
        <h1>{editId ? t.editServer : t.addServerTitle}</h1>
        <button className="back-btn" onClick={() => setViewState({ view: 'welcome' })}>
          {t.back}
        </button>
      </div>

      <div className="form">
        <div className="form-group">
          <label>{t.name}</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
            placeholder="My Server"
          />
        </div>

        <div className="form-group">
          <label>{t.protocol}</label>
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
            <label>{t.host}</label>
            <input
              type="text"
              value={config.host}
              onChange={(e) => setConfig((c) => ({ ...c, host: e.target.value }))}
              placeholder="ftp.example.com"
            />
          </div>
          <div className="form-group flex-1">
            <label>{t.port}</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => setConfig((c) => ({ ...c, port: Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label>{t.username}</label>
            <input
              type="text"
              value={config.username}
              onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))}
              placeholder="anonymous"
            />
          </div>
          <div className="form-group flex-1">
            <label>{t.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editId ? t.unchanged : ''}
            />
          </div>
        </div>

        <div className="form-group">
          <label>{t.remotePath}</label>
          <input
            type="text"
            value={config.remotePath}
            onChange={(e) => setConfig((c) => ({ ...c, remotePath: e.target.value }))}
            placeholder={t.remotePathPlaceholder}
          />
        </div>

        <div className="form-group">
          <label>{t.group}</label>
          <input
            type="text"
            value={config.group ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, group: e.target.value.trim() || undefined }))}
            placeholder="Clients, Perso, Production, Staging..."
          />
        </div>

        {(config.protocol === 'ftp' || config.protocol === 'ftps') && (
          <div className="form-group">
            <label>{t.dataTransferMode}</label>
            <div className="protocol-selector">
              <button
                className={`protocol-btn ${config.passiveMode !== false ? 'active' : ''}`}
                onClick={() => setConfig((c) => ({ ...c, passiveMode: true }))}
              >
                {t.passive}
              </button>
              <button
                className={`protocol-btn ${config.passiveMode === false ? 'active' : ''}`}
                onClick={() => setConfig((c) => ({ ...c, passiveMode: false }))}
              >
                {t.extendedPassive}
              </button>
            </div>
            <small style={{ opacity: 0.7 }}>
              {t.transferModeHelp}
            </small>
          </div>
        )}

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={config.compareBeforeOverwrite === true}
              onChange={(e) => setConfig((c) => ({ ...c, compareBeforeOverwrite: e.target.checked || undefined }))}
            />
            {t.compareBeforeOverwrite}
          </label>
          <small style={{ opacity: 0.7 }}>
            {t.compareHelp}
          </small>
        </div>

        <div className="permissions-section">
          <h3>{t.defaultPermissions}</h3>
          <div className="form-row">
            <div className="form-group flex-1">
              <label>{t.files}</label>
              <input
                type="text"
                value={config.defaultFilePermissions ?? '644'}
                onChange={(e) => setConfig((c) => ({ ...c, defaultFilePermissions: e.target.value.trim() || undefined }))}
                placeholder="644"
                pattern="[0-7]{3,4}"
              />
            </div>
            <div className="form-group flex-1">
              <label>{t.folders}</label>
              <input
                type="text"
                value={config.defaultFolderPermissions ?? '755'}
                onChange={(e) => setConfig((c) => ({ ...c, defaultFolderPermissions: e.target.value.trim() || undefined }))}
                placeholder="755"
                pattern="[0-7]{3,4}"
              />
            </div>
          </div>
          <small>
            {t.permissionsHelp}
          </small>
        </div>

        {config.protocol === 'sftp' && (
          <div className="sftp-section">
            <h3>{t.sshKeyAuthentication}</h3>
            <div className="form-group">
              <label>{t.privateKey}</label>
              <div className="file-input-row">
                <input
                  type="text"
                  value={config.privateKeyPath ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, privateKeyPath: e.target.value }))}
                  placeholder="~/.ssh/id_rsa"
                  readOnly
                />
                <button onClick={() => postMessage({ type: 'browsePrivateKey' })}>{t.browse}</button>
              </div>
            </div>
            {config.privateKeyPath && (
              <div className="form-group">
                <label>{t.passphrase}</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t.encryptedKey}
                />
              </div>
            )}
          </div>
        )}

        {testResult && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? t.connectionSuccessful : testResult.error}
          </div>
        )}

        <div className="form-actions">
          <button onClick={handleTest} disabled={isTesting || !config.host.trim()}>
            {isTesting ? t.testing : t.testConnection}
          </button>
          <div className="spacer" />
          <button onClick={() => setViewState({ view: 'welcome' })}>{t.cancel}</button>
          <button
            className="primary"
            onClick={handleSave}
            disabled={!config.name.trim() || !config.host.trim()}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
