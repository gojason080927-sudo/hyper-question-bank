#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENGINES = [
  'src/lib/ingestion/segmentationV3.ts',
  'src/lib/ingestion/pageRegionV2.ts',
  'src/lib/ingestion/problemAnchorV2.ts',
  'src/lib/ingestion/contextRoleV2.ts',
  'src/lib/ingestion/figureOwnershipV2.ts',
  'src/lib/ingestion/segmentRefineV20.ts',
  'src/lib/ingestion/adaptiveRouter.ts',
  'src/lib/ingestion/crossBook.ts',
  'src/lib/ingestion/visualFigureV1.ts',
  'src/lib/cropGate/cropGateV2.ts',
  'src/lib/cropRecovery/cropRecoveryV1.ts',
  'src/lib/recognition/problemPipeline.ts',
  'src/lib/recognition/draftPersist.ts',
  'src/lib/recognition/draftUpsert.ts',
  'src/lib/taxonomy/taxonomyClassifier.ts',
  'src/lib/taxonomy/classificationPersistence.ts',
  'src/lib/taxonomy/sourceDifficultySystem.ts',
  'src/lib/ocrBenchmark/ocrBenchmarkV1.ts',
  'src/lib/ocr/mistralProvider.ts',
  'src/lib/ocr/mistralSecrets.ts',
  'src/lib/ocr/paidGate.ts',
  'src/lib/pdf/bbox.ts',
]

const IMPORT_RE = /from\s+['"](\.[^'"]+)['"]/g
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.json']

function resolveImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, ...EXT.map((e) => base + e), path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

const missing = []
const seen = new Set()
const queue = ENGINES.map((rel) => path.join(ROOT, rel))
for (const file of queue) {
  if (!fs.existsSync(file)) missing.push({ from: '(engine list)', spec: path.relative(ROOT, file) })
}

while (queue.length) {
  const file = queue.pop()
  if (!file || seen.has(file)) continue
  seen.add(file)
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]
    const resolved = resolveImport(file, spec)
    if (!resolved) missing.push({ from: path.relative(ROOT, file), spec })
    else queue.push(resolved)
  }
}

const bbox = fs.readFileSync(path.join(ROOT, 'src/lib/pdf/bbox.ts'), 'utf8')
const bboxHelpers = ['export function bboxArea', 'export function bboxIoU', 'export function expandBBox']
const bboxMissing = bboxHelpers.filter((row) => !bbox.includes(row))

const report = {
  files_traced: seen.size,
  missing_count: missing.length + bboxMissing.length,
  missing,
  bbox_helpers_missing: bboxMissing,
}
console.log(JSON.stringify(report, null, 2))
if (report.missing_count !== 0) process.exit(1)
