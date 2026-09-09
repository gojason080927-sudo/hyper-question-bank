import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { inboxFromPages } from './reviewInbox'
import { layoutInputFromProviderLayout, segmentPageFromLayout, type PageSegmentation } from './layoutSegment'
import { scorePageSegmentation, type PageSegmentScore, type SegmentGroundTruth } from './segmentScore'
import { compareCacheFileName } from '../ocr/ocrCompare'
import { MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'

export const SEGMENT_STEP = '8.1'
export const SEGMENT_MAX_PAGES = 6
export const MISTRAL_SEGMENT_PROFILE = 'ocr-latest+blocks+tables+images'

export type SegmentPageSpec = {
  page_number: number
  role: string
  reason: string
}

export type SegmentBenchPageResult = {
  page_number: number
  role: string
  cache: 'hit' | 'missing'
  image: 'ready' | 'missing'
  segmentation: PageSegmentation | null
  score: PageSegmentScore | null
  overlay_rel: string | null
  regions_rel: string | null
}

export type SegmentBenchResult = {
  step: typeof SEGMENT_STEP
  paid_api_calls: 0
  retries: 0
  cache_hits: number
  cache_missing: number
  pages: SegmentBenchPageResult[]
}

function padPage(pageNumber: number): string {
  return String(pageNumber).padStart(3, '0')
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function loadSegmentManifest(root: string): SegmentPageSpec[] {
  const file = path.join(root, 'ocr-tests/step-8.1-manifest.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { pages?: SegmentPageSpec[] }
  const pages = manifest.pages ?? []
  if (pages.length === 0 || pages.length > SEGMENT_MAX_PAGES) {
    throw new Error(`HQB_SEGMENT_LIMIT: STEP 8.1 allows 1–${SEGMENT_MAX_PAGES} pages`)
  }
  return pages
}

function readMistralCache(root: string, imageSha256: string): {
  layout: { blocks?: unknown[]; images?: unknown[]; dimensions?: { width?: number; height?: number } | null }
} | null {
  const fileName = compareCacheFileName(MISTRAL_PROVIDER, imageSha256, MISTRAL_SEGMENT_PROFILE)
  const file = path.join(root, 'ocr-tests/mistral', fileName)
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    layout?: { blocks?: unknown[]; images?: unknown[]; dimensions?: { width?: number; height?: number } | null }
    raw_response?: { pages?: Array<{ blocks?: unknown[]; images?: unknown[]; dimensions?: { width?: number; height?: number } }> }
  }
  const page0 = raw.raw_response?.pages?.[0]
  return {
    layout: {
      blocks: raw.layout?.blocks ?? page0?.blocks ?? [],
      images: (raw.layout?.images ?? page0?.images ?? []).map((image) => {
        if (!image || typeof image !== 'object') return image
        const copy = { ...(image as Record<string, unknown>) }
        delete copy.image_base64
        return copy
      }),
      dimensions: raw.layout?.dimensions ?? page0?.dimensions ?? null,
    },
  }
}

export function runSegmentBenchmark(root: string): SegmentBenchResult {
  const pages = loadSegmentManifest(root)
  const outDir = path.join(root, 'ocr-tests/segmentation')
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(outDir, 'gt'), { recursive: true })

  const results: SegmentBenchPageResult[] = []
  let cacheHits = 0
  let cacheMissing = 0

  for (const spec of pages) {
    const pad = padPage(spec.page_number)
    const imagePath = path.join(root, `ocr-tests/original/page-${pad}.png`)
    const gtPath = path.join(outDir, 'gt', `page-${pad}.json`)
    const imageReady = existsSync(imagePath)
    if (!imageReady) {
      cacheMissing += 1
      results.push({
        page_number: spec.page_number,
        role: spec.role,
        cache: 'missing',
        image: 'missing',
        segmentation: null,
        score: null,
        overlay_rel: null,
        regions_rel: null,
      })
      continue
    }
    const sha = sha256File(imagePath)
    const cache = readMistralCache(root, sha)
    if (!cache) {
      cacheMissing += 1
      results.push({
        page_number: spec.page_number,
        role: spec.role,
        cache: 'missing',
        image: 'ready',
        segmentation: null,
        score: null,
        overlay_rel: null,
        regions_rel: null,
      })
      continue
    }
    cacheHits += 1
    const input = layoutInputFromProviderLayout(cache.layout)
    const segmentation = segmentPageFromLayout(input)
    const gt = existsSync(gtPath) ? (JSON.parse(readFileSync(gtPath, 'utf8')) as SegmentGroundTruth) : null
    const score = gt ? scorePageSegmentation(spec.page_number, segmentation, gt) : null
    const regionsRel = `ocr-tests/segmentation/page-${pad}-regions.json`
    writeFileSync(
      path.join(root, regionsRel),
      JSON.stringify(
        {
          step: SEGMENT_STEP,
          page_number: spec.page_number,
          role: spec.role,
          engine: segmentation.engine,
          engine_version: segmentation.engine_version,
          status_policy: 'AUTO_OK_or_REVIEW_never_VERIFIED',
          db_writes: 0,
          segmentation,
          score,
        },
        null,
        2,
      ),
    )
    const overlayRel = `ocr-tests/segmentation/page-${pad}-overlay.png`
    results.push({
      page_number: spec.page_number,
      role: spec.role,
      cache: 'hit',
      image: 'ready',
      segmentation,
      score,
      overlay_rel: overlayRel,
      regions_rel: regionsRel,
    })
  }
  writeOverlayBatch(
    results.flatMap((page) => {
      if (!page.segmentation || !page.overlay_rel) return []
      return [
        {
          source: path.join(root, `ocr-tests/original/page-${padPage(page.page_number)}.png`),
          dest: path.join(root, page.overlay_rel),
          segmentation: page.segmentation,
        },
      ]
    }),
  )
  for (const page of results) {
    if (page.overlay_rel && !existsSync(path.join(root, page.overlay_rel))) page.overlay_rel = null
  }

  const summary = {
    step: SEGMENT_STEP,
    paid_api_calls: 0 as const,
    retries: 0,
    cache_hits: cacheHits,
    cache_missing: cacheMissing,
    pages: results,
  }
  writeFileSync(path.join(outDir, 'step-8.1-latest.json'), JSON.stringify(summary, null, 2))
  writeFileSync(path.join(outDir, 'step-8.2-latest.json'), JSON.stringify({ ...summary, step: '8.2' }, null, 2))
  const inbox = inboxFromPages(
    results.flatMap((page) => (page.segmentation ? [{ page_number: page.page_number, segmentation: page.segmentation }] : [])),
  )
  writeFileSync(path.join(outDir, 'step-8.2-inbox.json'), JSON.stringify(inbox, null, 2))
  return summary
}

export function writeOverlayPng(sourcePng: string, destPng: string, segmentation: PageSegmentation): boolean {
  writeOverlayBatch([{ source: sourcePng, dest: destPng, segmentation }])
  return existsSync(destPng)
}

export function writeOverlayBatch(
  jobs: Array<{ source: string; dest: string; segmentation: PageSegmentation }>,
): void {
  if (jobs.length === 0) return
  const payload = jobs.map((job) => ({
    source: job.source,
    dest: job.dest,
    regions: job.segmentation.regions.map((region) => ({
      number: region.detected_problem_number,
      column: region.column_index,
      status: region.status,
      confidence: Number(region.confidence.toFixed(2)),
      x: region.bbox.x,
      y: region.bbox.y,
      w: region.bbox.width,
      h: region.bbox.height,
    })),
  }))
  const tmp = path.join(os.tmpdir(), `hqb-seg-overlay-${Date.now()}.json`)
  writeFileSync(tmp, JSON.stringify(payload), 'utf8')
  const ps1 = `
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json
$font = New-Object System.Drawing.Font 'Segoe UI', 16, [System.Drawing.FontStyle]::Bold
foreach ($payload in $jobs) {
  $src = [System.Drawing.Image]::FromFile($payload.source)
  $bmp = New-Object System.Drawing.Bitmap $src
  $src.Dispose()
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  foreach ($region in $payload.regions) {
    $ok = $region.status -eq 'AUTO_OK'
    $color = if ($ok) { [System.Drawing.Color]::FromArgb(230, 30, 160, 70) } else { [System.Drawing.Color]::FromArgb(230, 220, 120, 20) }
    $pen = New-Object System.Drawing.Pen $color, 4
    $x = [int]($region.x * $bmp.Width)
    $y = [int]($region.y * $bmp.Height)
    $w = [int]($region.w * $bmp.Width)
    $h = [int]($region.h * $bmp.Height)
    $g.DrawRectangle($pen, $x, $y, $w, $h)
    $label = '{0}  col{1}  {2}  {3}' -f $region.number, $region.column, $region.status, $region.confidence
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 0, 0, 0))
    $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $size = $g.MeasureString($label, $font)
    $g.FillRectangle($bg, $x, [Math]::Max(0, $y - [int]$size.Height), [int]$size.Width + 8, [int]$size.Height)
    $g.DrawString($label, $font, $fg, $x + 2, [Math]::Max(0, $y - [int]$size.Height))
    $pen.Dispose(); $bg.Dispose(); $fg.Dispose()
  }
  $g.Dispose()
  $dir = Split-Path $payload.dest
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($payload.dest, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$font.Dispose()
`
  spawnSync('powershell', ['-NoProfile', '-Command', ps1], { encoding: 'utf8' })
  try {
    unlinkSync(tmp)
  } catch {
    /* ignore temp cleanup */
  }
}
