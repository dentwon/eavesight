import { open } from 'node:fs/promises';
import { MBTiles } from '@mapbox/mbtiles';
import { FileBackend, PMTiles } from 'pmtiles';

async function convertMBTilesToPMTiles(inputPath, outputPath) {
  try {
    // Open the MBTiles file
    const mbtiles = new MBTiles(inputPath + '?mode=ro', (err) => {
      if (err) throw err;
    });

    // Get metadata
    const metadata = await new Promise((resolve, reject) => {
      mbtiles.getInfo((err, info) => {
        if (err) reject(err);
        else resolve(info);
      });
    });

    console.log('Metadata:', metadata);

    // Create PMTiles writer
    const file = await open(outputPath, 'w');
    const backend = new FileBackend(file);
    const pmtiles = new PMTiles(backend);

    // Copy tiles from MBTiles to PMTiles
    await new Promise((resolve, reject) => {
      mbtiles.createZXYStream()
        .on('data', (tile) => {
          const [z, x, y, buffer] = tile;
          // Note: MBTiles uses TMS scheme (inverted Y), PMTiles uses XYZ
          const tmsY = (1 << z) - 1 - y;
          pmtiles.putTile(z, x, tmsY, buffer);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Finalize the archive
    await pmtiles.finalize();

    console.log('Conversion completed successfully!');
  } catch (error) {
    console.error('Error during conversion:', error);
  }
}

// Run the conversion
convertMBTilesToPMTiles('./output/north_alabama_buildings.mbtiles', './public/north_alabama_buildings.pmtiles');