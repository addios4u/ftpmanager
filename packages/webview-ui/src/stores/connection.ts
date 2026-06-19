import { create } from 'zustand';
import type { FtpConnectionInfo, FtpManagerLanguage, FtpManagerLanguageOption, ViewState } from '@ftpmanager/shared';

interface TestResult {
  success: boolean;
  error?: string;
}

interface ConnectionStore {
  connections: FtpConnectionInfo[];
  viewLocation: 'explorer' | 'activityBar';
  language: FtpManagerLanguage;
  languageOptions: FtpManagerLanguageOption[];
  vscodeLanguage: string;
  viewState: ViewState;
  testResult: TestResult | null;
  isTesting: boolean;
  pickedFiles: Record<string, string>;

  setConnections: (connections: FtpConnectionInfo[]) => void;
  setViewLocation: (viewLocation: 'explorer' | 'activityBar') => void;
  setLanguage: (language: FtpManagerLanguage) => void;
  setLanguageOptions: (languageOptions: FtpManagerLanguageOption[]) => void;
  setVscodeLanguage: (vscodeLanguage: string) => void;
  setViewState: (state: ViewState) => void;
  setTestResult: (result: TestResult | null) => void;
  setIsTesting: (v: boolean) => void;
  setPickedFile: (target: string, filePath: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connections: [],
  viewLocation: 'explorer',
  language: 'auto',
  languageOptions: [
    { value: 'auto', label: 'Auto' },
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
  ],
  vscodeLanguage: 'en',
  viewState: { view: 'welcome' },
  testResult: null,
  isTesting: false,
  pickedFiles: {},

  setConnections: (connections) => set({ connections }),
  setViewLocation: (viewLocation) => set({ viewLocation }),
  setLanguage: (language) => set({ language }),
  setLanguageOptions: (languageOptions) => set({ languageOptions }),
  setVscodeLanguage: (vscodeLanguage) => set({ vscodeLanguage }),
  setViewState: (viewState) => set({ viewState }),
  setTestResult: (testResult) => set({ testResult, isTesting: false }),
  setIsTesting: (isTesting) => set({ isTesting }),
  setPickedFile: (target, filePath) =>
    set((state) => ({ pickedFiles: { ...state.pickedFiles, [target]: filePath } })),
}));
