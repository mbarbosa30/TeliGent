import TelegramBot from "node-telegram-bot-api";
import type { BotConfig } from "@shared/schema";

export const HOMOGLYPH_MAP: Record<string, string> = {
  '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0421': 'C', '\u0441': 'c',
  '\u0415': 'E', '\u0435': 'e', '\u041D': 'H', '\u043E': 'o', '\u041E': 'O',
  '\u0420': 'P', '\u0440': 'p', '\u0422': 'T', '\u0443': 'y', '\u0425': 'X',
  '\u0445': 'x', '\u0417': '3', '\u0456': 'i', '\u0406': 'I',
  '\u0131': 'i', '\u0130': 'I',
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
  '\u2013': '-', '\u2014': '-',
  '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u00AD': '',
  '\u2060': '', '\u180E': '',
  '\u00B0': ' ', '\u00B7': ' ', '\u2022': ' ', '\u2023': ' ', '\u2043': ' ',
  '\u25E6': ' ', '\u2219': ' ', '\u22C5': ' ', '\u2027': ' ',
  '\u2024': '.', '\u2025': '..', '\u2026': '...',
  '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2004': ' ', '\u2005': ' ',
  '\u2006': ' ', '\u2007': ' ', '\u2008': ' ', '\u2009': ' ', '\u200A': ' ',
  '\u202F': ' ', '\u205F': ' ', '\u3000': ' ',
  '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
  '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
  '\u2078': '8', '\u2079': '9',
  '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3',
  '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7',
  '\u2088': '8', '\u2089': '9',
  '\uFF10': '0', '\uFF11': '1', '\uFF12': '2', '\uFF13': '3',
  '\uFF14': '4', '\uFF15': '5', '\uFF16': '6', '\uFF17': '7',
  '\uFF18': '8', '\uFF19': '9',
  '\u2500': '-', '\u2501': '-', '\u2502': '|', '\u2503': '|',
  '\uFE4D': '_', '\uFE4E': '_', '\uFE4F': '_',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-',
  '\uFE58': '-', '\uFE63': '-', '\uFF0D': '-',
};

export function fixHomoglyphWords(text: string): string {
  return text.replace(/\b\w+\b/g, (word) => {
    const lower = word.toLowerCase();
    if (/[A-Z]/.test(word) && /[a-z]/.test(word)) {
      const fixed = word
        .replace(/I(?=[a-z])/g, 'l')
        .replace(/(?<=[a-z])I/g, 'l');
      if (fixed !== word) return fixed;
    }
    const allLower = lower
      .replace(/0/g, 'o')
      .replace(/1/g, 'l')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/\$/g, 's');
    if (allLower !== lower) {
      return word.length === lower.length ? allLower : word;
    }
    return word;
  });
}

export function normalizeUnicode(text: string): string {
  const ranges: [number, number, number][] = [
    [0x1D400, 0x1D419, 0x41], [0x1D41A, 0x1D433, 0x61],
    [0x1D434, 0x1D44D, 0x41], [0x1D44E, 0x1D467, 0x61],
    [0x1D468, 0x1D481, 0x41], [0x1D482, 0x1D49B, 0x61],
    [0x1D49C, 0x1D4B5, 0x41], [0x1D4B6, 0x1D4CF, 0x61],
    [0x1D4D0, 0x1D4E9, 0x41], [0x1D4EA, 0x1D503, 0x61],
    [0x1D504, 0x1D51D, 0x41], [0x1D51E, 0x1D537, 0x61],
    [0x1D538, 0x1D551, 0x41], [0x1D552, 0x1D56B, 0x61],
    [0x1D56C, 0x1D585, 0x41], [0x1D586, 0x1D59F, 0x61],
    [0x1D5A0, 0x1D5B9, 0x41], [0x1D5BA, 0x1D5D3, 0x61],
    [0x1D5D4, 0x1D5ED, 0x41], [0x1D5EE, 0x1D607, 0x61],
    [0x1D608, 0x1D621, 0x41], [0x1D622, 0x1D63B, 0x61],
    [0x1D63C, 0x1D655, 0x41], [0x1D656, 0x1D66F, 0x61],
    [0x1D670, 0x1D689, 0x41], [0x1D68A, 0x1D6A3, 0x61],
    [0xFF21, 0xFF3A, 0x41], [0xFF41, 0xFF5A, 0x61],
    [0x24B6, 0x24CF, 0x41], [0x24D0, 0x24E9, 0x61],
  ];

  let result = "";
  for (const char of text) {
    if (HOMOGLYPH_MAP[char] !== undefined) {
      result += HOMOGLYPH_MAP[char];
      continue;
    }
    const cp = char.codePointAt(0)!;
    let mapped = false;
    for (const [start, end, base] of ranges) {
      if (cp >= start && cp <= end) {
        result += String.fromCharCode(base + (cp - start));
        mapped = true;
        break;
      }
    }
    if (!mapped) {
      result += char;
    }
  }
  result = result.replace(/\s{2,}/g, ' ').trim();
  result = result.replace(/\b([A-Za-z])\s+(?=[A-Za-z]\b)/g, '$1');
  result = result.replace(/(?<=[A-Za-z0-9])[.,;:!?]+(?=[A-Za-z0-9])/g, '');
  result = result.replace(/#(\w)/g, '$1');
  result = fixHomoglyphWords(result);
  return result;
}

export function hasHomoglyphEvasion(original: string, normalized: string): boolean {
  if (original === normalized) return false;
  const ilSwaps = /[A-Z]/.test(original) && /I/.test(original);
  const origWords = original.split(/\s+/);
  const normWords = normalized.split(/\s+/);
  let letterSwaps = 0;
  for (let i = 0; i < Math.min(origWords.length, normWords.length); i++) {
    const ow = origWords[i];
    const nw = normWords[i];
    if (ow === nw || ow.length < 4) continue;
    const owClean = ow.replace(/[^a-zA-Z]/g, "");
    const nwClean = nw.replace(/[^a-zA-Z]/g, "");
    if (owClean.length === nwClean.length && owClean !== nwClean) {
      let diffs = 0;
      for (let j = 0; j < owClean.length; j++) {
        if (owClean[j] !== nwClean[j]) diffs++;
      }
      if (diffs > 0 && diffs <= 2) letterSwaps++;
    }
  }
  return ilSwaps && letterSwaps >= 2;
}

export function checkNameImpersonation(msg: TelegramBot.Message, config: BotConfig): boolean {
  const senderName = (
    (msg.from?.first_name || "") + " " + (msg.from?.last_name || "")
  ).trim().toLowerCase();
  const senderUsername = (msg.from?.username || "").toLowerCase();
  const botName = (config.botName || "").toLowerCase().trim();
  const groupName = (msg.chat.title || "").toLowerCase().trim();

  if (!senderName && !senderUsername) return false;
  if (botName.length < 3 && groupName.length < 3) return false;

  const normalize = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const senderNorm = normalize(senderName);
  const senderUserNorm = normalize(senderUsername);

  if (botName.length >= 3) {
    const botNorm = normalize(botName);
    if (botNorm.length >= 3 && (senderNorm.includes(botNorm) || senderUserNorm.includes(botNorm))) {
      return true;
    }
  }
  if (groupName.length >= 3) {
    const groupNorm = normalize(groupName);
    if (groupNorm.length >= 3 && (senderNorm.includes(groupNorm) || senderUserNorm.includes(groupNorm))) {
      return true;
    }
  }
  return false;
}
