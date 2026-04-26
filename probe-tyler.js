#!/usr/bin/env node
// Probe: submit an ASP.NET WebForms POST to Madison County Tyler eSuite for
// ROOFING RESIDENTIAL (permit type id=33). Parse result table.
// Goal: confirm the search endpoint works and estimate total roof permits.

const BASE_MC = "https://esuite-madisonco-al.tylertech.com/nwprod/eSuite.Permits/";
const BASE_MV = "https://buildportal.madisonal.gov/eSuite.Permits/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function loadLanding(base) {
  const res = await fetch(base, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${base} -> ${res.status}`);
  const html = await res.text();
  const vs = html.match(/id="__VIEWSTATE"[^>]*value="([^"]+)"/)[1];
  const vg = html.match(/id="__VIEWSTATEGENERATOR"[^>]*value="([^"]+)"/)[1];
  const ev = html.match(/id="__EVENTVALIDATION"[^>]*value="([^"]+)"/)[1];
  const cookies = res.headers.get("set-cookie") || "";
  // Find button name
  const btnMatch = html.match(/name="([^"]*btnSearch[^"]*)"/);
  const selMatch = html.match(/name="([^"]*ddlPermitType[^"]*)"/);
  const addrMatch = html.match(/name="([^"]*txtServiceAddress[^"]*)"/);
  return {
    __VIEWSTATE: vs,
    __VIEWSTATEGENERATOR: vg,
    __EVENTVALIDATION: ev,
    cookie: cookies.split(";")[0],
    btnName: btnMatch ? btnMatch[1] : "btnSearch",
    selName: selMatch ? selMatch[1] : "ddlPermitType",
    addrName: addrMatch ? addrMatch[1] : "txtServiceAddress",
  };
}

async function submitSearch(base, state, permitTypeId) {
  const form = new URLSearchParams();
  form.set("__EVENTTARGET", "");
  form.set("__EVENTARGUMENT", "");
  form.set("__VIEWSTATE", state.__VIEWSTATE);
  form.set("__VIEWSTATEGENERATOR", state.__VIEWSTATEGENERATOR);
  form.set("__EVENTVALIDATION", state.__EVENTVALIDATION);
  form.set(state.selName, permitTypeId);
  form.set(state.addrName, "");
  form.set(state.btnName, "Search");
  const res = await fetch(base, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": state.cookie,
      "Referer": base,
    },
    body: form.toString(),
    redirect: "follow",
  });
  console.log(`  POST -> ${res.status} ${res.url}`);
  const html = await res.text();
  return { html, url: res.url };
}

function parseResults(html) {
  // Find the result count ("Results: N found" or similar)
  const cntM = html.match(/(\d+)\s+(?:result|permit|record)s?\s+found/i) ||
               html.match(/Total[:\s]+(\d+)/i) ||
               html.match(/of\s+(\d+)\s+record/i);
  const rows = [...html.matchAll(/<tr[^>]*class="?(?:gridview|results)[^>]*"?[\s\S]*?<\/tr>/gi)];
  // Try to find table rows with permit numbers
  const permitNums = [...html.matchAll(/Permit[^:]*:\s*([A-Z0-9-]+)/gi)].slice(0, 5);
  const dateSamples = [...html.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)].slice(0, 5);
  return {
    count: cntM ? cntM[1] : null,
    rowMatches: rows.length,
    permitSamples: permitNums.map(x => x[1]),
    dateSamples: dateSamples.map(x => x[1]),
    sizeKB: (html.length / 1024).toFixed(0),
  };
}

async function probe(label, base, permitTypeId) {
  console.log(`\n=== ${label}: Permit Type ${permitTypeId} ===`);
  console.log(`GET  ${base}`);
  const state = await loadLanding(base);
  console.log(`  VS length=${state.__VIEWSTATE.length} EV length=${state.__EVENTVALIDATION.length}`);
  console.log(`  btnName=${state.btnName}  selName=${state.selName}`);
  const { html, url } = await submitSearch(base, state, permitTypeId);
  // Check if we got a results page
  if (/ResultsList|searchResult|GridView/i.test(html)) {
    console.log("  Results page detected");
  } else if (/error|timeout|unavailable/i.test(html)) {
    console.log("  ERROR-ish response");
  }
  const r = parseResults(html);
  console.log("  parse:", r);
  // Dump snippet
  const tableSnip = html.match(/<table[\s\S]{0,3000}?<\/table>/i);
  if (tableSnip) {
    require("fs").writeFileSync(`/tmp/tyler/${label}-result.html`, html);
    console.log(`  saved to /tmp/tyler/${label}-result.html`);
  }
}

(async () => {
  try {
    await probe("mc-roofing-res",   BASE_MC, "33"); // Madison County ROOFING RESIDENTIAL
    await probe("mc-roofing-com",   BASE_MC, "34"); // Madison County ROOFING COMMERCIAL
    await probe("mv-roofing-res",   BASE_MV, "32"); // Madison (City) RESIDENTIAL ROOFING
    await probe("mv-roofing-com",   BASE_MV, "31"); // Madison (City) COMMERCIAL ROOFING
  } catch (e) { console.error(e); }
})();
