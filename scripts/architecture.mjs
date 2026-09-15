import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ARCHIFY_BIN = path.resolve('.agents/skills/archify/bin/archify.mjs');
const SOURCE_DIR = path.resolve('docs/architecture/source');
const GENERATED_DIR = path.resolve('docs/architecture/generated');
const SNAPSHOTS_DIR = path.resolve('docs/architecture/snapshots');
const REVIEWS_DIR = path.resolve('docs/architecture/reviews');

const DIAGRAM_TYPES = {
  '.architecture.json': 'architecture',
  '.sequence.json': 'sequence',
  '.workflow.json': 'workflow',
  '.dataflow.json': 'dataflow',
  '.lifecycle.json': 'lifecycle'
};

function getDiagramType(filename) {
  for (const [ext, type] of Object.entries(DIAGRAM_TYPES)) {
    if (filename.endsWith(ext)) return type;
  }
  return null;
}

function runArchify(args) {
  const res = spawnSync(process.execPath, [ARCHIFY_BIN, ...args], {
    stdio: 'inherit',
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const command = process.argv[2] || 'validate';

switch (command) {
  case 'doctor': {
    console.log('--- Running Archify Doctor ---');
    runArchify(['doctor']);
    break;
  }

  case 'validate': {
    console.log('--- Validating BMS NEXT Architecture Diagrams (Showcase Profile) ---');
    const files = fs.readdirSync(SOURCE_DIR);
    let count = 0;
    for (const file of files) {
      const type = getDiagramType(file);
      if (!type) continue;
      const filePath = path.join(SOURCE_DIR, file);
      console.log(`\nValidating [${type}]: ${file}`);
      runArchify(['validate', type, filePath, '--quality', 'showcase']);
      count += 1;
    }
    console.log(`\nAll ${count} architecture diagrams passed showcase validation successfully.`);
    break;
  }

  case 'build': {
    console.log('--- Delivering BMS NEXT Architecture HTML Diagrams ---');
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const files = fs.readdirSync(SOURCE_DIR);
    let count = 0;
    for (const file of files) {
      const type = getDiagramType(file);
      if (!type) continue;
      const srcPath = path.join(SOURCE_DIR, file);
      const htmlFile = file.replace(/\.json$/, '.html');
      const outPath = path.join(GENERATED_DIR, htmlFile);
      console.log(`\nDelivering [${type}]: ${htmlFile}`);
      runArchify(['deliver', type, srcPath, outPath, '--quality', 'showcase']);
      count += 1;
    }
    console.log(`\nAll ${count} architecture diagrams delivered to docs/architecture/generated/.`);
    break;
  }

  case 'compare': {
    console.log('--- Running Archify Architecture Delta Compare ---');
    const base = path.join(SNAPSHOTS_DIR, 'bms-runtime.base.json');
    const head = path.join(SNAPSHOTS_DIR, 'bms-runtime.head.json');
    const deltaHtml = path.join(REVIEWS_DIR, 'bms-runtime-delta.html');
    if (!fs.existsSync(base) || !fs.existsSync(head)) {
      console.error('Base or head snapshot not found in docs/architecture/snapshots/');
      process.exit(1);
    }
    if (!fs.existsSync(REVIEWS_DIR)) fs.mkdirSync(REVIEWS_DIR, { recursive: true });
    runArchify(['compare', 'architecture', base, head, deltaHtml]);
    console.log(`\nArchitecture delta generated at docs/architecture/reviews/bms-runtime-delta.html`);
    break;
  }

  default: {
    console.error(`Unknown architecture command "${command}". Expected doctor, validate, build, or compare.`);
    process.exit(1);
  }
}
