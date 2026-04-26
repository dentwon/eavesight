/**
 * Phase 3.7a — rebuild property_pin_cards + property_hex_aggregates for
 * north-alabama using the new anchor-only canonical roof-age ladder.
 *
 * Reports timings + source-distribution deltas vs. the previous 3.5 run.
 */
import { PrismaClient } from '@prisma/client';
import { MaintenanceProcessor } from './src/data-pipeline/maintenance.processor';

async function main() {
  const prisma = new PrismaClient();
  // Bootstrap just enough of the Nest provider contract to access the SQL.
  const proc: any = new (MaintenanceProcessor as any)(prisma);
  // Access the two private SQL builders the processor already has.
  const hexSql: string = proc.hexAggregatesSql('north-alabama');
  const pinSql: string = proc.pinCardsSql('north-alabama');

  const t0 = Date.now();
  const delPin = await prisma.$executeRawUnsafe(
    `DELETE FROM property_pin_cards WHERE "metroCode" = 'north-alabama'`,
  );
  console.log(`deleted pin cards: ${delPin} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const t1 = Date.now();
  const insPin = await prisma.$executeRawUnsafe(pinSql);
  console.log(`inserted pin cards: ${insPin} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const t2 = Date.now();
  const delHex = await prisma.$executeRawUnsafe(
    `DELETE FROM property_hex_aggregates WHERE "metroCode" = 'north-alabama'`,
  );
  console.log(`deleted hex: ${delHex} in ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  const t3 = Date.now();
  const insHex = await prisma.$executeRawUnsafe(hexSql);
  console.log(`inserted hex: ${insHex} in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  // Source distribution on pin cards
  const dist = await prisma.$queryRawUnsafe<
    Array<{ source: string | null; count: bigint }>
  >(`
    SELECT "roofAgeSource" AS source, COUNT(*)::bigint AS count
    FROM property_pin_cards
    WHERE "metroCode" = 'north-alabama'
    GROUP BY "roofAgeSource"
    ORDER BY count DESC
  `);
  const total = dist.reduce((a, r) => a + Number(r.count), 0);
  const src: Record<string, number> = { measured: 0, coc: 0, permit: 0, inferred: 0, unknown: 0 };
  for (const r of dist) {
    const k = r.source || 'unknown';
    src[k] = Number(r.count);
  }
  console.log('source distribution:', { total, ...src });

  // Hex aggregates summary
  const hexSummary = await prisma.$queryRawUnsafe<
    Array<{
      resolution: number;
      cells: bigint;
      cells_with_age: bigint;
      coverage_pct: number;
      min_avg: number | null;
      avg_avg: number | null;
      max_avg: number | null;
    }>
  >(`
    SELECT resolution,
           COUNT(*)::bigint AS cells,
           COUNT("avgRoofAge")::bigint AS cells_with_age,
           ROUND(100.0 * COUNT("avgRoofAge") / NULLIF(COUNT(*), 0), 1)::float AS coverage_pct,
           MIN("avgRoofAge")::float AS min_avg,
           AVG("avgRoofAge")::float AS avg_avg,
           MAX("avgRoofAge")::float AS max_avg
    FROM property_hex_aggregates
    WHERE "metroCode" = 'north-alabama'
    GROUP BY resolution
    ORDER BY resolution
  `);
  console.log('hex aggregates:');
  for (const r of hexSummary) {
    console.log({
      resolution: r.resolution,
      cells: Number(r.cells),
      cells_with_age: Number(r.cells_with_age),
      coverage_pct: r.coverage_pct,
      min_avg: r.min_avg && Number(r.min_avg.toFixed(2)),
      avg_avg: r.avg_avg && Number(r.avg_avg.toFixed(2)),
      max_avg: r.max_avg && Number(r.max_avg.toFixed(2)),
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
