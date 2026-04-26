#!/usr/bin/env node
// enrich-jackson.js — Jackson County (AL) property scrape — BLOCKED (no public detail portal)
//
// Investigation summary (see also: report from initial scout, 2026-04-25):
//
// 1) Jackson uses Tyler/AssuranceWeb at jacksonproperty.countygovservices.com
//    BUT the portal is configured payment-only. The Madison/Marshall route
//        /Property/Property/Details?taxyear=...&ppin=...
//    returns 404 on Jackson regardless of taxyear. The supported flow is:
//        Search -> POST /Property/Verify (search by name/parcel/address)
//          -> POST /Property/ContactInformation (name/phone/email REQUIRED)
//             -> /Property/Verify (renders an empty Kendo cart grid)
//                -> Pay-flow only.
//    No detail page (year built, sqft, roof, owner history) is ever rendered.
//
// 2) The county GIS portal at https://isv.kcsgis.com/al.jackson_revenue/ has
//    a parcel viewer but its frontend includes Google reCAPTCHA
//        <script src="https://www.google.com/recaptcha/api.js"></script>
//    and the underlying ArcGIS REST endpoints are not directly exposed in the
//    landing HTML — config is loaded post-captcha. Bypassing reCAPTCHA is out
//    of scope per the task brief ("halt on first 403/429, don't bypass").
//
// 3) The official county site (jacksoncountyal.gov) only links to (1) and (2).
//    The propertychecker.com/taxassessors.net entries are scraper aggregators,
//    not source-of-truth and likely scrape the same blocked sources.
//
// Verdict: NO PUBLIC PROPERTY-DETAIL SCRAPE PATH EXISTS for Jackson County
// without either (a) running headless Chrome to solve the GIS reCAPTCHA
// (Playwright + 2captcha or human-in-the-loop), or (b) buying an Alabama
// statewide assessor data feed (e.g. Patriot Properties, DataTree,
// CoreLogic), or (c) a public-records request to the Jackson Co Revenue
// Commissioner (256-574-9260) for a parcel CSV export.
//
// This script is therefore a stub. Running it just logs the blocker and
// exits cleanly so the supervisor doesn't spin on it. --dry-run is the
// default and --live is intentionally a no-op.

const fs = require("fs");
const path = require("path");

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);
const LIVE = ARGS.live === "true";
const LOG_PATH = "/home/dentwon/Eavesight/logs/enrich-jackson.log";

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
function log(...a) {
  const line = `[${new Date().toISOString()}] [jackson] ${a.join(" ")}`;
  console.log(line);
  logStream.write(line + "\n");
}

log("=== Jackson County scrape: BLOCKED ===");
log("Tyler portal at jacksonproperty.countygovservices.com is payment-only —");
log("  /Property/Property/Details?ppin=... returns 404; no detail page is rendered.");
log("ISV GIS at isv.kcsgis.com/al.jackson_revenue/ is gated by Google reCAPTCHA.");
log("No direct-HTTP scrape path exists. Recommended next steps:");
log("  1) Playwright + 2captcha against the ISV GIS viewer (parses ArcGIS layer JSON), OR");
log("  2) Purchase Patriot Properties / DataTree / CoreLogic Alabama feed, OR");
log("  3) Public-records request to Revenue Commissioner: 256-574-9260");
log("Sample size in DB: ~1,464 properties (943 with parcelId) — small relative to");
log("Madison/Limestone/Morgan; deferring is reasonable.");

if (LIVE) log("(--live ignored — no scrape path)");
log("done (no-op)");
logStream.end();
process.exit(0);
