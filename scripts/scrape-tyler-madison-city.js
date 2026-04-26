#!/usr/bin/env node
/**
 * scrape-tyler-madison-city-v2.js
 * Full ASP.NET WebForms flow:
 *   1. GET landing page   → capture cookies + __VIEWSTATE + __EVENTVALIDATION
 *   2. POST search form   → yields page 1 results
 *   3. POST __doPostBack with __EVENTTARGET=pagingRepeater$Articles{N-1} for page N
 *
 * Usage: node scrape-tyler-madison-city-v2.js [startYear] [endYear]
 */
const { Pool } = require("pg");
const https = require("https");

const BASE = "https://buildportal.madisonal.gov/eSuite.Permits/";
const HOST = "buildportal.madisonal.gov";
const PATH_ROOT = "/eSuite.Permits/";
const JURIS = "madison-city";
const TYPES = { 32: "RESIDENTIAL ROOFING", 31: "COMMERCIAL ROOFING" };

const startYear = parseInt(process.argv[2] || "2012", 10);
const endYear   = parseInt(process.argv[3] || "2026", 10);
const DELAY_MS  = 3500;
const PAGE_MAX  = 30;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pool  = new Pool({ connectionString: "postgresql://eavesight:eavesight@localhost:5433/eavesight" });

function htmlDecode(s) {
  if (!s) return s;
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
          .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function strip(s) {
  return htmlDecode((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const ABBREV = {
  STREET: "ST", ROAD: "RD", DRIVE: "DR", AVENUE: "AVE", LANE: "LN",
  COURT: "CT", CIRCLE: "CIR", BOULEVARD: "BLVD", PLACE: "PL",
  PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", TRAIL: "TRL",
  CROSSING: "XING", SQUARE: "SQ", ALLEY: "ALY",
};
function normAddr(addr) {
  if (!addr) return "";
  let s = addr.toUpperCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(" ").map(t => ABBREV[t] || t);
  return tokens.join(" ");
}

/** Simple HTTP client with cookie jar. */
class Session {
  constructor() { this.cookies = {}; }
  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  saveCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    for (const raw of [].concat(setCookieHeaders)) {
      const m = raw.match(/^([^=]+)=([^;]*)/);
      if (m) this.cookies[m[1].trim()] = m[2].trim();
    }
  }
  _req(method, urlPath, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": this.cookieHeader(),
        ...extraHeaders,
      };
      if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Content-Length"] = Buffer.byteLength(body);
      }
      const req = https.request({
        host: HOST, path: urlPath, method, headers, timeout: 25000,
      }, res => {
        this.saveCookies(res.headers["set-cookie"]);
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode,
          location: res.headers.location,
          html: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      if (body) req.write(body);
      req.end();
    });
  }
  async get(pathOrUrl, extra = {}) {
    const urlPath = pathOrUrl.startsWith("/") ? pathOrUrl : PATH_ROOT + pathOrUrl;
    let res = await this._req("GET", urlPath, null, extra);
    // follow ONE redirect (ASP.NET search redirects to results page)
    if (res.status >= 300 && res.status < 400 && res.location) {
      const nextPath = res.location.startsWith("/") ? res.location : PATH_ROOT + res.location.replace(/^\.\//, "");
      res = await this._req("GET", nextPath, null, extra);
    }
    return res;
  }
  async post(urlPath, body, extra = {}) {
    if (!urlPath.startsWith("/")) urlPath = PATH_ROOT + urlPath;
    let res = await this._req("POST", urlPath, body, extra);
    // ASP.NET often 302s to the results URL; follow once
    if (res.status >= 300 && res.status < 400 && res.location) {
      const nextPath = res.location.startsWith("/") ? res.location : PATH_ROOT + res.location.replace(/^\.\//, "");
      res = await this._req("GET", nextPath, null, extra);
    }
    return res;
  }
}

function extractState(html) {
  const grab = (key) => {
    const re = new RegExp(`id="${key}"[^>]*value="([^"]*)"`);
    const m = html.match(re);
    return m ? m[1] : "";
  };
  // ddlNoOFRows selected option — default to "10" if missing
  let noRows = "10";
  const ddlRowsMatch = html.match(/<select[^>]*name="[^"]*ddlNoOFRows"[\s\S]*?<\/select>/);
  if (ddlRowsMatch) {
    const sel = ddlRowsMatch[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/);
    if (sel) noRows = sel[1];
  }
  const wmMatch = html.match(/name="([^"]*txtServiceAddress_TextBoxWatermarkExtender_ClientState)"[^>]*value="([^"]*)"/);
  return {
    __VIEWSTATE:           grab("__VIEWSTATE"),
    __VIEWSTATEGENERATOR:  grab("__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION:     grab("__EVENTVALIDATION"),
    __PREVIOUSPAGE:        grab("__PREVIOUSPAGE"),
    ddlNoOFRows:           noRows,
    wmName:                wmMatch ? wmMatch[1] : null,
    wmValue:               wmMatch ? wmMatch[2] : "",
  };
}

function findControl(html, nameFragment) {
  const re = new RegExp(`name="([^"]*${nameFragment}[^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function parsePage(html) {
  const total = (html.match(/lblPermitsFoundValue[^>]*>(\d+)/) || [])[1];
  const rowBlocks = [...html.matchAll(/<tr[^>]*class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const rows = [];
  for (const m of rowBlocks) {
    const r = m[1];
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
    if (tds.length < 4) continue;
    const idM = r.match(/ContractorPermitDetails\.aspx\?id=(\d+)/);
    const pnM = r.match(/ContractorPermitDetails\.aspx\?id=\d+"[^>]*>\s*([^\s<][^<]*?)\s*<\/a>/);
    const permitNumber = pnM ? pnM[1].trim() : null;
    const status  = strip(tds[2]);
    const address = strip(tds[3]);
    if (!permitNumber || !address) continue;
    rows.push({ permitNumber, detailId: idM ? parseInt(idM[1], 10) : null, status, rawAddress: address });
  }
  return { total: total ? parseInt(total, 10) : null, rows };
}

/** Build a URL-encoded WebForms POST body. */
function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) p.set(k, v == null ? "" : v);
  return p.toString();
}

async function scrapeYearType(session, year, typeId) {
  const typeName = TYPES[typeId];
  const yearPrefix = `${year}-`;

  // === 1. GET welcome (landing page with search form) ===
  const landing = await session.get("");
  if (landing.status !== 200 || !/ddlPermitType/.test(landing.html)) {
    console.log(`  [${year} ${typeName}] landing failed status=${landing.status}`);
    return [];
  }
  let state = extractState(landing.html);
  const ddl = findControl(landing.html, "ddlPermitType");
  const txtNum = findControl(landing.html, "txtPermitNumber");
  const txtAddr = findControl(landing.html, "txtServiceAddress");
  const btn = findControl(landing.html, "btnSearch");
  if (!ddl || !btn) {
    console.log(`  [${year} ${typeName}] could not find form controls`);
    return [];
  }

  // === 2. POST search to welcome-page URL (form action="./" → back to /eSuite.Permits/) ===
  const postBody = formBody({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: state.__VIEWSTATE,
    __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: state.__EVENTVALIDATION,
    [ddl]: String(typeId),
    [txtNum]: yearPrefix,
    [txtAddr]: "",
    [btn]: "Search",
  });
  let res = await session.post("", postBody, { Referer: BASE });
  if (res.status !== 200) {
    console.log(`  [${year} ${typeName}] search POST status=${res.status}`);
    return [];
  }
  let parsed = parsePage(res.html);
  console.log(`  [${year} ${typeName}] total=${parsed.total ?? "?"}, page 1: ${parsed.rows.length} rows`);
  const out = [...parsed.rows];

  // === 3. Paginate via WebForms postback ===
  // Each page's postback targets AdvancedSearch.aspx?page=N (per WebForm_PostBackOptions actionUrl).
  // Must include __PREVIOUSPAGE, ddlNoOFRows, and the watermark client-state field.
  const referer = `https://${HOST}/eSuite.Permits/AdvancedSearchPage/AdvancedSearch.aspx?permitNumber=${encodeURIComponent(yearPrefix)}&permitType=${typeId}&serviceAddress=`;
  let page = 1;
  while (parsed.rows.length === 10 && page < PAGE_MAX) {
    page++;
    state = extractState(res.html);
    let tgtMatch = res.html.match(new RegExp(
      `&quot;([^&]+?)&quot;[^)]*?&quot;AdvancedSearch\\.aspx\\?page=${page}&quot;`
    ));
    if (!tgtMatch) {
      tgtMatch = res.html.match(new RegExp(
        `"([^"]+?)"[^)]*?"AdvancedSearch\\.aspx\\?page=${page}"`
      ));
    }
    if (!tgtMatch) {
      console.log(`  [${year} ${typeName}] page ${page}: no postback target found — done`);
      break;
    }
    const target = tgtMatch[1];
    const paginateUrl = `/eSuite.Permits/AdvancedSearchPage/AdvancedSearch.aspx?page=${page}`;
    const body2obj = {
      __EVENTTARGET: target,
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: state.__VIEWSTATE,
      __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
      __EVENTVALIDATION: state.__EVENTVALIDATION,
      __PREVIOUSPAGE: state.__PREVIOUSPAGE,
      [ddl]: String(typeId),
      [txtNum]: yearPrefix,
      [txtAddr]: "",
      "ctl00$ctl00$Content$DefaultContent$ddlNoOFRows": state.ddlNoOFRows,
    };
    if (state.wmName) body2obj[state.wmName] = state.wmValue;
    const body2 = formBody(body2obj);
    await sleep(DELAY_MS);
    res = await session.post(paginateUrl, body2, { Referer: referer, Origin: "https://" + HOST });
    if (res.status !== 200) {
      console.log(`  [${year} ${typeName}] page ${page} POST status=${res.status} — stopping`);
      break;
    }
    parsed = parsePage(res.html);
    console.log(`  [${year} ${typeName}] page ${page}: ${parsed.rows.length} rows`);
    out.push(...parsed.rows);
  }

  return out;
}

async function matchAndUpsert(row, typeId, typeName, year) {
  const normalized = normAddr(row.rawAddress);
  const { rows: matches } = await pool.query(
    `SELECT id, address FROM properties
      WHERE county = 'Madison' AND address IS NOT NULL
        AND UPPER(REPLACE(REPLACE(address,',',' '),'.',' ')) = $1
      ORDER BY sqft DESC NULLS LAST LIMIT 1`, [normalized]);
  let propertyId = null, matchConfidence = null;
  if (matches.length) { propertyId = matches[0].id; matchConfidence = "exact-norm"; }
  else {
    const parts = normalized.split(" ");
    if (parts.length >= 3) {
      const houseNum = parts[0], streetWord = parts[1];
      const { rows: fuzzy } = await pool.query(
        `SELECT id FROM properties WHERE county='Madison' AND address IS NOT NULL
           AND UPPER(address) LIKE $1
           ORDER BY sqft DESC NULLS LAST LIMIT 1`,
        [`${houseNum} ${streetWord}%`]);
      if (fuzzy.length) { propertyId = fuzzy[0].id; matchConfidence = "fuzzy-housenum-street"; }
    }
  }
  await pool.query(
    `INSERT INTO property_permits
       (jurisdiction, "permitType", "permitTypeId", "permitNumber", status,
        "rawAddress", "detailId", "estimatedYear", "yearConfidence",
        "propertyId", "matchConfidence")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (jurisdiction, "permitNumber") DO UPDATE SET
       status = EXCLUDED.status, "rawAddress" = EXCLUDED."rawAddress",
       "propertyId" = EXCLUDED."propertyId",
       "matchConfidence" = EXCLUDED."matchConfidence", "scrapedAt" = NOW()`,
    [JURIS, typeName, typeId, row.permitNumber, row.status,
     row.rawAddress, row.detailId, year, "exact", propertyId, matchConfidence]);
  return { propertyId, matchConfidence };
}

(async () => {
  console.log(`\n=== Tyler Madison-City roofing scrape v2 ===`);
  console.log(`Years: ${startYear}-${endYear}  Types: ${Object.values(TYPES).join(", ")}`);
  const t0 = Date.now();
  let totalRows = 0, totalMatched = 0, totalFuzzy = 0, totalUnmatched = 0;
  const perYear = {};
  const sample = [];

  for (let year = startYear; year <= endYear; year++) {
    perYear[year] = { total: 0, res: 0, com: 0, completed: 0, issued: 0, matched: 0, fuzzy: 0, unmatched: 0 };
    for (const typeId of [32, 31]) {
      const typeName = TYPES[typeId];
      const session = new Session();   // fresh session per (year, type) to avoid state drift
      const rows = await scrapeYearType(session, year, typeId);
      for (const row of rows) {
        const { matchConfidence } = await matchAndUpsert(row, typeId, typeName, year);
        totalRows++;
        perYear[year].total++;
        if (typeId === 32) perYear[year].res++;
        if (typeId === 31) perYear[year].com++;
        if (/Completed/i.test(row.status)) perYear[year].completed++;
        if (/Issued/i.test(row.status))    perYear[year].issued++;
        if      (matchConfidence === "exact-norm")              { totalMatched++; perYear[year].matched++; }
        else if (matchConfidence === "fuzzy-housenum-street")   { totalFuzzy++; perYear[year].fuzzy++; }
        else                                                     { totalUnmatched++; perYear[year].unmatched++; }
        if (sample.length < 12) sample.push({ ...row, year, typeName, matchConfidence });
      }
      await sleep(DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== Complete in ${elapsed}s ===`);
  console.log(`Total permits scraped: ${totalRows}`);
  console.log(`  matched exact:       ${totalMatched} (${totalRows ? ((totalMatched/totalRows)*100).toFixed(0) : 0}%)`);
  console.log(`  matched fuzzy:       ${totalFuzzy}`);
  console.log(`  UNMATCHED:           ${totalUnmatched}`);
  console.log(`\nPer-year summary:`);
  console.log(`year  tot  res  com  comp  iss  match  fuzzy  unm`);
  for (const y of Object.keys(perYear).sort()) {
    const p = perYear[y];
    if (p.total === 0) continue;
    console.log(`${y}  ${String(p.total).padStart(3)}  ${String(p.res).padStart(3)}  ${String(p.com).padStart(3)}  ${String(p.completed).padStart(4)}  ${String(p.issued).padStart(3)}  ${String(p.matched).padStart(5)}  ${String(p.fuzzy).padStart(5)}  ${String(p.unmatched).padStart(3)}`);
  }
  console.log(`\nFirst 12 sample rows:`);
  for (const s of sample) {
    const mark = s.matchConfidence === "exact-norm" ? "O" : s.matchConfidence === "fuzzy-housenum-street" ? "~" : "X";
    console.log(`  [${mark}] ${s.permitNumber} [${s.typeName}] ${s.status.padEnd(18)} ${s.rawAddress}`);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
