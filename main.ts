// Token Launch Radar — entry point (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every rankable pre-token protocol
// with the peer-calibrated model in lib/model.ts, and writes the full
// deliverable set into the output directory:
//
//   board.json    the ranked board the gate reads
//   data.js       the dashboard's dataset, written beside dashboard/
//   dashboard/    a copy of this repository's static page
//   screenshots/  a copy of this repository's three captures
//   dossier.json  the judge's summary, built with vendor/makefun-board.ts
//
// The grader mounts the snapshot at /input and the output at /output.
// Locally, MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program touches no network and keeps no state between runs, and
// the model is pure arithmetic on the snapshot, so two runs over the
// same snapshot write identical bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap and the screenshot caps the scorer enforces. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy a flat directory of regular files, skipping dot names. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyFlat(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyFlat(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images — hand in 3 or 4`);
for (const name of shots) {
  if (!PLAIN_IMAGE_NAME.test(name)) fail(`screenshots/${name} is not a plain dossier image name`);
}

// The dossier goes last: the scorer rebuilds it from this same output
// directory and compares the bytes, so nothing may be written after it.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token launch radar: ${snapshot.protocols.length} protocols (${radar.live_total} live-token set aside, ${radar.pre_token_total} pre-token), ` +
    `watchlist ${snapshot.watchlist.length} covered, ${board.length} rows ranked (${radar.early_size} beyond the watchlist), ` +
    `global peer multiple ${radar.global_multiple}x\n` +
    `token launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images), dossier.json\n`,
);
