#!/usr/bin/env node
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };
const BASE = 'https://madisonproperty.countygovservices.com/Property/Property/Details';
const CONCURRENCY = 1;
const DELAY = 3000;
const BATCH_SZ = 100;

const ag = new https.Agent({ keepAlive: true, maxSockets: 2 });
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchHTML(url, retries=3) {
  return new Promise((resolve, reject) => {
    const go = (u, rLeft) => {
      https.get(u, { timeout:15000, agent:ag, headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'} }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (rLeft <= 0) return reject(new Error('Too many redirects'));
          let r = res.headers.location;
          if (r.startsWith('/')) { const p = new URL(u); r = p.protocol+'//'+p.host+r; }
          res.resume(); return go(r, rLeft-1);
        }
        if (res.statusCode === 429) {
          res.resume();
          if (retries > 0) {
            const wait = 30000 + Math.random()*30000;
            console.log(`  [429] backing off ${(wait/1000).toFixed(0)}s...`);
            setTimeout(() => fetchHTML(url, retries-1).then(resolve).catch(reject), wait);
          } else reject(new Error('429'));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
        let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); res.on('error',reject);
      }).on('error', e => {
        if (retries>0) setTimeout(()=>fetchHTML(url,retries-1).then(resolve).catch(reject),5000);
        else reject(e);
      });
    };
    go(url, 5);
  });
}

function parse(html) {
  const r = { yearBuilt:null, sqft:null, stories:null, bathrooms:null,
              roofType:null, roofMaterial:null, foundation:null, exteriorWalls:null };
  const re = /<td[^>]*class="pt-parcel-summary-label"[^>]*>(.*?)<\/td>\s*<td[^>]*class="pt-parcel-summary-value"[^>]*>(.*?)<\/td>/gs;
  let m;
  while ((m = re.exec(html)) !== null) {
    const l = m[1].trim(), v = m[2].trim();
    if (!v) continue;
    if (l==='Year Built') { const y=parseInt(v); if(y>=1700&&y<=2030) r.yearBuilt=y; }
    else if (l==='Total Living Area') { const s=parseInt(v); if(s>0&&s<100000) r.sqft=s; }
    else if (l==='Stories') { const s=parseFloat(v); if(s>0&&s<=10) r.stories=s; }
    else if (l==='Roof Type') r.roofType=v.split(' - ')[0].trim().substring(0,100);
    else if (l==='Roof Material') r.roofMaterial=v.split(' - ')[0].trim().substring(0,100);
    else if (l==='Foundation') r.foundation=v.split(' - ')[0].trim().substring(0,100);
    else if (l==='Exterior Walls') r.exteriorWalls=v.split(' - ')[0].trim().substring(0,100);
    if (v.startsWith('BATH')) { const bm=v.match(/BATH\s+\w+\s*-\s*(\d+)/); if(bm) r.bathrooms=(r.bathrooms||0)+parseInt(bm[1]); }
  }
  return r;
}

async function flush(pool, updates) {
  const ids=[], yrs=[], sqs=[], sts=[], bas=[], rts=[], rms=[], fns=[], ews=[];
  for (const u of updates) {
    ids.push(u.id); yrs.push(u.yearBuilt); sqs.push(u.sqft);
    sts.push(u.stories?Math.round(u.stories):null); bas.push(u.bathrooms);
    rts.push(u.roofType); rms.push(u.roofMaterial);
    fns.push(u.foundation); ews.push(u.exteriorWalls);
  }
  await pool.query(`UPDATE properties AS p SET
    "yearBuilt"=COALESCE(u.y,p."yearBuilt"), sqft=COALESCE(u.s,p.sqft),
    stories=COALESCE(u.st,p.stories), bathrooms=COALESCE(u.b,p.bathrooms),
    "roofType"=COALESCE(u.rt,p."roofType"), "roofMaterial"=COALESCE(u.rm,p."roofMaterial"),
    foundation=COALESCE(u.fn,p.foundation), "exteriorWalls"=COALESCE(u.ew,p."exteriorWalls"),
    "updatedAt"=NOW()
    FROM (SELECT unnest($1::text[]) id, unnest($2::int[]) y, unnest($3::int[]) s,
      unnest($4::int[]) st, unnest($5::int[]) b, unnest($6::text[]) rt,
      unnest($7::text[]) rm, unnest($8::text[]) fn, unnest($9::text[]) ew
    ) u WHERE p.id=u.id`, [ids,yrs,sqs,sts,bas,rts,rms,fns,ews]);
}

async function main() {
  const t0=Date.now();
  console.log('=== Building Enrichment v2 (safe: 1 req every 2s) ===');
  console.log(`Started: ${new Date().toISOString()}\n`);
  const pool = new Pool(DB);
  const {rows:props} = await pool.query(
    `SELECT id, "parcelId" FROM properties WHERE "parcelId" IS NOT NULL AND "yearBuilt" IS NULL AND county='Madison' ORDER BY id`
  );
  console.log(`Found ${props.length} properties to scrape\n`);
  if (!props.length) { await pool.end(); return; }

  let proc=0, ok=0, noD=0, err=0;
  const upd=[];

  for (const p of props) {
    try {
      const html = await fetchHTML(`${BASE}?taxyear=2024&ppin=${p.parcelId}`);
      const data = parse(html);
      proc++;
      if (data && (data.yearBuilt||data.sqft||data.roofType)) { ok++; upd.push({id:p.id,...data}); }
      else noD++;
    } catch(e) {
      proc++; err++;
    }

    if (upd.length >= BATCH_SZ) { await flush(pool, upd.splice(0)); }

    if (proc%100===0) {
      const rate=(proc/((Date.now()-t0)/1000)).toFixed(2);
      const eta=((props.length-proc)/parseFloat(rate)/3600).toFixed(1);
      console.log(`  ${proc}/${props.length} | ok:${ok} noData:${noD} err:${err} | ${rate}/s ETA:${eta}h`);
    }
    await sleep(DELAY);
  }

  if (upd.length) await flush(pool, upd);

  const {rows:[s]} = await pool.query(`SELECT count(*) t, count("yearBuilt") yr,
    count("roofType") rt, count("roofMaterial") rm FROM properties WHERE county='Madison'`);

  console.log(`\n=== Done in ${((Date.now()-t0)/1000/3600).toFixed(1)}h ===`);
  console.log(`Processed:${proc} Enriched:${ok} Errors:${err}`);
  console.log(`YearBuilt: ${s.yr}/${s.t} | RoofType: ${s.rt}/${s.t} | RoofMaterial: ${s.rm}/${s.t}`);
  await pool.end();
}

main().catch(e=>{console.error('FATAL:',e);process.exit(1);});
