// Regression test for the screenshot the user sent: a forwarded message
// from a "HOT GIRLS" channel where the entire payload lives inside an
// inline-keyboard grid (WATCH ARCHIVE / MILF / LE5BIAN / CREAMPIE / ZOO /
// HINDI / SCHOOLGIRL / P0RN / GAYS) with t.me links. Pre-fix, the bot
// returned early because msg.text was empty and never even ran the scam
// pipeline.
//
// Run with: tsx tests/nsfw-button-spam.test.ts

import type TelegramBot from "node-telegram-bot-api";
import {
  buildScanText,
  extractInlineButtonText,
  isButtonGridForwardSpam,
} from "../server/telegram/scam-detection";
import { runAllPatterns } from "../server/telegram/scam-patterns";
import { normalizeUnicode } from "../server/telegram/normalization";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

function makeMsg(overrides: Partial<TelegramBot.Message>): TelegramBot.Message {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: -100, type: "supergroup", title: "test group" },
    from: { id: 99, is_bot: false, first_name: "Raphael Romeo" },
    ...overrides,
  } as TelegramBot.Message;
}

const screenshotMsg = makeMsg({
  forward_date: Math.floor(Date.now() / 1000) - 60,
  reply_markup: {
    inline_keyboard: [
      [{ text: "📁 WATCH ARCHIVE 👀💦", url: "https://t.me/+abcdef123456" }],
      [
        { text: "MILF 🌸💦", url: "https://t.me/+milf01" },
        { text: "LE5BIAN 🔞🔥", url: "https://t.me/+les01" },
      ],
      [
        { text: "CREAMPIE 🌹💋", url: "https://t.me/+cream01" },
        { text: "ZOO 🐕😱", url: "https://t.me/+zoo01" },
      ],
      [{ text: "📁 WATCH ARCHIVE 👀💦", url: "https://t.me/+abcdef654321" }],
      [
        { text: "HINDI 💋💥", url: "https://t.me/+hindi01" },
        { text: "SCHOOLGIRL 🏫😳", url: "https://t.me/+sch01" },
      ],
      [
        { text: "P0RN 👅❤️‍🔥", url: "https://t.me/+porn01" },
        { text: "GAYS 😳🍌", url: "https://t.me/+gay01" },
      ],
    ],
  },
});

console.log("[nsfw-button-spam] regression for screenshot from 2026-05-03\n");

// 1. Button extraction.
const aux = extractInlineButtonText(screenshotMsg);
assert(aux.totalButtons === 10, `extracted 10 buttons (got ${aux.totalButtons})`);
assert(aux.externalUrlCount === 10, `all 10 URLs are external (got ${aux.externalUrlCount})`);
assert(aux.buttonText.includes("WATCH ARCHIVE"), "button text contains WATCH ARCHIVE");
assert(aux.buttonText.includes("LE5BIAN"), "button text contains LE5BIAN");

// 2. Combined scan text is non-empty even though msg.text is undefined.
const scanText = buildScanText(screenshotMsg);
assert(scanText.length > 0, "buildScanText returns non-empty payload for button-only message");
assert(/MILF/.test(scanText), "scan text contains MILF");

// 3. Structural detector fires (forwarded + many buttons + many external URLs).
assert(isButtonGridForwardSpam(screenshotMsg), "isButtonGridForwardSpam returns true for the screenshot");

// 4. After normalization, digit-substituted words come back to plain words
//    and the deterministic pattern set fires.
const normalized = normalizeUnicode(scanText);
assert(/lesbian/i.test(normalized), `normalizer recovers "LE5BIAN" -> "lesbian" (got: "${normalized.slice(0, 200)}")`);
assert(/porn/i.test(normalized), `normalizer recovers "P0RN" -> "porn"`);

const hits = runAllPatterns(normalized, scanText);
assert(hits.get("nsfwSpam") === true, "nsfwSpam pattern matches the screenshot payload");

// 5. Negative control: the same button grid sent NOT as a forward should
//    not trigger isButtonGridForwardSpam (still caught by nsfwSpam, but
//    the structural rule must require the forward bit).
const notForwarded = makeMsg({ reply_markup: screenshotMsg.reply_markup });
assert(!isButtonGridForwardSpam(notForwarded), "isButtonGridForwardSpam stays false when message is not a forward");

// 6. Negative control: a single benign button on a forwarded post must
//    not trip the structural rule.
const benignForward = makeMsg({
  forward_date: Math.floor(Date.now() / 1000),
  text: "check out our blog post",
  reply_markup: { inline_keyboard: [[{ text: "Read more", url: "https://example.com/blog/1" }]] },
});
assert(!isButtonGridForwardSpam(benignForward), "single CTA button on a forwarded post is not flagged");
const benignHits = runAllPatterns(normalizeUnicode(buildScanText(benignForward)), buildScanText(benignForward));
const benignMatched: string[] = [];
for (const [n, h] of benignHits.entries()) if (h) benignMatched.push(n);
assert(benignMatched.length === 0, `benign forwarded post stays clean (matched: [${benignMatched.join(", ")}])`);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
