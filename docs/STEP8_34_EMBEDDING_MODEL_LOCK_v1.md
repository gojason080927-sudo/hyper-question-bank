# STEP 8.34 — Embedding model lock

Do not pick a model or dimension by convenience. This file records the single locked choice from the connected API, the repository design, and the provider’s published spec.

## Connected API

The Question Bank worker already uses Mistral for OCR:

- Secret: `MISTRAL_API_KEY` (worker-only; never `VITE_` prefix)
- OCR endpoint: `https://api.mistral.ai/v1/ocr`
- OCR model: `mistral-ocr-latest`

The same key is the only embedding provider this STEP may call. No new vendor signup.

## Official provider spec

| Field | Locked value | Source |
|---|---|---|
| Model id | `mistral-embed` | [Mistral Models overview — Embedding models](https://docs.mistral.ai/getting-started/models/models_overview/) and [Embeddings cookbook](https://docs.mistral.ai/resources/cookbooks/mistral-embeddings-embeddings) |
| Default dimension | **1024** | Cookbook: “the `mistral-embed` model generates embedding vectors of dimension 1024”. La Plateforme announcement: “embedding model with a 1024 embedding dimension”. |
| HTTP | `POST https://api.mistral.ai/v1/embeddings` | Mistral Embeddings API |
| Input field | `inputs` (array of strings); OpenAI-style `input` accepted by some gateways — worker sends `inputs` | Official Python client `client.embeddings.create(..., inputs=[...])` |
| Context | 8k tokens | Provider model card |
| List price used for the $5 cap | **$0.10 per 1M input tokens** | Mistral Embed list price (Mistral AI / documented API pricing). Batch 50% is **not** assumed. |
| Truncation | **Forbidden** | `output_dimension` must not be set. Store the official 1024-d vector. |

`codestral-embed` is a **code** embedding model (different default/max dimensions). It is not used for Korean math stems.

## Repository design

`docs/QUESTION_DB_MASTER_SCHEMA_v1.md` `problem_embeddings`:

`id`, `problem_id`, `embedding_type`, `model`, `model_version`, `vector`, `created_at`

`embeddingType`: `PROBLEM_TEXT | NORMALIZED_TEXT | STRUCTURE_HINT`

CORE v1 omitted the table because pgvector was not enabled. STEP 8.34 adds it additively. SQL column name is `embedding` (type `vector(1024)`) to avoid a `vector vector(1024)` name clash; comments alias it to the design name `vector`.

Primary stored type for search: `NORMALIZED_TEXT`.

## Cost cap

Estimate = unique_texts × tokens_per_text × $0.10 / 1e6.

Token estimate (conservative, Hangul-heavy): `ceil(chars / 2)` with a 32-token floor.

If estimate **> $5.00**, do not call the paid API. Schema, RPC, dry-run search tests, and the book pipeline still finish. Report the estimate and that paid embedding needs approval.

## Cache

Cache key = `sha256(model + "\n" + embedding_type + "\n" + normalized_text)`.

Identical text is embedded once. Failures retry individually. Cache hits are $0.
