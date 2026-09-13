/**
 * STEP 8.35 production helper: apply additive migration, optionally create and archive a labeled test draft.
 * Never sets VERIFIED. Never rewrites the existing 1,281 OCR stems.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const MIGRATION_FILE = '20260913020000_hqb_wysiwyg_editor_v1.sql'
const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist')
const applyOnly = process.argv.includes('--apply-schema') || persist

function redact(text) {
  return text
    .replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_[redacted]')
    .replace(/sb_secret_[A-Za-z0-9_]+/g, 'sb_secret_[redacted]')
    .slice(0, 800)
}

async function applyMigration(token) {
  const sql = readFileSync(path.join(root, 'supabase/migrations', MIGRATION_FILE), 'utf8')
  const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'hqb_wysiwyg_editor_v1', query: sql }),
  })
  if (mgmt.ok) return { applied: true, reason: 'applied' }
  const body = redact(await mgmt.text())
  if (/already|duplicate|exists/i.test(body)) return { applied: true, reason: 'already_applied' }
  return { applied: false, reason: `management ${mgmt.status}: ${body}` }
}

async function staffClient(url, service) {
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await staff.auth.admin.generateLink({ type: 'magiclink', email: PIPELINE_TEACHER_EMAIL })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) throw new Error(`staff magiclink: ${link.error?.message ?? 'no token'}`)
  const verify = await staff.auth.verifyOtp({ token_hash: hashed, type: 'email' })
  if (verify.error || !verify.data.session) throw new Error(`staff verify: ${verify.error?.message ?? 'no session'}`)
  return staff
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? ''
  const outDir = path.join(root, 'ocr-tests/taxonomy/step8-35')
  mkdirSync(outDir, { recursive: true })

  const summary = {
    step: '8.35',
    status: persist ? 'PERSISTED' : 'PLANNED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    production_verified_writes: 0,
    content_rewrites: 0,
    schema: { attempted: false, applied: false, reason: 'not requested' },
    test_problem: null,
  }

  if (applyOnly && token) {
    summary.schema = { attempted: true, ...(await applyMigration(token)) }
  } else if (applyOnly) {
    summary.schema = { attempted: false, applied: false, reason: 'missing SUPABASE_ACCESS_TOKEN' }
  }

  if (persist && url && service && summary.schema.applied) {
    const staff = await staffClient(url, service)
    const created = await staff.rpc('hqb_create_problem_draft', {
      payload: {
        source: {
          new_document: {
            title: 'STEP 8.35 WYSIWYG fixture (do not use in worksheets)',
            document_type: 'TEACHER_CREATED',
            publisher: 'HYPER',
            publication_year: 2026,
            license_status: 'OWNED',
            usage_scope: 'INTERNAL',
          },
          page_number: 1,
          original_problem_number: 'STEP835',
          source_type_label: 'STEP8_35_TEST',
        },
        version: {
          instruction: '다음 물음에 답하시오.',
          problem_text: '식 $x^2$ 의 값을 구하시오.',
          normalized_text: '식 $x^2$ 의 값을 구하시오.',
          item_format: 'SHORT_ANSWER',
          origin: 'TEACHER_EDIT',
        },
        choices: [],
        answer: { answer_type: 'NUMBER', answer_text: '4', normalized_answer: '4', numeric_value: '4' },
        explanation: { explanation_type: 'TEACHER', content: '테스트 해설' },
        expressions: [
          {
            original_expression: 'x^2',
            latex_expression: 'x^2',
            normalized_expression: 'x^2',
            structure_skeleton: '',
            expression_role: 'TARGET',
            sort_order: 1,
            structure_tags: [],
          },
        ],
        difficulty: {
          concept_difficulty: 1,
          calculation_complexity: 1,
          reasoning_depth: 1,
          condition_complexity: 1,
          representation_complexity: 1,
          trap_level: 1,
        },
      },
    })
    if (created.error) {
      summary.test_problem = { error: created.error.message }
      summary.status = 'PARTIAL'
    } else {
      const row = created.data
      const saved = await staff.rpc('hqb_save_editor_document', {
        p_version_id: row.version_id,
        payload: {
          expected_revision: 0,
          change_reason: 'STEP 8.35 fixture save',
          editor_document: {
            schema_version: 1,
            tiptap_json: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '식 ' },
                    { type: 'mathInline', attrs: { latex: 'x^2' } },
                    { type: 'text', text: ' 의 값을 구하시오.' },
                  ],
                },
              ],
            },
            latex_index: [{ latex: 'x^2', display: false, path: '0.0.1' }],
            blocks: { stem: true, instruction: true, condition: false, choices: false, figure: false, explanation: true },
            choice_layout: 'VERTICAL',
            converted_from_ocr: false,
            source_text_sha256: null,
          },
          version: {
            instruction: '다음 물음에 답하시오.',
            problem_text: '식 $x^2$ 의 값을 구하시오.',
            normalized_text: '식 $x^2$ 의 값을 구하시오.',
            item_format: 'SHORT_ANSWER',
          },
          choices: [],
          answer: { answer_type: 'NUMBER', answer_text: '4', normalized_answer: '4', numeric_value: '4' },
          explanation: { explanation_type: 'TEACHER', content: '테스트 해설' },
          expressions: [
            {
              original_expression: 'x^2',
              latex_expression: 'x^2',
              normalized_expression: 'x^2',
              expression_role: 'TARGET',
              sort_order: 1,
              structure_tags: [],
            },
          ],
        },
      })
      const sheet = await staff.rpc('hqb_create_worksheet', {
        payload: { title: 'STEP 8.35 A4 fixture', exam_kind: 'EXAM', layout: { columns: 1 } },
      })
      if (!sheet.error && sheet.data?.worksheet_id) {
        await staff.rpc('hqb_replace_worksheet_items', {
          p_worksheet_id: sheet.data.worksheet_id,
          payload: {
            items: [
              {
                problem_id: row.problem_id,
                problem_version_id: saved.data?.version_id ?? row.version_id,
                order_no: 1,
                points: 5,
              },
            ],
          },
        })
        await staff.rpc('hqb_archive_worksheet', { p_worksheet_id: sheet.data.worksheet_id })
      }
      await staff.rpc('hqb_archive_problem', { p_problem_id: row.problem_id })
      summary.test_problem = {
        public_code: row.public_code,
        problem_id: row.problem_id,
        saved: !saved.error,
        save_error: saved.error?.message ?? null,
        archived: true,
        review_status: 'UNREVIEWED',
      }
      summary.status = saved.error ? 'PARTIAL' : 'PERSISTED'
    }
  }

  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

await main()
