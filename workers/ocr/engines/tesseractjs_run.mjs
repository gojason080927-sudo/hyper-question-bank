/**
 * Isolated Tesseract.js bake-off. Same crops as every other engine.
 * No LLM cleanup. No guessed math restore.
 */
import { createWorker } from 'tesseract.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const crops = path.join(root, 'data', 'crops')
const outDir = path.join(root, 'runs', process.env.HQB_OCR_RUN_DIR || 'tesseractjs')
const lang = process.env.HQB_OCR_LANG || 'kor+eng'
fs.mkdirSync(outDir, { recursive: true })

const files = fs
  .readdirSync(crops)
  .filter((name) => /^S\d+\.png$/i.test(name))
  .sort()

if (!files.length) {
  throw new Error('No S*.png crops. Run build_crops.py first.')
}

const worker = await createWorker(lang, 1, {
  cachePath: path.join(root, 'cache', 'tesseractjs'),
})

const rows = []
for (const name of files) {
  const sampleId = path.basename(name, '.png')
  const started = performance.now()
  let text = ''
  let error = null
  try {
    const result = await worker.recognize(path.join(crops, name))
    text = (result.data?.text || '').trim()
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const seconds = Number(((performance.now() - started) / 1000).toFixed(3))
  const row = {
    sample_id: sampleId,
    engine: `tesseractjs-${lang}`,
    engine_version: '6.0.1',
    processing_mode: 'SCAN_OCR',
    seconds,
    raw_text: text,
    lines: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    error,
  }
  fs.writeFileSync(path.join(outDir, `${sampleId}.json`), JSON.stringify(row, null, 2), 'utf8')
  rows.push(row)
  console.log(sampleId, seconds, error ? `FAIL ${error}` : `ok ${text.slice(0, 40).replace(/\s+/g, ' ')}`)
}

await worker.terminate()
fs.writeFileSync(path.join(outDir, 'all.json'), JSON.stringify(rows, null, 2), 'utf8')
console.log('wrote', path.join(outDir, 'all.json'), rows.length)
