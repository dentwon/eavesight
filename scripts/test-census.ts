/**
 * Census Batch Geocoder - tests connectivity and format
 */
const FormData = require('form-data');
const http = require('http');
const https = require('https');

const HTTPS = https;

// Build the CSV content
const csvLines = [
  'p0,"167 KIMBERLY LN","HUNTSVILLE","AL","35810"',
  'p1,"112 BREAK WATER DR","HUNTSVILLE","AL","35811"',
  'p2,"106 SARALEE DR","HUNTSVILLE","AL","35811"',
  'p3,"296 DAWN DR","TONEY","AL","35773"',
  'p4,"1009 STEVENS AVE NE","HUNTSVILLE","AL","35801"',
];

async function testCensusBatch() {
  const csvContent = csvLines.join('\n');

  const form = new FormData();
  form.append('addressFile', Buffer.from(csvContent), {
    filename: 'addresses.csv',
    contentType: 'text/csv'
  });
  form.append('benchmark', 'Public_AR_Current');
  form.append('vintage', 'Current_Current');
  form.append('format', 'json');

  return new Promise((resolve, reject) => {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/addressbatch');
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = HTTPS.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Content-Type:', res.headers['content-type']);
        console.log('\nFirst 1500 chars of response:');
        console.log(data.substring(0, 1500));

        // Parse JSON lines
        let matchCount = 0;
        for (const line of data.split('\n')) {
          if (!line.trim()) continue;
          try {
            const p = JSON.parse(line);
            const coords = p.result?.addressMatches?.[0]?.coordinates;
            if (coords) {
              matchCount++;
              console.log(`  ${p.id}: ✅ lat=${coords.y.toFixed(5)}, lon=${coords.x.toFixed(5)} — ${p.result.addressMatches[0].matchedAddress}`);
            } else {
              console.log(`  ${p.id}: ❌ no match`);
            }
          } catch(e) {
            console.log('  Parse error on line:', line.substring(0, 100));
          }
        }
        console.log(`\nMatched: ${matchCount}/${csvLines.length}`);
        resolve();
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

testCensusBatch().catch(console.error);
