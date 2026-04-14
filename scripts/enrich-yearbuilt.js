#!/usr/bin/env node
/**
 * enrich-yearbuilt.js
 *
 * Phase 2: Scrape Madison County countygovservices.com for building details
 * (yearBuilt, sqft, stories, bathrooms) using the PIN stored in parcelId.
 *
 * Rate-limited to avoid 429 errors. Runs as a long-running daemon process.
 * Handles backoff on rate limit responses.
 * Only processes Madison County properties.
 *
 * Run with: nohup node scripts/enrich-yearbuilt.js > yearbuilt.log 2>&1 &
 * Monitor: tail -f yearbuilt.log
 */

const { Pool } = require('pg');
const https = require('https');

// ---------- Config ----------
const DB_CONFIG = {
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
};

const BASE_URL = 'https://madisonproperty.countygovservices.com/Property/Property/Details';
const TAX_YEAR = 2024;
const CONCURRENCY = 2;        // very conservative parallel requests
const BASE_DELAY_MS = 3000;   // 3 seconds between batches (safe rate ~0.67 req/s)
const BATCH_UPDATE_SIZE = 100;
const MAX_BACKOFF_MS = 3600000; // 1 hour max backoff (rate limit can be 30+ min)
const PROGRESS_FILE = '/home/dentwon/Eavesight/scripts/.yearbuilt-progress.json';
const fs = require('fs');

// ---------- Helpers ----------

function fetchHTML(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const doFetch = (currentUrl, redirectsLeft) => {
      const req = https.get(currentUrl, { timeout: 20000 }, (res) => {
        // Handle rate limiting
        if (res.statusCode === 429) {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            // Parse retry-after from JSON response
            let waitSec = 60;
            try {
              const json = JSON.parse(body);
              const match = json.details && json.details.match(/(\d+)\s*second/);
              if (match) waitSec = parseInt(match[1]);
            } catch (e) {}
            reject(new Error(`RATE_LIMITED:${waitSec}`));
          });
          return;
        }

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsed = new URL(currentUrl);
            redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
          }
          res.resume();
          doFetch(redirectUrl, redirectsLeft - 1);
          return;
        }

        if (res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    };
    doFetch(url, maxRedirects);
  });
}

function parsePropertyPage(html) {
  const result = {
    yearBuilt: null,
    sqft: null,
    stories: null,
    bathrooms: null,
    bedrooms: null,
  };

  // Check if this is an error/empty page
  if (!html || html.length < 500 || html.includes('Site usage exceeded')) {
    return null;
  }

  const labelValueRegex = /<td[^>]*class="pt-parcel-summary-label"[^>]*>(.*?)<\/td>\s*<td[^>]*class="pt-parcel-summary-value"[^>]*>(.*?)<\/td>/gs;
  let match;

  while ((match = labelValueRegex.exec(html)) !== null) {
    const label = match[1].trim();
    const value = match[2].trim();

    if (label === 'Year Built' && value && !isNaN(parseInt(value))) {
      const yr = parseInt(value);
      if (yr >= 1700 && yr <= 2026) result.yearBuilt = yr;
    }

    if (label === 'Total Living Area' && value && !isNaN(parseInt(value)) && !result.sqft) {
      const sqft = parseInt(value);
      if (sqft > 0 && sqft < 100000) result.sqft = sqft;
    }

    if (label === 'Stories' && value) {
      const stories = parseFloat(value);
      if (stories > 0 && stories <= 10) result.stories = stories;
    }

    // Bath count from "BATH 3FIX - 1" or "BATH FULL - 2"
    if (value && value.startsWith('BATH')) {
      const bathMatch = value.match(/BATH\s+\w+\s*-\s*(\d+)/);
      if (bathMatch) result.bathrooms = (result.bathrooms || 0) + parseInt(bathMatch[1]);
    }

    // Bedroom count
    if (value && value.toUpperCase().includes('BEDROOM')) {
      const bedMatch = value.match(/BEDROOM\w*\s*-\s*(\d+)/i);
      if (bedMatch) result.bedrooms = parseInt(bedMatch[1]);
    }
  }

  return result;
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch (e) {
    return { lastProcessedIndex: 0 };
  }
}

function saveProgress(index) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastProcessedIndex: index }));
}

async function flushUpdates(pool, updates) {
  if (updates.length === 0) return;
  const ids = updates.map((u) => u.id);
  const yearBuilts = updates.map((u) => u.yearBuilt);
  const sqfts = updates.map((u) => u.sqft);
  const storiesList = updates.map((u) => u.stories ? Math.round(u.stories) : null);
  const bathrooms = updates.map((u) => u.bathrooms);
  const bedrooms = updates.map((u) => u.bedrooms);

  try {
    await pool.query(
      `UPDATE properties AS p SET
         "yearBuilt" = COALESCE(u.new_year, p."yearBuilt"),
         sqft = COALESCE(u.new_sqft, p.sqft),
         stories = COALESCE(u.new_stories, p.stories),
         bathrooms = COALESCE(u.new_bath, p.bathrooms),
         bedrooms = COALESCE(u.new_bed, p.bedrooms),
         "updatedAt" = NOW()
       FROM (
         SELECT
           unnest($1::text[]) AS id,
           unnest($2::int[]) AS new_year,
           unnest($3::int[]) AS new_sqft,
           unnest($4::int[]) AS new_stories,
           unnest($5::float8[]) AS new_bath,
           unnest($6::int[]) AS new_bed
       ) AS u
       WHERE p.id = u.id`,
      [ids, yearBuilts, sqfts, storiesList, bathrooms, bedrooms]
    );
  } catch (e) {
    console.error(`  DB update error: ${e.message}`);
  }
}

// ---------- Main ----------

async function main() {
  const startTime = Date.now();
  console.log('=== Eavesight Building Data Enrichment (Phase 2: countygovservices.com) ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Concurrency: ${CONCURRENCY}, Delay: ${BASE_DELAY_MS}ms\n`);

  const pool = new Pool(DB_CONFIG);

  // Only load MADISON COUNTY properties (where county = 'Madison')
  console.log('Loading Madison County properties with parcelId but missing yearBuilt...');
  const { rows: properties } = await pool.query(
    `SELECT id, "parcelId"
     FROM properties
     WHERE "parcelId" IS NOT NULL
       AND "yearBuilt" IS NULL
       AND county = 'Madison'
     ORDER BY id`
  );
  console.log(`  Found ${properties.length} properties to scrape\n`);

  if (properties.length === 0) {
    console.log('Nothing to do!');
    await pool.end();
    return;
  }

  // Resume from last progress
  const progress = loadProgress();
  const startIndex = progress.lastProcessedIndex || 0;
  if (startIndex > 0) {
    console.log(`  Resuming from index ${startIndex}`);
  }

  let processed = startIndex;
  let enriched = 0;
  let noData = 0;
  let errors = 0;
  let rateLimited = 0;
  let currentDelay = BASE_DELAY_MS;
  const updates = [];

  for (let i = startIndex; i < properties.length; i += CONCURRENCY) {
    const batch = properties.slice(i, Math.min(i + CONCURRENCY, properties.length));

    const results = await Promise.allSettled(
      batch.map(async (prop) => {
        const url = `${BASE_URL}?taxyear=${TAX_YEAR}&ppin=${prop.parcelId}`;
        const html = await fetchHTML(url);
        const data = parsePropertyPage(html);
        return { id: prop.id, data };
      })
    );

    let batchRateLimited = false;
    for (const result of results) {
      processed++;

      if (result.status === 'rejected') {
        const msg = result.reason?.message || '';
        if (msg.startsWith('RATE_LIMITED:')) {
          batchRateLimited = true;
          rateLimited++;
          const waitSec = parseInt(msg.split(':')[1]) || 60;
          currentDelay = Math.min(waitSec * 1000 + 5000, MAX_BACKOFF_MS);
          // Don't count as processed, we'll retry
          processed--;
        } else {
          errors++;
        }
      } else {
        const { id, data } = result.value;
        if (data && (data.yearBuilt || data.sqft)) {
          enriched++;
          updates.push({ id, ...data });
          // Success - gradually reduce delay
          currentDelay = Math.max(BASE_DELAY_MS, currentDelay * 0.95);
        } else if (data === null) {
          // Page loaded but was error/empty - might be rate limited
          errors++;
        } else {
          noData++;
        }
      }
    }

    // If we got rate limited, back off and retry the same batch
    if (batchRateLimited) {
      console.log(`  RATE LIMITED at ${processed}. Waiting ${(currentDelay / 1000).toFixed(0)}s...`);
      await new Promise((r) => setTimeout(r, currentDelay));
      i -= CONCURRENCY; // Retry this batch
      continue;
    }

    // Flush updates to DB periodically
    if (updates.length >= BATCH_UPDATE_SIZE) {
      await flushUpdates(pool, updates.splice(0, updates.length));
    }

    // Save progress periodically
    if (processed % 100 === 0) {
      saveProgress(i + CONCURRENCY);
    }

    if (processed % 500 === 0 || processed === properties.length) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const effectiveProcessed = processed - startIndex;
      const rate = effectiveProcessed > 0 ? (effectiveProcessed / elapsedSec).toFixed(1) : '0';
      const remaining = properties.length - processed;
      const etaMin = rate > 0 ? (remaining / rate / 60).toFixed(1) : '?';
      console.log(`  ${processed}/${properties.length} (${enriched} enriched, ${noData} no data, ${errors} err, ${rateLimited} ratelimit) [${rate}/s, delay:${(currentDelay/1000).toFixed(1)}s, ETA:${etaMin}m]`);
    }

    await new Promise((r) => setTimeout(r, currentDelay));
  }

  // Flush remaining
  if (updates.length > 0) {
    await flushUpdates(pool, updates);
  }

  // Clear progress file on completion
  try { fs.unlinkSync(PROGRESS_FILE); } catch (e) {}

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT("yearBuilt") AS has_yearbuilt,
      COUNT(sqft) AS has_sqft,
      COUNT(stories) AS has_stories,
      COUNT(bathrooms) AS has_bath,
      COUNT(bedrooms) AS has_bed
    FROM properties
  `);

  console.log('\n=== Phase 2 Complete ===');
  console.log(`Processed: ${processed}`);
  console.log(`Enriched: ${enriched}`);
  console.log(`No data: ${noData}`);
  console.log(`Errors: ${errors}`);
  console.log(`Rate limited: ${rateLimited}`);
  console.log(`Time: ${elapsed}s`);
  console.log('\n=== Building Data Coverage ===');
  console.log(`Total: ${stats.total}`);
  console.log(`YearBuilt: ${stats.has_yearbuilt} (${((stats.has_yearbuilt / stats.total) * 100).toFixed(1)}%)`);
  console.log(`SqFt: ${stats.has_sqft} (${((stats.has_sqft / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Stories: ${stats.has_stories} (${((stats.has_stories / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Bathrooms: ${stats.has_bath} (${((stats.has_bath / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Bedrooms: ${stats.has_bed} (${((stats.has_bed / stats.total) * 100).toFixed(1)}%)`);

  await pool.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
