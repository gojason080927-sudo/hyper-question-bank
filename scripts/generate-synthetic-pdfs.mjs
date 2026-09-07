import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'fixtures', 'pdf')

function pdfEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pageStream(lines, options = {}) {
  const commands = ['BT', '/F1 16 Tf', '72 720 Td']
  lines.forEach((line, index) => {
    if (index === 0) commands.push(`(${pdfEscape(line)}) Tj`)
    else commands.push('0 -26 Td', `(${pdfEscape(line)}) Tj`)
  })
  commands.push('ET')
  if (options.shade) {
    commands.push('0.85 g', '72 80 468 200 re', 'f')
  }
  return commands.join('\n')
}

function object(id, body) {
  return `${id} 0 obj\n${body}\nendobj\n`
}

export function buildSyntheticPdf(kind = 'text', unique = '') {
  const page1 =
    kind === 'scan'
      ? pageStream([], { shade: true })
      : pageStream([
          'HYPER STEP 5 SYNTHETIC TEXT PDF PAGE 1',
          '1. 2x + 3 = 11. Find x.',
          '2. x + y = 10 and x - y = 2.',
          'These lines are embedded text, not a scanned image.',
        ])
  const page2 =
    kind === 'text'
      ? pageStream([
          'HYPER STEP 5 SYNTHETIC TEXT PDF PAGE 2',
          '3. Solve x^2 - 5x + 6 = 0.',
          '4. If 3(x - 1) = 12, find x.',
          'Quadratic and linear items share this text layer.',
        ])
      : pageStream([], { shade: true })

  const objects = [
    object(1, '<< /Type /Catalog /Pages 2 0 R >>'),
    object(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'),
    object(
      3,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    ),
    object(
      4,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    ),
    object(5, `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`),
    object(6, `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`),
    object(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]

  let body = `%PDF-1.4\n% HQB-STEP5 ${kind} ${unique}\n`
  const offsets = [0]
  for (const chunk of objects) {
    offsets.push(body.length)
    body += chunk
  }
  const xrefStart = body.length
  body += `xref\n0 8\n0000000000 65535 f \n`
  for (let i = 1; i <= 7; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'binary')
}

export function buildRecognitionBenchmarkPdf(unique = '') {
  const page1 = pageStream([
    'HYPER STEP 6 SYNTHETIC TEXT PDF',
    '1. 2x + 3 = 11. Find x.',
    '2. x + y = 10 and x - y = 2.',
    '3. Compute 1/2 + 1/3.',
    '4. Solve x^2 - 5x + 6 = 0.',
    '5. Solve 2x + 1 <= 7.',
    'Korean Hangul is not in Helvetica; see string fixtures.',
  ])
  const objects = [
    object(1, '<< /Type /Catalog /Pages 2 0 R >>'),
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    object(
      3,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ),
    object(4, `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`),
    object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  let body = `%PDF-1.4\n% HQB-STEP6 latin ${unique}\n`
  const offsets = [0]
  for (const chunk of objects) {
    offsets.push(body.length)
    body += chunk
  }
  const xrefStart = body.length
  body += `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'binary')
}

export function writeSyntheticPdfs() {
  fs.mkdirSync(outDir, { recursive: true })
  const files = {
    text: path.join(outDir, 'hyper-step5-text.pdf'),
    scan: path.join(outDir, 'hyper-step5-scan.pdf'),
    mixed: path.join(outDir, 'hyper-step5-mixed.pdf'),
    recognition: path.join(outDir, 'hyper-step6-recognition.pdf'),
  }
  fs.writeFileSync(files.text, buildSyntheticPdf('text'))
  fs.writeFileSync(files.scan, buildSyntheticPdf('scan'))
  fs.writeFileSync(files.mixed, buildSyntheticPdf('mixed'))
  fs.writeFileSync(files.recognition, buildRecognitionBenchmarkPdf())
  return files
}

const invoked = process.argv[1] && path.normalize(process.argv[1]).endsWith('generate-synthetic-pdfs.mjs')
if (invoked) {
  const files = writeSyntheticPdfs()
  console.log(files)
}
