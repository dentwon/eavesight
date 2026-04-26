#!/usr/bin/env node
/**
 * harvest-hblb-licensees.js
 *
 * Scrapes the Alabama Home Builders Licensure Board public licensee directory.
 * Endpoint: https://alhobv7prod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx
 *
 * The site is ASP.NET WebForms. Search is via POST with __VIEWSTATE.
 * Strategy: GET the form to harvest hidden fields, then POST a county-scoped
 * search and parse the results table.
 *
 * Test mode (--test): single sample search for Madison County (option 5793).
 * No DB writes in test mode.
 *
 * County option values discovered:
 *   Madison=5793, Limestone=5790, Morgan=5800, Marshall=5796, Jackson=5784
 */
const https = require('https');
const { URLSearchParams } = require('url');

const HOST = 'alhobv7prod.glsuite.us';
const PATH = '/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx';

const COUNTIES = { Madison:'5793', Limestone:'5790', Morgan:'5800', Marshall:'5796', Jackson:'5784' };

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const opts = { host: HOST, path, method, headers, timeout: 30000 };
    const req = https.request(opts, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function extractHidden(html, name) {
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

function decodeEntities(s) {
  return s.replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

function parseResultsTable(html) {
  // Result rows: GLSuite renders as <tr> in a GridView. Crude but works for test.
  const rows = [];
  // Match GridView rows: <tr ...><td>...</td></tr> repeated. Restrict to the results grid.
  const gridMatch = html.match(/<table[^>]*id="[^"]*gvResults[^"]*"[\s\S]*?<\/table>/i)
                 || html.match(/<table[^>]*id="[^"]*Grid[^"]*"[\s\S]*?<\/table>/i);
  const gridHtml = gridMatch ? gridMatch[0] : html;
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(gridHtml)) !== null) {
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(m[1])) !== null) {
      const txt = decodeEntities(cm[1].replace(/<[^>]+>/g,'').trim());
      cells.push(txt);
    }
    if (cells.length >= 3) rows.push(cells);
  }
  return rows;
}

async function searchCounty(countyName, countyValue) {
  console.log(`\n--- HBLB search: ${countyName} County (option ${countyValue}) ---`);

  // Step 1: GET form
  const get = await request('GET', PATH, { 'User-Agent':'Mozilla/5.0', 'Accept':'text/html' });
  if (get.statusCode !== 200) throw new Error('GET status ' + get.statusCode);
  const cookies = (get.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  const viewstate    = extractHidden(get.body, '__VIEWSTATE');
  const viewstateGen = extractHidden(get.body, '__VIEWSTATEGENERATOR');
  const eventVal     = extractHidden(get.body, '__EVENTVALIDATION');
  console.log(`  form loaded (VIEWSTATE ${viewstate.length} chars)`);

  // Step 2: POST search. Submit button name is typically btnSearch.
  // We don't know the exact submit button id; try the common 'btnSearch'.
  const params = new URLSearchParams();
  // Submit via __doPostBack (button is wrapped with __doPostBack JS)
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$btnSubmit');
  params.append('__EVENTARGUMENT', '');
  params.append('__VIEWSTATE', viewstate);
  params.append('__VIEWSTATEGENERATOR', viewstateGen);
  params.append('__EVENTVALIDATION', eventVal);
  params.append('ctl00$ContentPlaceHolder1$txtLicenseNumber', '');
  params.append('ctl00$ContentPlaceHolder1$txtName', '');
  params.append('ctl00$ContentPlaceHolder1$txtCity', '');
  params.append('ctl00$ContentPlaceHolder1$ddlCounty', countyValue);
  const body = params.toString();

  const post = await request('POST', PATH, {
    'User-Agent':'Mozilla/5.0',
    'Content-Type':'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    'Cookie': cookies,
    'Referer': `https://${HOST}${PATH}`,
  }, body);

  console.log(`  POST status ${post.statusCode}, ${post.body.length} bytes`);
  const rows = parseResultsTable(post.body);
  console.log(`  parsed rows: ${rows.length}`);
  if (rows.length > 0) {
    console.log('  SAMPLE first 3 rows:');
    rows.slice(0, 3).forEach((r, i) => console.log(`    [${i}] ${r.slice(0,5).join(' | ')}`));
  } else {
    // Save HTML for debugging.
    require('fs').writeFileSync(`/tmp/hblb-${countyName}.html`, post.body);
    console.log(`  no rows parsed; raw HTML saved to /tmp/hblb-${countyName}.html for inspection`);
  }
  return rows;
}

async function main() {
  const isTest = process.argv.includes('--test');
  const targets = isTest ? { Madison: COUNTIES.Madison } : COUNTIES;
  for (const [name, val] of Object.entries(targets)) {
    try { await searchCounty(name, val); }
    catch (e) { console.error(`  ERROR ${name}: ${e.message}`); }
  }
  if (isTest) console.log('\nTEST DONE. Inspect /tmp/hblb-*.html if rows=0 to refine GridView selector.');
}

main().catch(e => { console.error(e); process.exit(1); });
