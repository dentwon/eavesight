\pset pager off
\pset border 2
\pset linestyle unicode

\echo ========================================
\echo == PHASE 1: STRUCTURAL INVENTORY
\echo == generated from pg_stats + pg_class
\echo ========================================

\echo == 1.1 TABLE-LEVEL METADATA ==
SELECT
  c.relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS heap_size,
  c.reltuples::bigint AS est_rows,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS idx_count,
  (SELECT count(*) FROM pg_constraint con WHERE con.conrelid = c.oid AND con.contype = 'f') AS fk_out,
  (SELECT count(*) FROM pg_constraint con WHERE con.confrelid = c.oid AND con.contype = 'f') AS fk_in,
  s.last_analyze, s.last_vacuum
FROM pg_class c
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo
\echo == 1.2 COLUMN NULL%% AND DISTINCT COUNT (from pg_stats) ==
\echo         n_distinct: positive=unique count, negative=fraction of rows
SELECT
  n.tablename,
  n.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  round((n.null_frac*100)::numeric, 1) AS null_pct,
  n.n_distinct,
  n.avg_width AS avg_bytes
FROM pg_stats n
JOIN pg_attribute a ON a.attname = n.attname
JOIN pg_class c ON c.oid = a.attrelid AND c.relname = n.tablename
WHERE n.schemaname = 'public'
  AND n.tablename IN ('properties','madison_parcel_data','building_permits','property_permits',
                      'building_footprints','property_storms','storm_events','property_enrichments',
                      'property_pin_cards','contractor_licenses','property_hex_aggregates',
                      'tiger_bg_al','data_ingestion_jobs','_harvester_coverage','roof_data','leads',
                      'users','organizations','organization_members','api_keys','territories',
                      'activities','campaigns','canvass_sessions','_acs','_fema_flood','_osm_poi',
                      '_harvest_ext','_harvest_mj','_harvest_parcels','metros','property_alerts',
                      'dnc_entries','sessions','api_quotas','api_usage','_bg','_prisma_migrations')
ORDER BY n.tablename, a.attnum;

\echo
\echo == 1.3 TOP-5 VALUES PER TEXT/ENUM COLUMN (from pg_stats.most_common_vals) ==
SELECT
  tablename, attname,
  most_common_vals::text AS top_values,
  most_common_freqs[1:5] AS freqs
FROM pg_stats
WHERE schemaname='public'
  AND most_common_vals IS NOT NULL
  AND tablename IN ('properties','madison_parcel_data','building_permits','property_permits',
                    'building_footprints','property_storms','storm_events','property_enrichments',
                    'contractor_licenses','leads','_harvester_coverage')
ORDER BY tablename, attname;

\echo
\echo == 1.4 ALL \"source\"-LIKE COLUMN DISTRIBUTIONS (actual counts, not sampled) ==
SELECT 'properties.yearBuiltSource' AS src, "yearBuiltSource" AS val, count(*) FROM properties GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'properties.roofInstalledSource' AS src, "roofInstalledSource" AS val, count(*) FROM properties GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'properties.businessSource' AS src, "businessSource" AS val, count(*) FROM properties GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'properties.source' AS src, source AS val, count(*) FROM properties GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'building_permits.source' AS src, source AS val, count(*) FROM building_permits GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'storm_events.source' AS src, source AS val, count(*) FROM storm_events GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'contractor_licenses.source' AS src, source AS val, count(*) FROM contractor_licenses GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'building_footprints.source' AS src, source AS val, count(*) FROM building_footprints GROUP BY 2 ORDER BY 3 DESC;
\echo
SELECT 'property_enrichments.source' AS src, source AS val, count(*) FROM property_enrichments GROUP BY 2 ORDER BY 3 DESC;
