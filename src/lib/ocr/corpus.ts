import { sameNormalizedBbox } from '../recognition/ocrScore'
import { STEP7_DOCUMENT_ID, STEP7_GROUND_TRUTH_VERSION, STEP7_SAMPLE_COUNT } from './step7Baseline'

export type CorpusBbox = {
  x: number
  y: number
  width: number
  height: number
  unit: 'normalized'
  origin: 'top-left'
}

export type CorpusSample = {
  sample_id: string
  document_id: string
  page_number: number
  bbox: CorpusBbox
  crop_file: string
  crop_sha256: string
  crop_bytes: number
  ground_truth_version: string
}

export type CorpusManifest = {
  kind: string
  document_id: string
  ground_truth_version: string
  sample_count: number
  samples: CorpusSample[]
}

export type CropHashCheck = {
  sample_id: string
  expected_sha256: string
  actual_sha256: string | null
  ok: boolean
  status: 'match' | 'mismatch' | 'missing'
}

export type CorpusValidation = {
  ok: boolean
  sample_count: number
  hash_validation: 'match' | 'mismatch' | 'crops_missing' | 'partial'
  errors: string[]
  warnings: string[]
  checks: CropHashCheck[]
}

type LooseSample = {
  id?: string
  sample_id?: string
  page_number: number
  bbox: { x: number; y: number; width: number; height: number }
}

export function parseCorpusManifest(raw: unknown): CorpusManifest {
  const file = raw as {
    kind?: string
    document_id?: string
    ground_truth_version?: string
    sample_count?: number
    samples?: Array<Omit<CorpusSample, 'ground_truth_version'> & { ground_truth_version?: string }>
  }
  if (!file || file.kind !== 'step7_frozen_scan_corpus') {
    throw new Error('HQB_CORPUS: manifest kind must be step7_frozen_scan_corpus')
  }
  if (file.document_id !== STEP7_DOCUMENT_ID) {
    throw new Error('HQB_CORPUS: document_id does not match the frozen STEP 7 PDF')
  }
  if (file.ground_truth_version !== STEP7_GROUND_TRUTH_VERSION) {
    throw new Error('HQB_CORPUS: ground_truth_version does not match the frozen STEP 7 Ground Truth file')
  }
  if (!Array.isArray(file.samples) || file.samples.length !== STEP7_SAMPLE_COUNT) {
    throw new Error(`HQB_CORPUS: expected ${STEP7_SAMPLE_COUNT} samples`)
  }
  const samples: CorpusSample[] = file.samples.map((row) => {
    if (!row.sample_id || !row.crop_sha256 || !row.bbox) {
      throw new Error('HQB_CORPUS: sample is missing sample_id, bbox, or crop_sha256')
    }
    return {
      ...row,
      ground_truth_version: row.ground_truth_version ?? file.ground_truth_version ?? STEP7_GROUND_TRUTH_VERSION,
    }
  })
  return {
    kind: file.kind,
    document_id: file.document_id,
    ground_truth_version: file.ground_truth_version,
    sample_count: file.sample_count ?? samples.length,
    samples,
  }
}

export function assertManifestMatchesSamples(manifest: CorpusManifest, samplesFile: { samples: LooseSample[] }): void {
  if (samplesFile.samples.length !== manifest.samples.length) {
    throw new Error('HQB_CORPUS: samples.json count differs from the frozen manifest')
  }
  for (let i = 0; i < manifest.samples.length; i += 1) {
    const left = manifest.samples[i]
    const right = samplesFile.samples[i]
    const rightId = right.id ?? right.sample_id
    if (left.sample_id !== rightId) {
      throw new Error(`HQB_CORPUS: sample order changed at ${left.sample_id}`)
    }
    if (
      !sameNormalizedBbox(
        { page_number: left.page_number, bbox: left.bbox },
        { page_number: right.page_number, bbox: right.bbox },
      )
    ) {
      throw new Error(`HQB_CORPUS: bbox changed for ${left.sample_id}; refuse to compare Mathpix on a different crop`)
    }
  }
}

export function checkCropHash(expectedSha256: string, actualSha256: string | null): CropHashCheck['status'] {
  if (!actualSha256) return 'missing'
  return actualSha256 === expectedSha256 ? 'match' : 'mismatch'
}

export function summarizeCorpusChecks(manifest: CorpusManifest, hashes: Record<string, string | null>): CorpusValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const checks: CropHashCheck[] = manifest.samples.map((sample) => {
    const actual = hashes[sample.sample_id] ?? null
    const status = checkCropHash(sample.crop_sha256, actual)
    if (status === 'mismatch') {
      errors.push(`HQB_CORPUS: ${sample.sample_id} crop hash differs from STEP 7. Refuse or regenerate the original crop.`)
    }
    if (status === 'missing') {
      warnings.push(`HQB_CORPUS: ${sample.sample_id} crop file is missing; hash cannot be verified on this machine.`)
    }
    return {
      sample_id: sample.sample_id,
      expected_sha256: sample.crop_sha256,
      actual_sha256: actual,
      ok: status === 'match',
      status,
    }
  })
  const missing = checks.filter((row) => row.status === 'missing').length
  const mismatch = checks.filter((row) => row.status === 'mismatch').length
  const match = checks.filter((row) => row.status === 'match').length
  let hash_validation: CorpusValidation['hash_validation'] = 'match'
  if (mismatch) hash_validation = 'mismatch'
  else if (missing === checks.length) hash_validation = 'crops_missing'
  else if (missing) hash_validation = 'partial'
  else if (match === checks.length) hash_validation = 'match'
  return {
    ok: errors.length === 0,
    sample_count: manifest.sample_count,
    hash_validation,
    errors,
    warnings,
    checks,
  }
}
