import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { overlapIds } from './ssenFullQa839'
import { parseRangeTokens } from './rangeStemRestore838'
import {
  buildPageGroups840,
  candidate840,
  catalogFromQa839,
  contactSheetHtml840,
  decideOne840,
  dryRunSafety840,
  extractRangePromptFromPageOcr,
  isPackagingTrailer840,
  minimizeReview840,
  paidOcrPlan840,
  reviewRequired839,
  row840,
  siblingItemLabelsOutsideRange,
  skipIfCurrentChanged840,
  stripSafePackaging840,
  withAppliedStems840,
  REVIEW_START_840,
  SSEN_LISTED_FROZEN,
  type Input839Record,
} from './ssenReviewMinimize840'

const qaPath = path.join(process.cwd(), 'public/step8-39-full-qa.json')

function load839(): Input839Record[] {
  if (!existsSync(qaPath)) return []
  const parsed = JSON.parse(readFileSync(qaPath, 'utf8')) as { records?: Input839Record[] }
  return parsed.records ?? []
}

describe('page grouping and 128 census', () => {
  it('dedupes REVIEW_REQUIRED ids and groups by page', () => {
    const records = load839()
    expect(records.length).toBeGreaterThan(0)
    const review = reviewRequired839(records)
    expect(review).toHaveLength(REVIEW_START_840)
    expect(new Set(review.map((row) => row.problem_id)).size).toBe(128)
    const catalog = catalogFromQa839(records)
    expect(catalog.filter((row) => row.display_state === 'LISTED')).toHaveLength(SSEN_LISTED_FROZEN)
    const groups = buildPageGroups840(review, catalog)
    expect(groups).toHaveLength(61)
    expect(groups.some((row) => row.source_page === 49 && row.candidate_numbers.length === 12)).toBe(true)
    const p1 = review.filter((row) => row.priority === 'P1')
    expect(p1).toHaveLength(9)
  })

  it('8.38 REVIEW 18 are all inside the 128; live NEEDS_REVIEW overlap is ID-based', () => {
    const review = reviewRequired839(load839())
    const ids = new Set(review.map((row) => row.problem_id))
    const leftover838 = [
      '384e16b4-db6b-4d76-974c-d9d26efaecca',
      'ca4c8736-93f1-413b-bcab-84e1789e7903',
      '86df1f30-e738-4f21-b752-c97d796c5640',
      'a90ab479-549c-47f4-8b3d-c9b784f9f3bd',
      'e5b229b5-c97a-422d-95eb-741b4984a638',
      '96cf18b0-10c7-48d4-8391-d44f8abe44d6',
      '0e792bdc-fce6-489e-833c-47796a979b35',
      '7306b852-286b-4117-bac4-e82bf149d76c',
      'fede76dc-df46-4eb9-af5a-1bfef77fbd4b',
      'f74f22a2-dd5f-4266-8f1c-0e15fcafa2f8',
      'e8a8fbae-e24e-4755-b89e-a0a4122cb35d',
      '307956f6-db4b-490c-8fae-6ac63e107bf6',
      '96c9a45e-15ae-49b7-ae1b-2325d76f4052',
      'ef541457-ccb8-46d1-8b72-98fbf5cdb8c0',
      'ea240fef-caa3-4d5f-93d9-6cabb5eb5c77',
      '5525606a-8cb4-4f37-b9d9-245ea9cd690c',
      '35e3691a-5db9-4b8d-9a58-25012ab40a37',
      'c60484dc-4036-4759-ab09-e991bb9c2a28',
    ]
    expect(leftover838.every((id) => ids.has(id))).toBe(true)
    const liveNeeds = [
      '3edacc37-8d19-41a8-8387-356e45c61f50',
      '9e097ac3-f5a4-4255-b49d-4da43f7fb4aa',
      'baba4283-f091-4ef3-b403-5c6013788fea',
      '0413c266-4fa4-462a-bf3b-0f6546725cd7',
      '892087ed-5507-4660-bf20-f922a4210638',
      'f07b6041-d62f-4058-bd0d-b3dbeef2b7c1',
      '609087fc-4985-44b2-8853-b307176bb29c',
      '6fdbe8c7-e5cc-466b-a88b-bbabc2a6d005',
      'eec6f8a5-9c00-4035-9509-fd00fa006626',
    ]
    const overlap = overlapIds([...ids], liveNeeds)
    expect(overlap.both.length).toBe(4)
    expect(overlap.onlyRight.length).toBe(5)
  })
})

describe('PASS_FALSE_POSITIVE own-range and short atoms', () => {
  it('treats [0003~0004] start items as normal shared prompts', () => {
    const cand = candidate840({
      problem_id: 'a',
      current_number: '0003',
      stem: '[0003~0004] 다항식을 정리하시오.\n$x$에 대한 내림차순',
      root_cause: 'OWN_RANGE_HEADER',
      signals: ['OWN_RANGE_HEADER'],
    })
    const sibling = row840({ id: 'b', problem_number: 4, stem: '오름차순' })
    const rec = decideOne840(cand, [row840({ id: 'a', problem_number: 3, stem: cand.stem }), sibling])
    expect(rec.verdict).toBe('PASS_FALSE_POSITIVE')
    expect(siblingItemLabelsOutsideRange(cand.stem, 3, 3, 4)).toEqual([])
  })

  it('keeps glued sibling items inside an own-range as REVIEW', () => {
    const stem = '[0319~0322] 다음 수를 나타내시오.\n0319 $\\sqrt{-9}$\n0320 $\\sqrt{-12}$'
    const cand = candidate840({
      problem_id: 'r',
      current_number: '0319',
      stem,
      source_page: 49,
      root_cause: 'OWN_RANGE_HEADER',
      signals: ['OWN_RANGE_HEADER'],
    })
    const rec = decideOne840(cand, [
      row840({ id: 'r', problem_number: 319, source_page: 49, stem }),
      row840({ id: 's', problem_number: 320, source_page: 49, stem: 'x' }),
    ])
    expect(rec.verdict).toBe('REVIEW_REQUIRED')
  })

  it('clears TOO_SHORT math atoms as false positives', () => {
    const cand = candidate840({
      problem_id: 's',
      current_number: '0279',
      stem: '3-i',
      source_page: 47,
      priority: 'P1',
      root_cause: 'TOO_SHORT',
      signals: ['TOO_SHORT'],
    })
    const rec = decideOne840(cand, [
      row840({ id: 's', problem_number: 279, source_page: 47, stem: '3-i' }),
      row840({ id: 't', problem_number: 280, source_page: 47, stem: '$-1+\\sqrt{2}i$' }),
    ])
    expect(rec.verdict).toBe('PASS_FALSE_POSITIVE')
  })

  it('uses a covering sibling range as evidence for short sub-items', () => {
    const cand = candidate840({
      problem_id: 'u',
      current_number: '0286',
      stem: '허수',
      source_page: 47,
      priority: 'P1',
      root_cause: 'TOO_SHORT',
      signals: ['TOO_SHORT'],
    })
    const cover = row840({
      id: 'c',
      problem_number: 285,
      source_page: 47,
      stem: '[0285~0286] 보기에서 고르시오.\n실수',
    })
    const rec = decideOne840(cand, [row840({ id: 'u', problem_number: 286, source_page: 47, stem: '허수' }), cover])
    expect(rec.verdict).toBe('PASS_FALSE_POSITIVE')
    expect(rec.rules).toContain('too_short_subitem_covered')
  })
})

describe('AUTO_SAFE packaging and proven leaks', () => {
  it('strips trailing 08 이차부등식 even when the TOC title is shorter than 6 chars', () => {
    const packed = stripSafePackaging840('실수 $a$의 값의 범위는? 08 이차부등식')
    expect(packed.text).toBe('실수 $a$의 값의 범위는?')
    expect(packed.rules.some((rule) => rule.includes('이차부등식'))).toBe(true)
    const cand = candidate840({
      problem_id: 'h',
      current_number: '0951',
      stem: '실수 $a$의 값의 범위는? 08 이차부등식',
      source_page: 137,
      root_cause: 'HEADER_NOISE',
      signals: ['HEADER_NOISE'],
    })
    const rec = decideOne840(cand, [row840({ id: 'h', problem_number: 951, source_page: 137, stem: cand.stem })])
    expect(rec.verdict).toBe('AUTO_SAFE')
    expect(rec.proposed_stem).toBe('실수 $a$의 값의 범위는?')
  })

  it('AUTO_SAFE trims a next-number packaging trailer when the next listed row exists', () => {
    const stem = '다음 그림에서 $ab$의 값은?\n① 2\n② 3\n0275\n 39쪽 유형 24'
    const cand = candidate840({
      problem_id: 'n',
      current_number: '0274',
      stem,
      source_page: 44,
      root_cause: 'NEXT_NUMBER_LEAK',
      signals: ['NEXT_NUMBER_LEAK'],
    })
    const rec = decideOne840(cand, [
      row840({ id: 'n', problem_number: 274, source_page: 44, stem }),
      row840({ id: 'm', problem_number: 275, source_page: 44, stem: '39쪽 유형 24 삼각형' }),
    ])
    expect(isPackagingTrailer840('0275\n 39쪽 유형 24')).toBe(true)
    expect(rec.verdict).toBe('AUTO_SAFE')
    expect(rec.proposed_stem).toContain('값은?')
    expect(rec.proposed_stem).not.toContain('0275')
  })

  it('AUTO_SAFE trims a later range that already lives on the next listed start item', () => {
    const stem =
      '0129 나머지가 11일 때 $k$의 값을 구하시오.\n[0130~0131] 다음 일차식으로 나누어떨어질 때 $k$의 값을 구하시오.'
    const cand = candidate840({
      problem_id: 'r',
      current_number: '0129',
      stem,
      source_page: 25,
      root_cause: 'RANGE_LEAK',
      signals: ['RANGE_LEAK'],
    })
    const rec = decideOne840(cand, [
      row840({ id: 'r', problem_number: 129, source_page: 25, stem }),
      row840({
        id: 't',
        problem_number: 130,
        source_page: 25,
        stem: '[0130~0131] 다음 일차식으로 나누어떨어질 때 $k$의 값을 구하시오.\n$x+1$',
      }),
    ])
    expect(rec.verdict).toBe('AUTO_SAFE')
    expect(rec.proposed_stem).not.toContain('[0130~0131]')
  })

  it('does not treat a one-character ② leak as equal to the next stem', () => {
    const stem = '이차함수의 최솟값을 구하시오.\n0598 ②'
    const cand = candidate840({
      problem_id: 'q',
      current_number: '0597',
      stem,
      source_page: 87,
      root_cause: 'NEXT_NUMBER_LEAK',
      signals: ['NEXT_NUMBER_LEAK'],
    })
    const rec = decideOne840(cand, [
      row840({ id: 'q', problem_number: 597, source_page: 87, stem }),
      row840({
        id: 'n',
        problem_number: 598,
        source_page: 87,
        stem: '② 이차함수 $$y=x^2-2$$의 그래프와 직선 $$y=mx$$의 두 교점의 x좌표의 차가 4일 때, 양수 m의 값은?',
      }),
    ])
    expect(rec.verdict).toBe('REVIEW_REQUIRED')
    expect(rec.proposed_stem).toBeNull()
  })

  it('does not trim a glued next item when that number is missing from listed', () => {
    const stem = '0315 $$1-i$$\n0316 $$i^{100}$$'
    const cand = candidate840({
      problem_id: 'g',
      current_number: '0315',
      stem,
      source_page: 49,
      root_cause: 'NEXT_NUMBER_LEAK',
      signals: ['NEXT_NUMBER_LEAK'],
    })
    const rec = decideOne840(cand, [row840({ id: 'g', problem_number: 315, source_page: 49, stem })])
    expect(rec.verdict).toBe('REVIEW_REQUIRED')
    expect(rec.rules).toContain('next_missing_listed')
  })
})

describe('protections, duplicates, paid OCR 0, idempotency', () => {
  it('never AUTO_SAFE TEACHER_EDIT or VERIFIED', () => {
    const stem = '본문입니다 08 이차부등식'
    const teacher = decideOne840(
      candidate840({
        problem_id: 't',
        current_number: '0001',
        stem,
        teacher_edit: true,
        root_cause: 'HEADER_NOISE',
        signals: ['HEADER_NOISE'],
      }),
      [row840({ id: 't', problem_number: 1, stem, origin: 'TEACHER_EDIT', teacher_edit: true })],
    )
    const verified = decideOne840(
      candidate840({
        problem_id: 'v',
        current_number: '0002',
        stem,
        verified: true,
        root_cause: 'HEADER_NOISE',
        signals: ['HEADER_NOISE'],
      }),
      [row840({ id: 'v', problem_number: 2, stem, review_status: 'VERIFIED', verified: true })],
    )
    expect(teacher.verdict).toBe('REVIEW_REQUIRED')
    expect(verified.verdict).toBe('REVIEW_REQUIRED')
    expect(teacher.proposed_stem).toBeNull()
    expect(verified.proposed_stem).toBeNull()
  })

  it('does not invent choices for duplicate 대표문제 stubs', () => {
    const stem = '대표 문제 다음 중 옳은 것은?'
    const rec = decideOne840(
      candidate840({
        problem_id: 'd',
        current_number: '0331',
        stem,
        source_page: 50,
        priority: 'P1',
        root_cause: 'DUPLICATE_BODY',
        signals: ['DUPLICATE_BODY'],
      }),
      [row840({ id: 'd', problem_number: 331, source_page: 50, stem })],
    )
    expect(rec.verdict).toBe('REVIEW_REQUIRED')
    expect(rec.proposed_stem).toBeNull()
  })

  it('skips apply when current version hash changed', () => {
    const apply = {
      problem_id: 'x',
      public_code: 'HQB-x',
      current_number: '0001',
      source_page: 9,
      from_stem: 'old',
      to_stem: 'new',
      from_hash: 'aaa',
      to_hash: 'bbb',
      rules: ['x'],
      parent_version_id: 'v1',
    }
    const skip = skipIfCurrentChanged840(apply, row840({ id: 'x', problem_number: 1, stem: 'changed', current_version_id: 'v2' }))
    expect(skip.skip).toBe(true)
  })

  it('idempotent re-run writes 0 after AUTO_SAFE apply', () => {
    const stem = '범위는? 08 이차부등식'
    const cand = candidate840({
      problem_id: 'i',
      current_number: '0951',
      stem,
      source_page: 137,
      root_cause: 'HEADER_NOISE',
      signals: ['HEADER_NOISE'],
    })
    const catalog = [row840({ id: 'i', problem_number: 951, source_page: 137, stem })]
    const plan = minimizeReview840([cand], catalog)
    expect(plan.applies).toHaveLength(1)
    const again = minimizeReview840(
      [{ ...cand, stem: plan.applies[0]!.to_stem }],
      withAppliedStems840(catalog, plan.applies),
    )
    expect(again.applies).toHaveLength(0)
  })

  it('paid OCR plan is 0 calls even if a blocked page exists', () => {
    const records = load839()
    const review = reviewRequired839(records)
    const plan = minimizeReview840(review, catalogFromQa839(records))
    const paid = paidOcrPlan840(plan)
    expect(plan.summary.paid_ocr_calls).toBe(0)
    expect(paid.calls).toBe(0)
    expect(plan.decisions).toHaveLength(128)
    expect(plan.p1).toHaveLength(9)
    expect(plan.p1.every((row) => Boolean(row.verdict))).toBe(true)
    const safety = dryRunSafety840(plan, SSEN_LISTED_FROZEN)
    expect(safety.ok).toBe(true)
    expect(plan.summary.problems_deleted).toBe(0)
  })

  it('contact sheet shows the full page and never fakes a crop box', () => {
    const html = contactSheetHtml840(
      {
        group_key: 'g',
        source_id: 's',
        source_page: 47,
        major_code: 'II',
        section_code: '03',
        number_range: '0279~0301',
        listed_numbers: ['0279'],
        candidate_numbers: ['0279'],
        candidate_ids: ['s'],
        original_page_available: true,
        page_ocr_chars: 10,
      },
      [
        decideOne840(
          candidate840({
            problem_id: 's',
            current_number: '0279',
            stem: '3-i',
            source_page: 47,
            root_cause: 'TOO_SHORT',
            signals: ['TOO_SHORT'],
            priority: 'P1',
          }),
          [row840({ id: 's', problem_number: 279, source_page: 47, stem: '3-i' })],
        ),
      ],
      '../pages/p047.png',
    )
    expect(html).toContain('원본 페이지')
    expect(html).toContain('임의 crop은 사용하지 않음')
    expect(html).not.toContain('clip-path')
  })

  it('extracts a hyphen range prompt from page OCR without guessing coefficients', () => {
    const ocr = '[0279-0284] 다음 복소수의 실수부분과 허수부분을 구하시오.\n0279 3-i'
    const extracted = extractRangePromptFromPageOcr(ocr, 279)
    expect(extracted?.raw).toContain('0279')
    expect(extracted?.prompt).toContain('구하시오')
    expect(parseRangeTokens(ocr)[0]).toMatchObject({ start: 279, end: 284 })
  })
})
