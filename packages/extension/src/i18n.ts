import * as vscode from 'vscode';

type RuntimeLanguage = 'en' | 'fr' | 'ja' | 'ko' | 'zh-cn';

const runtimeMessages: Record<RuntimeLanguage, Record<string, string>> = {
  en: {
    'Active editor server': 'Active editor server',
    'Connected': 'Connected',
    'Open remote file': 'Open remote file',
    'Opened Files': 'Opened Files',
    'Recent Files': 'Recent Files',
    'Unsaved remote changes': 'Unsaved remote changes',
  },
  fr: {
    'Active editor server': 'Serveur de l\u2019\u00e9diteur actif',
    'Connected': 'Connect\u00e9',
    'Open remote file': 'Fichier distant ouvert',
    'Opened Files': 'Fichiers ouverts',
    'Recent Files': 'Fichiers r\u00e9cents',
    'Unsaved remote changes': 'Modifications distantes non enregistr\u00e9es',
  },
  ja: {
    'Active editor server': '\u30a2\u30af\u30c6\u30a3\u30d6\u306a\u30a8\u30c7\u30a3\u30bf\u30fc\u306e\u30b5\u30fc\u30d0\u30fc',
    'Connected': '\u63a5\u7d9a\u6e08\u307f',
    'Open remote file': '\u958b\u3044\u3066\u3044\u308b\u30ea\u30e2\u30fc\u30c8\u30d5\u30a1\u30a4\u30eb',
    'Opened Files': '\u958b\u3044\u3066\u3044\u308b\u30d5\u30a1\u30a4\u30eb',
    'Recent Files': '\u6700\u8fd1\u4f7f\u3063\u305f\u30d5\u30a1\u30a4\u30eb',
    'Unsaved remote changes': '\u672a\u4fdd\u5b58\u306e\u30ea\u30e2\u30fc\u30c8\u5909\u66f4',
  },
  ko: {
    'Active editor server': '\ud65c\uc131 \ud3b8\uc9d1\uae30 \uc11c\ubc84',
    'Connected': '\uc5f0\uacb0\ub428',
    'Open remote file': '\uc5f4\ub9b0 \uc6d0\uaca9 \ud30c\uc77c',
    'Opened Files': '\uc5f4\ub9b0 \ud30c\uc77c',
    'Recent Files': '\ucd5c\uadfc \ud30c\uc77c',
    'Unsaved remote changes': '\uc800\uc7a5\ub418\uc9c0 \uc54a\uc740 \uc6d0\uaca9 \ubcc0\uacbd \uc0ac\ud56d',
  },
  'zh-cn': {
    'Active editor server': '\u6d3b\u52a8\u7f16\u8f91\u5668\u670d\u52a1\u5668',
    'Connected': '\u5df2\u8fde\u63a5',
    'Open remote file': '\u6253\u5f00\u7684\u8fdc\u7a0b\u6587\u4ef6',
    'Opened Files': '\u6253\u5f00\u7684\u6587\u4ef6',
    'Recent Files': '\u6700\u8fd1\u6587\u4ef6',
    'Unsaved remote changes': '\u672a\u4fdd\u5b58\u7684\u8fdc\u7a0b\u66f4\u6539',
  },
};

function getRuntimeLanguage(): RuntimeLanguage {
  const configured = vscode.workspace
    .getConfiguration('ftpmanager')
    .get<string>('language', 'auto')
    .toLowerCase();
  const language = configured === 'auto' ? vscode.env.language.toLowerCase() : configured;

  if (language.startsWith('fr')) return 'fr';
  if (language.startsWith('ja')) return 'ja';
  if (language.startsWith('ko')) return 'ko';
  if (language === 'zh-cn' || language.startsWith('zh')) return 'zh-cn';
  return 'en';
}

export function runtimeT(message: string): string {
  return runtimeMessages[getRuntimeLanguage()][message] ?? vscode.l10n.t(message);
}
