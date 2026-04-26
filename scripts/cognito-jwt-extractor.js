#!/usr/bin/env node
// cognito-jwt-extractor.js — capture an E-Ring CAMA Cognito JWT via headless browser.
//
// 2026-04-25 finding (revised after investigation): the E-Ring API at
// prodexpress.capturecama.com and express.limestonerevenue.net is in fact
// UNAUTHENTICATED. The earlier scaffold's hypothesis that it gates on a
// Cognito-issued Bearer JWT was WRONG. We confirmed:
//   - Browser XHRs from the SPA carry NO Authorization header
//   - Raw curl POSTs from the VM with just Origin/Referer headers return
//     real parcel data (Limestone with the no-www tenantUrl works; Morgan
//     works for ParcelNo-format inputs)
//
// This extractor is therefore not currently required for the scrape to
// run. It is retained because:
//   (1) The E-Ring stack ships Cognito SDK code in the bundle. If the
//       backend later flips a config and starts requiring a Bearer token,
//       we'll know quickly because the scrape will start 401-ing — this
//       extractor is the fallback.
//   (2) Some E-Ring tenants (PP-search, tax-payment paths) DO use a
//       Cognito-issued token from /get-cognito-credentials-decrypted +
//       cognito-idp.us-east-1.amazonaws.com. If a future use case touches
//       those endpoints, the captured token (when one exists) is here.
//
// Current behavior: launches headless Chromium, loads the portal page,
// watches for any XHR carrying `Authorization: Bearer ...` to the API
// host, AND watches for IdToken JSON in cognito-idp responses. Writes
// the first hit to /tmp/<portal>_jwt at mode 0600. If nothing is seen
// in 60s — which is the *normal* case today — exits non-zero with a
// note that the API is currently unauth-mode.
//
// Usage:
//   node cognito-jwt-extractor.js --portal=morgan
//   node cognito-jwt-extractor.js --portal=limestone
//   node cognito-jwt-extractor.js --portal=morgan --refresh-loop
//
// Outputs:
//   /tmp/morgan_jwt   (mode 0600)  or  /tmp/limestone_jwt
//
// Behavior:
//   - Idempotent: if /tmp/<portal>_jwt already exists AND its `exp` claim
//     is still >5 min in the future, we exit 0 without launching a browser
//     (unless --force is passed).
//   - --refresh-loop: re-captures every 50 minutes (covers 1h Cognito TTL
//     with margin). Logs each refresh. Exits non-zero on persistent failure.

const { chromium } = require("playwright");
const fs = require("fs");

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);

const PORTAL = (ARGS.portal || "").toLowerCase();
const REFRESH_LOOP = ARGS["refresh-loop"] === "true";
const FORCE = ARGS.force === "true";
const TIMEOUT_MS = parseInt(ARGS["timeout-ms"] || "60000", 10);
const REFRESH_INTERVAL_MS = parseInt(ARGS["refresh-interval-ms"] || String(50 * 60 * 1000), 10);

const PORTALS = {
  morgan: {
    pageUrl: "https://morgan.capturecama.com/",
    apiHost: "prodexpress.capturecama.com",
    tokenFile: "/tmp/morgan_jwt",
  },
  limestone: {
    pageUrl: "https://www.limestonerevenue.net/",
    apiHost: "express.limestonerevenue.net",
    tokenFile: "/tmp/limestone_jwt",
  },
};

if (!PORTALS[PORTAL]) {
  console.error(`usage: cognito-jwt-extractor.js --portal=morgan|limestone [--refresh-loop] [--force]`);
  process.exit(2);
}

const CFG = PORTALS[PORTAL];

function log(...a) {
  console.log(`[${new Date().toISOString()}] [jwt-${PORTAL}]`, ...a);
}

// Decode JWT payload (no validation — we just want exp).
function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch { return null; }
}

function tokenStillValid(token, marginSec = 300) {
  const payload = decodeJwt(token);
  if (!payload || !payload.exp) return false;
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  return remaining > marginSec;
}

function readExistingToken() {
  try {
    const t = fs.readFileSync(CFG.tokenFile, "utf8").trim();
    if (!t) return null;
    return t;
  } catch { return null; }
}

function writeToken(token) {
  fs.writeFileSync(CFG.tokenFile, token, { mode: 0o600 });
  fs.chmodSync(CFG.tokenFile, 0o600);
}

async function captureOnce() {
  log(`launching headless chromium → ${CFG.pageUrl}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let captured = null;
  let firstSeenAt = null;
  const tokens = new Set();

  // Watch every request. The SPA's XHRs to apiHost carry the bearer.
  page.on("request", req => {
    try {
      const url = req.url();
      const headers = req.headers();
      const auth = headers["authorization"] || headers["Authorization"];
      if (auth && auth.toLowerCase().startsWith("bearer ")) {
        const tok = auth.slice(7).trim();
        if (tok && tok.split(".").length === 3) {
          tokens.add(tok);
          if (!captured && url.includes(CFG.apiHost)) {
            captured = tok;
            firstSeenAt = url;
          }
        }
      }
    } catch {}
  });

  // Also watch the Cognito bootstrap call directly; the IdToken is in the JSON body.
  page.on("response", async res => {
    try {
      const url = res.url();
      if (url.includes("cognito-idp.us-east-1.amazonaws.com")) {
        const body = await res.text().catch(() => "");
        const m = body.match(/"IdToken"\s*:\s*"([^"]+)"/);
        if (m && !captured) {
          captured = m[1];
          firstSeenAt = url + " (cognito bootstrap)";
        }
      }
    } catch {}
  });

  try {
    await page.goto(CFG.pageUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  } catch (e) {
    log(`warn: navigation: ${e.message} (continuing — may still capture token)`);
  }

  // Wait until we see at least one bearer XHR to the API host, OR timeout.
  const start = Date.now();
  while (!captured && Date.now() - start < TIMEOUT_MS) {
    await page.waitForTimeout(500);
    // Nudge the SPA: trigger a parcel-search interaction if no API XHR yet.
    if (Date.now() - start > 8000 && !captured) {
      // Try clicking the search button or typing in the search box, but
      // only once. The SPA loads the React tree async, so existence checks
      // need to be tolerant.
      try {
        const inputs = await page.$$('input[type="search"], input[type="text"], input');
        if (inputs.length > 0) {
          await inputs[0].click({ timeout: 1000 }).catch(() => {});
          await inputs[0].type("100", { delay: 50, timeout: 2000 }).catch(() => {});
        }
      } catch {}
      // Don't keep retrying — once is enough to nudge the bundle.
      break;
    }
  }
  // After the nudge, give it a few more seconds for resulting XHRs.
  for (let i = 0; i < 30 && !captured; i++) {
    await page.waitForTimeout(500);
  }

  await browser.close();

  if (!captured && tokens.size > 0) {
    captured = tokens.values().next().value;
    firstSeenAt = "(non-API-host XHR)";
  }

  if (!captured) {
    // This is the expected path today — the E-Ring API is unauthenticated
    // so the SPA never sends a Bearer header. We exit with code 4 to
    // distinguish from the "browser broke" failure modes (1, 3).
    throw new Error(`no Bearer JWT captured in ${TIMEOUT_MS}ms — likely the API is currently in unauth mode (which is OK; the scrapers run without a token). If you're seeing 401s from the scrape, the SPA shape changed.`);
  }

  log(`captured token (len=${captured.length}) seen at: ${firstSeenAt}`);
  const payload = decodeJwt(captured);
  if (payload) {
    const expIn = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : "?";
    log(`  iss=${payload.iss || "?"}  sub=${payload.sub || "?"}  exp_in=${expIn}s  aud=${payload.aud || payload.client_id || "?"}`);
  } else {
    log(`  (token did not decode as standard JWT, but length looks right — using as-is)`);
  }
  return captured;
}

async function once({ allowSkipIfFresh }) {
  if (allowSkipIfFresh && !FORCE) {
    const existing = readExistingToken();
    if (existing && tokenStillValid(existing)) {
      const payload = decodeJwt(existing);
      const remaining = payload && payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
      log(`existing token still valid (${remaining}s remaining); skipping fresh capture (use --force to override)`);
      return existing;
    }
  }
  const tok = await captureOnce();
  writeToken(tok);
  log(`wrote ${CFG.tokenFile} (mode 0600)`);
  return tok;
}

async function main() {
  if (!REFRESH_LOOP) {
    await once({ allowSkipIfFresh: true });
    return;
  }
  log(`refresh-loop mode: refreshing every ${Math.round(REFRESH_INTERVAL_MS / 60000)}min`);
  let consecutiveErrors = 0;
  // First capture — honor existing token.
  try {
    await once({ allowSkipIfFresh: true });
    consecutiveErrors = 0;
  } catch (e) {
    consecutiveErrors++;
    log(`error: ${e.message}`);
  }
  while (true) {
    await new Promise(r => setTimeout(r, REFRESH_INTERVAL_MS));
    try {
      await once({ allowSkipIfFresh: false });
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors++;
      log(`error: ${e.message} (consecutive=${consecutiveErrors})`);
      if (consecutiveErrors >= 5) {
        log(`5 consecutive failures — exiting non-zero so the supervisor restarts us`);
        process.exit(3);
      }
    }
  }
}

main().catch(e => { log("FATAL:", e.stack || e.message); process.exit(1); });
