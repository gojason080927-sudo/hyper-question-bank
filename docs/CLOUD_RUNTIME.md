# Cloud runtime, secrets, and private assets

HYPER Question Bank only. Supabase project ref `owpxsmdcxjmsgadkdsci`. Never Student Care.

## Browser-safe variables

These may use the `VITE_` prefix because they are public by design:

| Name | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Question-bank project URL |
| `VITE_SUPABASE_ANON_KEY` | Anon key for the signed-in staff session |

Copy `.env.example` → `.env.local` on a developer machine. Never commit `.env.local`.

The app still boots if they are empty (landing / login shell). Source PDF viewing needs a signed-in staff session.

## Never `VITE_` (server / worker only)

| Name | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceptance scripts only. Never frontend. Cloud Agents must not invent or request this for bootstrap. |
| `SUPABASE_DB_PASSWORD` | Local/acceptance only |
| `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` | Paid Mathpix worker |
| `MISTRAL_API_KEY` | Paid Mistral worker |

Forbidden browser aliases (code refuses to read them): `VITE_MATHPIX_*`, `VITE_MISTRAL_*`, any `VITE_*SERVICE_ROLE*`.

`src/lib/supabase/env.d.ts` must list only the two public Vite keys.

## Least privilege for source PDFs

Architecture:

1. Original workbooks are **not** in Git.
2. Production files live in Storage bucket `question-bank-sources` (`SOURCE_BUCKET` in `src/lib/pdf/constants.ts`).
3. `SourceDetailPage` already loads bytes via `createSignedUrl` (TTL `SIGNED_URL_TTL_SEC`).
4. Prefer **signed URL / storage read as the authenticated staff user** over service role.
5. Do not grant Cloud Agents production service-role.
6. Do not change production credentials.
7. Do not upload or download large copyrighted corpora during Cloud bootstrap.

Dry-run asset helper:

```bash
node scripts/fetch-source-asset.mjs
node scripts/fetch-source-asset.mjs --storage-path path/in/bucket.pdf
```

Default is dry-run. A live download requires `--allow-download`, `--i-understand-copyrighted-source`, and a staff session. The script never uses service role and never prints secret values.

## Paid OCR

PAID API CALLS during bootstrap = 0.

Order:

1. Local / cheap structural gates (segmentation, crop gate, figure detector, cache).
2. Paid OCR only on **eligible** regions after those gates.
3. Cost guard (`src/lib/ocr/costModel.ts`, `paidGate.ts`).
4. Explicit human approval for bulk.

Live Mathpix/Mistral requires **both** `--allow-paid-api` and `--i-understand-this-costs-money`. `--cache-only` forbids network.

Keep `paidGate.ts`, `mistralSecrets.ts`, and `mathpixSecrets.ts` without `VITE_` prefixes.

## Quality gates vs live DB

Cloud-safe: `npm test`, `npm run lint`, `npx tsc -b`, `npx vite build`.

Not Cloud-default (need secrets + can write DB):

- `npm run test:db:core-v1`
- `npm run test:db:workflow-v1`
- `npm run test:db:review-v1`
- `npm run test:db:pdf-v1`
- `npm run test:db:recognition-v1`
- `npm run test:db:ocr-v1`

Do not run those against production.
