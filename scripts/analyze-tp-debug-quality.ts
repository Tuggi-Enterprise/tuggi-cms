/**
 * Phase 0 analyzer for the TP quality plan.
 *
 * Reads a migration-log-<ts>.log file produced by scripts/migrate-pois-batch.ts
 * --debug-quality true, extracts the [TP_DEBUG_QUALITY] JSON snapshots, and
 * prints a console report answering the Phase 0 analysis questions:
 *
 *   1. Histogram of tp_distances_m per category
 *   2. Distance percentiles (p50/p75/p95/max) per category
 *   3. Boundary source × category cross-tab + search_radius_m distribution
 *   4. POIs where boundary_source = estimated AND search_radius_m > 1km
 *   5. POIs with poi_height_source = null_fallback, counted per category
 *   6. "Far TP" sample: POIs where max(tp_distances_m) > 500m, sorted by tail distance
 *
 * Pure read. No DB / network. Safe to run on any log file.
 *
 * Usage:
 *   npx tsx scripts/analyze-tp-debug-quality.ts migration-log-1780051457516.log
 *   npx tsx scripts/analyze-tp-debug-quality.ts migration-log-1780051457516.log --far-threshold 800
 */
import fs from 'fs';
import readline from 'readline';

interface Snapshot {
  __type: 'tp_debug_quality';
  ts: string;
  poi_id?: string;
  poi_name?: string;
  poi_category?: string | null;
  poi_height_m?: number | null;
  poi_height_source?: 'osm' | 'null_fallback';
  boundary_source?: string;
  boundary_perimeter_m?: number;
  boundary_area_m2?: number;
  urban_density?: string | null;
  elevation_diff_m?: number | null;
  search_radius_m?: number;
  fan_max_horizon_m?: number;
  fan_direction_count?: number;
  fan_step_m?: number;
  fan_sample_points?: number;
  fan_mean_visible_m?: number;
  fan_max_visible_m?: number;
  fan_min_visible_m?: number;
  fan_coverage_km2?: number;
  candidate_count_pre_filter?: number;
  candidate_count_post_los?: number;
  candidate_count_post_street_validation?: number;
  candidate_count_validated?: number;
  tp_count_final?: number;
  tp_distances_m?: number[];
  exit_path: string;
  processing_time_ms?: number;
}

function parseArgs(): { logPath: string; farThreshold: number } {
  const args = process.argv.slice(2);
  let logPath = '';
  let farThreshold = 500;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--far-threshold') {
      farThreshold = parseInt(args[++i] || '500', 10);
    } else if (!a.startsWith('--')) {
      logPath = a;
    }
  }
  if (!logPath) {
    console.error('Usage: npx tsx scripts/analyze-tp-debug-quality.ts <migration-log-*.log> [--far-threshold 500]');
    process.exit(1);
  }
  if (!fs.existsSync(logPath)) {
    console.error(`File not found: ${logPath}`);
    process.exit(1);
  }
  return { logPath, farThreshold };
}

async function readSnapshots(logPath: string): Promise<Snapshot[]> {
  const stream = fs.createReadStream(logPath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out: Snapshot[] = [];
  for await (const line of rl) {
    const i = line.indexOf('[TP_DEBUG_QUALITY]');
    if (i < 0) continue;
    const jsonStart = line.indexOf('{', i);
    if (jsonStart < 0) continue;
    try {
      const obj = JSON.parse(line.slice(jsonStart)) as Snapshot;
      if (obj.__type === 'tp_debug_quality') out.push(obj);
    } catch {
      // Skip malformed lines silently — instrumentation is best-effort.
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function groupBy<T, K extends string>(arr: T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of arr) {
    const k = key(x);
    if (!out[k]) out[k] = [];
    out[k].push(x);
  }
  return out;
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

function padLeft(s: string | number, n: number): string {
  return String(s).padStart(n);
}

function histogram(values: number[], bins: number[]): number[] {
  const counts = new Array(bins.length + 1).fill(0);
  for (const v of values) {
    let bucket = bins.length;
    for (let i = 0; i < bins.length; i++) {
      if (v <= bins[i]) { bucket = i; break; }
    }
    counts[bucket]++;
  }
  return counts;
}

function printHr(): void {
  console.log('─'.repeat(76));
}

function main() {
  const { logPath, farThreshold } = parseArgs();

  console.log(`📂 Reading ${logPath} ...`);
  readSnapshots(logPath).then(snapshots => {
    if (snapshots.length === 0) {
      console.log('❌ No [TP_DEBUG_QUALITY] lines found. Did you run with --debug-quality true?');
      process.exit(0);
    }

    console.log(`✅ ${snapshots.length} POI snapshots parsed.\n`);

    // ── 1. Exit-path breakdown ────────────────────────────────────────────
    printHr();
    console.log('① EXIT-PATH BREAKDOWN');
    printHr();
    const byPath = groupBy(snapshots, s => (s.exit_path || 'unknown') as string);
    for (const [path, list] of Object.entries(byPath).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${pad(path, 28)} ${padLeft(list.length, 6)}  (${(100 * list.length / snapshots.length).toFixed(1)}%)`);
    }
    console.log();

    // ── 2. Category breakdown ─────────────────────────────────────────────
    printHr();
    console.log('② CATEGORY DISTRIBUTION');
    printHr();
    const byCat = groupBy(snapshots, s => (s.poi_category || 'unknown') as string);
    for (const [cat, list] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${pad(cat, 14)} ${padLeft(list.length, 6)}  (${(100 * list.length / snapshots.length).toFixed(1)}%)`);
    }
    console.log();

    // ── 3. TP distance percentiles per category ───────────────────────────
    printHr();
    console.log('③ TP-TO-POI DISTANCE PERCENTILES BY CATEGORY (meters)');
    printHr();
    console.log(`  ${pad('category', 14)}${padLeft('n_tps', 8)}${padLeft('p50', 10)}${padLeft('p75', 10)}${padLeft('p95', 10)}${padLeft('max', 10)}`);
    for (const [cat, list] of Object.entries(byCat).sort()) {
      const dists: number[] = [];
      for (const s of list) if (s.tp_distances_m) dists.push(...s.tp_distances_m);
      if (dists.length === 0) continue;
      const sorted = dists.sort((a, b) => a - b);
      console.log(`  ${pad(cat, 14)}${padLeft(sorted.length, 8)}${padLeft(percentile(sorted, 0.5), 10)}${padLeft(percentile(sorted, 0.75), 10)}${padLeft(percentile(sorted, 0.95), 10)}${padLeft(sorted[sorted.length - 1], 10)}`);
    }
    console.log();

    // ── 4. TP distance histogram (overall) ────────────────────────────────
    printHr();
    console.log('④ TP-TO-POI DISTANCE HISTOGRAM (all TPs, all categories)');
    printHr();
    const bins = [50, 100, 200, 350, 500, 750, 1000, 1500, 2500, 5000];
    const allDists: number[] = [];
    for (const s of snapshots) if (s.tp_distances_m) allDists.push(...s.tp_distances_m);
    const hist = histogram(allDists, bins);
    const labels = [...bins.map((b, i) => i === 0 ? `0..${b}m` : `${bins[i-1]}..${b}m`), `>${bins[bins.length-1]}m`];
    const maxCount = Math.max(...hist, 1);
    for (let i = 0; i < hist.length; i++) {
      const bar = '█'.repeat(Math.round(40 * hist[i] / maxCount));
      console.log(`  ${pad(labels[i], 14)} ${padLeft(hist[i], 6)}  ${bar}`);
    }
    console.log();

    // ── 5. boundary_source × category cross-tab ───────────────────────────
    printHr();
    console.log('⑤ BOUNDARY SOURCE × CATEGORY');
    printHr();
    const sources = new Set<string>();
    const cats = new Set<string>();
    for (const s of snapshots) {
      sources.add(s.boundary_source || 'unknown');
      cats.add(s.poi_category || 'unknown');
    }
    const sortedCats = Array.from(cats).sort();
    let header = `  ${pad('source', 16)}`;
    for (const c of sortedCats) header += padLeft(c, 10);
    header += padLeft('total', 10);
    console.log(header);
    for (const src of Array.from(sources).sort()) {
      let row = `  ${pad(src, 16)}`;
      let total = 0;
      for (const c of sortedCats) {
        const n = snapshots.filter(s => (s.boundary_source || 'unknown') === src && (s.poi_category || 'unknown') === c).length;
        row += padLeft(n, 10);
        total += n;
      }
      row += padLeft(total, 10);
      console.log(row);
    }
    console.log();

    // ── 6. Search radius distribution by boundary source ──────────────────
    printHr();
    console.log('⑥ search_radius_m DISTRIBUTION BY BOUNDARY SOURCE');
    printHr();
    console.log(`  ${pad('source', 16)}${padLeft('n', 6)}${padLeft('p50', 10)}${padLeft('p95', 10)}${padLeft('max', 10)}`);
    for (const src of Array.from(sources).sort()) {
      const radii = snapshots
        .filter(s => (s.boundary_source || 'unknown') === src)
        .map(s => s.search_radius_m)
        .filter((x): x is number => typeof x === 'number')
        .sort((a, b) => a - b);
      if (radii.length === 0) {
        console.log(`  ${pad(src, 16)}${padLeft(0, 6)}${padLeft('—', 10)}${padLeft('—', 10)}${padLeft('—', 10)}`);
        continue;
      }
      console.log(`  ${pad(src, 16)}${padLeft(radii.length, 6)}${padLeft(percentile(radii, 0.5), 10)}${padLeft(percentile(radii, 0.95), 10)}${padLeft(radii[radii.length - 1], 10)}`);
    }
    console.log();

    // ── 7. estimated + large radius (1.9a target population) ──────────────
    printHr();
    console.log(`⑦ ESTIMATED BOUNDARY + search_radius_m > 1000m — Phase 1.9a target sample`);
    printHr();
    const targets = snapshots
      .filter(s => s.boundary_source === 'estimated' && (s.search_radius_m ?? 0) > 1000)
      .sort((a, b) => (b.search_radius_m ?? 0) - (a.search_radius_m ?? 0));
    console.log(`  Found ${targets.length} POIs.`);
    if (targets.length > 0) {
      console.log(`  ${pad('name', 36)}${pad('cat', 10)}${padLeft('radius_m', 12)}${padLeft('n_tp', 6)}${padLeft('max_d', 8)}`);
      for (const s of targets.slice(0, 20)) {
        const maxDist = s.tp_distances_m && s.tp_distances_m.length > 0 ? Math.max(...s.tp_distances_m) : 0;
        console.log(`  ${pad((s.poi_name || '?').slice(0, 35), 36)}${pad(s.poi_category || '?', 10)}${padLeft(s.search_radius_m ?? 0, 12)}${padLeft(s.tp_count_final ?? 0, 6)}${padLeft(maxDist, 8)}`);
      }
      if (targets.length > 20) console.log(`  … +${targets.length - 20} more.`);
    }
    console.log();

    // ── 8. height_source = null_fallback by category ──────────────────────
    printHr();
    console.log('⑧ POIs WITHOUT OSM HEIGHT (poi_height_source = null_fallback)');
    printHr();
    const nullHeight = snapshots.filter(s => s.poi_height_source === 'null_fallback');
    console.log(`  Total: ${nullHeight.length} (${(100 * nullHeight.length / snapshots.length).toFixed(1)}% of POIs)`);
    const nullByCat = groupBy(nullHeight, s => (s.poi_category || 'unknown') as string);
    for (const [cat, list] of Object.entries(nullByCat).sort((a, b) => b[1].length - a[1].length)) {
      const catTotal = byCat[cat]?.length ?? 0;
      console.log(`  ${pad(cat, 14)} ${padLeft(list.length, 6)} / ${catTotal} (${catTotal ? (100 * list.length / catTotal).toFixed(1) : '0'}%)`);
    }
    console.log();

    // ── 9. Far-TP sample ─────────────────────────────────────────────────
    printHr();
    console.log(`⑨ "FAR TP" SAMPLE — POIs with max(tp_distances_m) > ${farThreshold}m`);
    printHr();
    const farPois = snapshots
      .filter(s => s.tp_distances_m && s.tp_distances_m.length > 0 && Math.max(...s.tp_distances_m) > farThreshold)
      .map(s => ({ s, maxD: Math.max(...(s.tp_distances_m as number[])) }))
      .sort((a, b) => b.maxD - a.maxD);
    console.log(`  Found ${farPois.length} POIs.`);
    if (farPois.length > 0) {
      console.log(`  ${pad('name', 36)}${pad('cat', 10)}${pad('src', 12)}${padLeft('max_d', 8)}${padLeft('radius', 10)}${padLeft('fan_mean', 10)}`);
      for (const { s, maxD } of farPois.slice(0, 30)) {
        console.log(`  ${pad((s.poi_name || '?').slice(0, 35), 36)}${pad(s.poi_category || '?', 10)}${pad(s.boundary_source || '?', 12)}${padLeft(maxD, 8)}${padLeft(s.search_radius_m ?? '—', 10)}${padLeft(s.fan_mean_visible_m ?? '—', 10)}`);
      }
      if (farPois.length > 30) console.log(`  … +${farPois.length - 30} more.`);
    }
    console.log();

    // ── Closing notes ─────────────────────────────────────────────────────
    printHr();
    console.log('Phase 0 done. Inspect ⑦ (Phase 1.9a target) and ⑨ (far-TP sample) closely.');
    console.log('Next: pick the Phase 1 / Phase 2 item with the biggest measurable footprint and apply it.');
    printHr();
  });
}

main();
