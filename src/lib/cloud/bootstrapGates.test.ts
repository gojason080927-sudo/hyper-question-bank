import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { forbiddenBrowserMistralKeys } from '../ocr/mistralSecrets'
import { forbiddenBrowserMathpixKeys } from '../ocr/mathpixSecrets'
import { bboxArea, bboxIoU, expandBBox, validateBBox } from '../pdf/bbox'

const root = process.cwd()

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

describe('Cloud bootstrap gates', () => {
  it('keeps core pipeline engines on disk', () => {
    for (const rel of ENGINES) {
      expect(existsSync(path.join(root, rel)), rel).toBe(true)
    }
  })

  it('reports missing internal source dependencies as 0', () => {
    const result = spawnSync(process.execPath, ['scripts/cloud-dependency-audit.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.missing_count).toBe(0)
  })

  it('exports bboxArea, bboxIoU, and expandBBox', () => {
    const box = validateBBox({ x: 0.1, y: 0.1, width: 0.2, height: 0.2, unit: 'normalized', origin: 'top-left' })
    expect(bboxArea(box)).toBeCloseTo(0.04)
    expect(bboxIoU(box, box)).toBeCloseTo(1)
    expect(expandBBox(box, 0.05).x).toBeLessThan(box.x)
  })

  it('keeps paid OCR and service-role secrets out of Vite env types', () => {
    const envTypes = readFileSync(path.join(root, 'src/lib/supabase/env.d.ts'), 'utf8')
    expect(envTypes).toMatch(/VITE_SUPABASE_URL/)
    expect(envTypes).toMatch(/VITE_SUPABASE_ANON_KEY/)
    expect(envTypes).not.toMatch(/SERVICE_ROLE/)
    expect(envTypes).not.toMatch(/MATHPIX/)
    expect(envTypes).not.toMatch(/MISTRAL/)
    expect(forbiddenBrowserMistralKeys().every((key) => key.startsWith('VITE_'))).toBe(true)
    expect(forbiddenBrowserMathpixKeys().every((key) => key.startsWith('VITE_'))).toBe(true)
    const example = readFileSync(path.join(root, '.env.example'), 'utf8')
    expect(example).not.toMatch(/^VITE_.*SERVICE_ROLE/m)
    expect(example).not.toMatch(/^VITE_MATHPIX/m)
    expect(example).not.toMatch(/^VITE_MISTRAL/m)
  })

  it('does not treat STEP 8.22 as production-ready merely because source exists', () => {
    const summary = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-22/summary.json'), 'utf8'))
    expect(summary.readiness).toBe('FIGURE_PIPELINE_NOT_READY')
    expect(summary.false_figure_safe).toBe(0)
  })
})
