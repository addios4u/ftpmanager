declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let _vscode: ReturnType<typeof acquireVsCodeApi> | undefined;

export function getVsCodeApi() {
  if (!_vscode) {
    _vscode = acquireVsCodeApi();
  }
  return _vscode;
}

export function postMessage(message: unknown): void {
  getVsCodeApi().postMessage(message);
}
