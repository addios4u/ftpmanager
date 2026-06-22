import React from 'react';
import type { FtpManagerLanguage } from '@ftpmanager/shared';
import { createTranslator } from '../../i18n.js';
import { useConnectionStore } from '../../stores/connection.js';
import { postMessage } from '../../vscode-api.js';

export function WelcomeView() {
  const {
    connections,
    language,
    languageOptions,
    setLanguage,
    setViewState,
    setViewLocation,
    viewLocation,
    vscodeLanguage,
  } = useConnectionStore();
  const t = createTranslator(language, vscodeLanguage);

  const updateViewLocation = (nextLocation: 'explorer' | 'activityBar') => {
    setViewLocation(nextLocation);
    postMessage({ type: 'updateViewLocation', viewLocation: nextLocation });
  };

  const updateLanguage = (nextLanguage: FtpManagerLanguage) => {
    setLanguage(nextLanguage);
    postMessage({ type: 'updateLanguage', language: nextLanguage });
  };

  return (
    <div className="welcome-view">
      <div className="welcome-header">
        <h1>FTP Manager</h1>
        <p>{t.connectSubtitle}</p>
      </div>

      <div className="configuration-actions">
        <button onClick={() => postMessage({ type: 'importConnections' })}>
          {t.import}
        </button>
        <button onClick={() => postMessage({ type: 'exportConnections' })}>
          {t.export}
        </button>
      </div>
      <div className="security-warning">
        {t.securityWarning}
      </div>

      <div className="view-location-setting">
        <div>
          <h2>{t.viewLocation}</h2>
          <p>{t.viewLocationDescription}</p>
        </div>
        <div className="segmented-control" role="group" aria-label="FTPManager view location">
          <button
            className={viewLocation === 'explorer' ? 'active' : ''}
            onClick={() => updateViewLocation('explorer')}
          >
            {t.explorer}
          </button>
          <button
            className={viewLocation === 'activityBar' ? 'active' : ''}
            onClick={() => updateViewLocation('activityBar')}
          >
            {t.activityBar}
          </button>
        </div>
      </div>

      <div className="view-location-setting">
        <div>
          <h2>{t.language}</h2>
          <p>{t.languageDescription}</p>
        </div>
        <select
          className="language-select"
          value={language}
          onChange={(event) => updateLanguage(event.target.value as FtpManagerLanguage)}
          aria-label="FTPManager language"
        >
          {languageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'auto' ? t.automatic : option.label}
            </option>
          ))}
        </select>
      </div>

      {connections.length > 0 && (
        <div className="server-list">
          <h2>{t.savedServers}</h2>
          {connections.map((conn) => (
            <div key={conn.id} className="server-item">
              <span className={`protocol-badge ${conn.protocol}`}>{conn.protocol.toUpperCase()}</span>
              <span className="server-name">{conn.name}</span>
              <span className="server-host">{conn.host}:{conn.port}</span>
              <div className="server-actions">
                <button
                  onClick={() => setViewState({ view: 'connectionDialog', editId: conn.id })}
                >
                  {t.edit}
                </button>
                <button
                  className="danger"
                  onClick={() => postMessage({ type: 'deleteConnection', connectionId: conn.id })}
                >
                  {t.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="welcome-actions">
        <button
          className="add-server-btn"
          onClick={() => setViewState({ view: 'connectionDialog' })}
        >
          {t.addServer}
        </button>
        <button
          className="coffee-btn"
          onClick={() => postMessage({ type: 'openExternal', url: 'https://buymeacoffee.com/addios4u' })}
        >
          {t.buyMeACoffee}
        </button>
      </div>
    </div>
  );
}
