import { create } from 'zustand';
import type { FtpConnectionInfo, ViewState } from '@ftpmanager/shared';

interface TestResult {
  success: boolean;
  error?: string;
}

interface ConnectionStore {
  connections: FtpConnectionInfo[];
  viewState: ViewState;
  testResult: TestResult | null;
  isTesting: boolean;
  pickedFiles: Record<string, string>;

  setConnections: (connections: FtpConnectionInfo[]) => void;
  setViewState: (state: ViewState) => void;
  setTestResult: (result: TestResult | null) => void;
  setIsTesting: (v: boolean) => void;
  setPickedFile: (target: string, filePath: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connections: [],
  viewState: { view: 'welcome' },
  testResult: null,
  isTesting: false,
  pickedFiles: {},

  setConnections: (connections) => set({ connections }),
  setViewState: (viewState) => set({ viewState }),
  setTestResult: (testResult) => set({ testResult, isTesting: false }),
  setIsTesting: (isTesting) => set({ isTesting }),
  setPickedFile: (target, filePath) =>
    set((state) => ({ pickedFiles: { ...state.pickedFiles, [target]: filePath } })),
}));
