// Webhook auth hardening regression test for Task #72.
//
// Run with:  tsx tests/webhook-auth.test.ts
//
// Mounts the REAL production webhook handler (registerWebhookRouteForTest)
// against a known token mapping seeded via the test-only export, then
// asserts every malformed/spoofed auth shape returns a deterministic 401
// (never 200, 403, or 500).

import express from "express";
import type { AddressInfo } from "net";
import crypto from "crypto";
import {
  registerWebhookRouteForTest,
  _testOnlyAddWebhookMapping,
  _testOnlyClearWebhookMapping,
  _testOnlyGetWebhookSecret,
} from "../server/telegram/index";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

async function main() {
  const fakeToken = "1234567890:fake-test-token-for-auth-check";
  const hash = crypto.createHash("sha256").update(fakeToken).digest("hex").slice(0, 16);
  const path = `/api/telegram-webhook/${hash}`;
  const expectedSecret = _testOnlyGetWebhookSecret(fakeToken);

  const app = express();
  app.use(express.json());
  registerWebhookRouteForTest(app);
  _testOnlyAddWebhookMapping(path, fakeToken);

  const server = app.listen(0);
  await new Promise<void>(r => server.on("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function post(p: string, headers: Record<string, string> = {}): Promise<number> {
    const res = await fetch(`${base}${p}`, { method: "POST", headers, body: "{}" });
    return res.status;
  }

  // 1. Unmapped path -> 401 (was 200 in pre-fix code).
  assert(
    (await post("/api/telegram-webhook/deadbeefdeadbeef", { "content-type": "application/json", "x-telegram-bot-api-secret-token": expectedSecret })) === 401,
    "unmapped hash returns 401",
  );

  // 2. Mapped path, no header -> 401.
  assert((await post(path, { "content-type": "application/json" })) === 401, "missing secret_token returns 401");

  // 3. Mapped path, wrong-length header -> 401 (no 500).
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": "short" })) === 401,
    "short secret_token returns 401",
  );

  // 4. Multi-byte UTF-8 spoof: equal char length, different byte length.
  // This would have crashed timingSafeEqual without the shape pre-check.
  const utf8Spoof = "x".repeat(31) + "\u00ff";
  assert(utf8Spoof.length === expectedSecret.length, "spoof has equal char length to expected secret");
  assert(Buffer.byteLength(utf8Spoof, "utf8") !== expectedSecret.length, "spoof has different byte length");
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": utf8Spoof })) === 401,
    "multi-byte UTF-8 header returns 401, not 500",
  );

  // 5. Wrong secret of correct length -> 401.
  const wrong = "0".repeat(32);
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": wrong })) === 401,
    "wrong-but-valid-shape secret returns 401",
  );

  // 6. Correct secret -> 200.
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": expectedSecret })) === 200,
    "correct secret returns 200",
  );

  // 7. Header value with disallowed char ('+' is outside [A-Za-z0-9_-]) -> 401.
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": expectedSecret + "+" })) === 401,
    "header with disallowed char returns 401",
  );

  // 8. Stale-mapping cleanup contract: removing the mapping must immediately
  // cause subsequent requests with the previously-valid secret to 401.
  _testOnlyClearWebhookMapping(path);
  assert(
    (await post(path, { "content-type": "application/json", "x-telegram-bot-api-secret-token": expectedSecret })) === 401,
    "removing mapping causes previously-valid secret to 401",
  );

  server.close();

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("test crashed:", err);
  process.exit(2);
});
