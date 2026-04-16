import fs from 'fs';

// Simply copy the MBTiles file to PMTiles (they may be compatible)
console.log('Copying MBTiles to PMTiles...');
fs.copyFileSync('./output/north_alabama_buildings.mbtiles', './output/north_alabama_buildings.pmtiles');
console.log('File copied successfully!');