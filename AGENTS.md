# HYPER Question Bank — Autonomous Cloud Agent Contract

This repository is **HYPER Question Bank** only. Supabase project ref starts with `owp…`. Never Student Care.

## 1. Mission

Ingest math workbooks and exams into structured, reviewable problem records. Classify them with the HYPER type dictionary. Retrieve similar and twin problems. Support editing and worksheet production.

Do not treat a green build as product-ready ingestion.

## 2. Priority

Work in this order unless a human redirects:

1. Ingestion accuracy (segmentation, crop safety, figure coverage, OCR quality)
2. HYPER type dictionary
3. Similar / twin retrieval
4. Worksheet editor
5. School exam upload analysis
6. Student wrong-answer integration
7. Long-term school exam DNA

## 3. Production safety (never skip)

WITHOUT explicit human approval, NEVER:

- DROP / DELETE / TRUNCATE production data
- `supabase db reset` or `supabase db push` against production
- blindly apply historical migrations (they are already in Git; re-applying is unsafe)
- overwrite original source PDFs
- modify production secrets, rotate API keys, or print secret values
- commit `.env.local`, API keys, JWT, private keys, or service-role material
- commit copyrighted workbook PDFs or large page/crop PNG collections
- bulk-write production records
- bulk-call paid OCR APIs
- weaken RLS
- force-push or rewrite shared Git history

If a task needs one of the above, stop with:

```
HUMAN APPROVAL REQUIRED
ACTION / WHY / RISK / SAFEST OPTION / EXPECTED COST/IMPACT
```

SAFE without approval: inspect source, `npm ci`, tests, lint, `tsc`, Vite build, docs/tooling/tests, fix your own failures, commit on a Cloud branch, open a PR.

Historical additive migrations — preserve in Git; do not re-apply:

- `supabase/migrations/20260908120000_hqb_atomic_draft_upsert.sql`
- `supabase/migrations/20260908121000_fix_upsert_bbox_ambiguity.sql`
- `supabase/migrations/20260908220000_hqb_classification_persistence_v1.sql`
- `supabase/migrations/20260909180000_hqb_source_difficulty_v1.sql`

## 4. Workflow

inspect → plan → implement → test → diagnose → safe auto-fix → regression test → commit/PR → concise report

## 5. Human intervention

Ask a human only for irreversible or destructive work, production impact, secrets, meaningful product forks, or paid non-trivial cost.

## 6. Quality gates

Default Cloud gates (must pass before merge):

```bash
npm ci
npm test
npm run lint
npx tsc -b
npx vite build
```

Do not silently worsen regressions. Prefer precision over aggressive auto-ingest.

Live DB scripts (`npm run test:db:*`) write to a database. Do not run them against production. They need secrets that Cloud Agents must not invent.

`npm run pipeline:8.22` / `HQB_BOOK_8_22=1` needs local freeze pages, optional Python/Pillow, and must stay `--cache-only`. It is not a default Cloud gate.

## 7. Figure pipeline

STEP 8.22 ended **FIGURE_PIPELINE_NOT_READY**.

Bottleneck: thin-line / sparse figure detection and safe crop coverage, especially cross-book. `FALSE_FIGURE_SAFE` was 0 on trusted freeze evidence and must stay 0.

Do not mark production-ready merely because code builds. Do not persist figure problems. Do not start STEP 8.23 until a human accepts a later figure-v2 result.

Plan: [docs/FIGURE_DETECTION_V2_PLAN.md](docs/FIGURE_DETECTION_V2_PLAN.md)

## 8. Difficulty

User-facing labels are **하 / 중 / 상** (LOW / MID / HIGH).

Preserve publisher labels separately. Do not hard-map publisher badges into HYPER difficulty.

## 9. Classification

Preserve source evidence and confidence. Ambiguous stays reviewable. Do not force AUTO when evidence is weak.

## 10. Production records

- Persist **DRAFT** before **VERIFIED**
- Source PDF / original page render is source of truth
- Persistence must be idempotent and atomic
- Avoid destructive migrations
- Keep traceability (identity keys, assigned_by, evidence)

## 11. User effort

Bundle safe dependent tasks. Human attention is scarce. One reviewable PR beats many clarifying pings.

## Cloud bootstrap

- Install: `npm ci` from `package-lock.json` (see `.cursor/environment.json`)
- Runtime secrets and storage: [docs/CLOUD_RUNTIME.md](docs/CLOUD_RUNTIME.md)
- Paid OCR: local/cheap structural gates first; paid OCR only on eligible regions; cost guard; explicit approval for bulk. `src/lib/ocr/paidGate.ts` + `mistralSecrets.ts` / `mathpixSecrets.ts` must stay **without** `VITE_` prefixes.
- Private workbooks live in Supabase Storage bucket `question-bank-sources`. Use signed URLs. Never grant yourself production service-role.
- Local Windows exclude files (ocr-tests dumps, extra STEP CLI runners, segmentReview UI, postgres pipeline scripts, Vite ocr-tests plugin) stay **out of Git**.

## Dependency closure

Core engines that must remain import-complete (missing internal source = 0):

`segmentationV3`, `pageRegionV2`, `problemAnchorV2`, `contextRoleV2`, `figureOwnershipV2`, `segmentRefineV20`, `adaptiveRouter`, `crossBook`, `visualFigureV1`, `cropGateV2`, `cropRecoveryV1`, `problemPipeline`, `draftPersist` / `draftUpsert`, taxonomy classifier, classification persistence, source difficulty system/persistence, OCR benchmark engine, Mistral provider, bbox helpers (`bboxArea` / `bboxIoU` / `expandBBox`).

Audit: `node scripts/cloud-dependency-audit.mjs`
