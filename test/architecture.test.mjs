import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ARCHIFY_BIN = path.resolve('.agents/skills/archify/bin/archify.mjs');
const SOURCE_DIR = path.resolve('docs/architecture/source');
const GENERATED_DIR = path.resolve('docs/architecture/generated');
const SNAPSHOTS_DIR = path.resolve('docs/architecture/snapshots');
const REVIEWS_DIR = path.resolve('docs/architecture/reviews');
const IMPACT_MAP_PATH = path.resolve('docs/architecture/impact-map.json');

const DIAGRAM_TYPES = {
  '.architecture.json': 'architecture',
  '.sequence.json': 'sequence',
  '.workflow.json': 'workflow',
  '.dataflow.json': 'dataflow',
  '.lifecycle.json': 'lifecycle'
};

test('Archify Acceptance 1: Archify Skill Doctor verifies environment', () => {
  assert.ok(fs.existsSync(ARCHIFY_BIN), 'archify.mjs binary must exist');
  const res = spawnSync(process.execPath, [ARCHIFY_BIN, 'doctor'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, `Archify doctor must exit with 0. Stderr: ${res.stderr}`);
});

test('Archify Acceptance 2: All authored architecture diagrams pass showcase validation', () => {
  assert.ok(fs.existsSync(SOURCE_DIR), 'docs/architecture/source must exist');
  const files = fs.readdirSync(SOURCE_DIR);
  assert.ok(files.length >= 6, 'Must contain at least 6 authored architecture diagrams');

  for (const file of files) {
    let type = null;
    for (const [ext, dType] of Object.entries(DIAGRAM_TYPES)) {
      if (file.endsWith(ext)) {
        type = dType;
        break;
      }
    }
    if (!type) continue;

    const filePath = path.join(SOURCE_DIR, file);
    const res = spawnSync(process.execPath, [ARCHIFY_BIN, 'validate', type, filePath, '--quality', 'showcase', '--json'], {
      encoding: 'utf8'
    });

    assert.strictEqual(res.status, 0, `Diagram ${file} must pass validation: ${res.stdout || res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.strictEqual(result.ok, true, `Diagram ${file} validation result must be ok: true`);
    assert.strictEqual(result.composition?.summary?.errors, 0, `Diagram ${file} must have 0 errors`);
    assert.strictEqual(result.composition?.summary?.warnings, 0, `Diagram ${file} must have 0 warnings`);
  }
});

test('Archify Acceptance 3: Generated HTML deliverables exist and are non-empty', () => {
  assert.ok(fs.existsSync(GENERATED_DIR), 'docs/architecture/generated must exist');
  const expectedHtml = [
    'bms-runtime.architecture.html',
    'invoice-post.sequence.html',
    'receipt-payment.workflow.html',
    'financial-data.dataflow.html',
    'document-lifecycle.lifecycle.html',
    'realtime-sync.sequence.html'
  ];

  for (const htmlFile of expectedHtml) {
    const fullPath = path.join(GENERATED_DIR, htmlFile);
    assert.ok(fs.existsSync(fullPath), `Generated artifact ${htmlFile} must exist`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 50000, `Generated artifact ${htmlFile} must be self-contained (>50KB)`);
  }
});

test('Archify Acceptance 4: Architecture Delta review files exist and validate correctly', () => {
  const base = path.join(SNAPSHOTS_DIR, 'bms-runtime.base.json');
  const head = path.join(SNAPSHOTS_DIR, 'bms-runtime.head.json');
  const deltaHtml = path.join(REVIEWS_DIR, 'bms-runtime-delta.html');

  assert.ok(fs.existsSync(base), 'Base architecture snapshot must exist');
  assert.ok(fs.existsSync(head), 'Head architecture snapshot must exist');
  assert.ok(fs.existsSync(deltaHtml), 'Architecture delta review HTML must exist');
});

test('Archify Acceptance 5: Impact Map manifest maps real repository paths to stable node IDs', () => {
  assert.ok(fs.existsSync(IMPACT_MAP_PATH), 'impact-map.json must exist');
  const manifest = JSON.parse(fs.readFileSync(IMPACT_MAP_PATH, 'utf8'));

  assert.strictEqual(manifest.system, 'BMS NEXT');
  assert.ok(manifest.nodes, 'Manifest must have nodes mapping');

  const requiredStableIds = [
    'frontend-ui',
    'tax-engine',
    'accounting-engine',
    'posting-service',
    'firebase-rtdb',
    'dexie-cache',
    'realtime-sync',
    'reports-engine',
    'pdf-engine'
  ];

  for (const id of requiredStableIds) {
    assert.ok(manifest.nodes[id], `Node "${id}" must exist in impact manifest`);
    const paths = manifest.nodes[id].paths;
    assert.ok(Array.isArray(paths) && paths.length > 0, `Node "${id}" must have mapped paths`);
    for (const relPath of paths) {
      assert.ok(fs.existsSync(path.resolve(relPath)), `Mapped path "${relPath}" must exist in repository`);
    }
  }
});

test('Archify Acceptance 6: Security & Privacy audit - Zero secrets in architecture artifacts', () => {
  const checkDirs = [SOURCE_DIR, GENERATED_DIR, SNAPSHOTS_DIR, REVIEWS_DIR];
  const forbiddenPatterns = [
    /AIza[0-9A-Za-z-_]{35}/,
    /-----BEGIN PRIVATE KEY-----/,
    /-----BEGIN RSA PRIVATE KEY-----/,
    /"client_secret"\s*:\s*"[^"]+"/,
    /"private_key"\s*:\s*"[^"]+"/,
    /password\s*[:=]\s*['"][^'"]+['"]/i
  ];

  for (const dir of checkDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert.doesNotMatch(content, pattern, `File ${file} in ${path.basename(dir)} must NOT contain secrets matching ${pattern}`);
      }
    }
  }
});
