import { describe, expect, it } from 'vitest'
import { SSEN_TYPES } from '../outline/ssenToc'
import { profileById } from './typeProfiles'
import { UNIT_CODE } from './classificationPersistence'
import {
  extractTypeMarkers,
  hyperTypeFromSsenTitle,
  looksLikeAnswerKeyLeak,
  planSsenClassify,
  unitFromSection,
  type SsenClassifyItem,
  type SsenTypeNode,
} from './ssenFullClassify'
import { SSEN_SECTIONS, sectionForPage } from '../outline/ssenToc'

function item(partial: Partial<SsenClassifyItem> & Pick<SsenClassifyItem, 'problem_id' | 'original_problem_number' | 'source_page' | 'stem'>): SsenClassifyItem {
  return {
    public_code: `HQB-${partial.original_problem_number}`,
    review_status: 'UNREVIEWED',
    display_state: 'LISTED',
    current_version_id: 'v1',
    origin: 'OCR',
    bbox_top: 0.2,
    bbox_x: 0.1,
    bbox_h: 0.2,
    existing_type_code: null,
    ...partial,
  }
}

const types: SsenTypeNode[] = SSEN_TYPES.map((row) => ({
  id: `${row.sectionCode}-${row.typeCode}`,
  code: row.typeCode,
  title: `유형 ${row.typeCode} ${row.title}`,
  sectionCode: row.sectionCode,
}))

describe('ssen full classify', () => {
  it('maps every frozen SSEN type title onto an existing hyper type in the matching unit and subunit', () => {
    for (const row of SSEN_TYPES) {
      const title = `유형 ${row.typeCode} ${row.title}`
      const section = SSEN_SECTIONS.find((sec) => sec.code === row.sectionCode)!
      const typeId = hyperTypeFromSsenTitle(title, section.title)
      expect(typeId, title).toBeTruthy()
      const profile = profileById(typeId!)
      expect(profile, typeId).toBeTruthy()
      expect(profile!.unit_id).toBe(unitFromSection(section))
      expect(profile!.subunit_id).toBe(section.title)
      expect(UNIT_CODE[profile!.unit_id]).toBeTruthy()
    }
  })

  it('uses a stem 유형 marker that exists in the section and inherits to the next item', () => {
    const planned = planSsenClassify(
      [
        item({ problem_id: 'a', original_problem_number: '0001', source_page: 8, stem: '유형 01 다음 다항식을 정리하시오' }),
        item({ problem_id: 'b', original_problem_number: '0002', source_page: 8, stem: '동류항을 모으시오', bbox_top: 0.6 }),
      ],
      types,
      new Map(),
    )
    expect(planned.decisions[0]?.verdict).toBe('AUTO')
    expect(planned.decisions[0]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.decisions[1]?.verdict).toBe('AUTO')
    expect(planned.decisions[1]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.decisions[1]?.evidence.join(' ')).toContain('inherit_previous_in_section')
  })

  it('ignores a leaked 유형 number that does not exist in the current section', () => {
    const planned = planSsenClassify(
      [item({ problem_id: 'c', original_problem_number: '0774', source_page: 114, stem: '110쪽 유형 16\n원 A, B' })],
      types,
      new Map([[114, '여러 가지 방정식']]),
    )
    expect(planned.decisions[0]?.section_code).toBe('06')
    expect(planned.decisions[0]?.type_code).not.toBe('16')
  })

  it('does not clear NEEDS_REVIEW when the stem still has an answer-key leak', () => {
    expect(looksLikeAnswerKeyLeak('정답 및 풀이 83쪽\n이차함수')).toBe(true)
    const planned = planSsenClassify(
      [
        item({
          problem_id: 'd',
          original_problem_number: '0650',
          source_page: 95,
          stem: '유형 01 정답 및 풀이 83쪽\n이차함수 y=f(x)',
          review_status: 'NEEDS_REVIEW',
        }),
      ],
      types,
      new Map(),
    )
    expect(planned.decisions[0]?.clear_needs_review).toBe(false)
    expect(planned.decisions[0]?.reasons).toContain('ANSWER_KEY_LEAK')
  })

  it('blocks TEACHER_EDIT and VERIFIED', () => {
    const planned = planSsenClassify(
      [
        item({ problem_id: 't', original_problem_number: '0003', source_page: 8, stem: '유형 01 정리하시오', origin: 'TEACHER_EDIT' }),
        item({ problem_id: 'v', original_problem_number: '0004', source_page: 8, stem: '유형 01 정리하시오', review_status: 'VERIFIED' }),
      ],
      types,
      new Map(),
    )
    expect(planned.decisions.map((row) => row.verdict)).toEqual(['HUMAN', 'HUMAN'])
  })

  it('reads unique page-OCR 유형 markers', () => {
    expect(extractTypeMarkers('유형 02 전개\n본문')).toEqual(['02'])
    const planned = planSsenClassify(
      [item({ problem_id: 'e', original_problem_number: '0010', source_page: 10, stem: '다음 전개식의 계수는?' })],
      types,
      new Map([[10, '유형 02 다항식의 전개식에서 계수 구하기']]),
    )
    expect(planned.decisions[0]?.type_id).toBe('POLY_MULTIPLY')
    expect(sectionForPage(10)?.code).toBe('01')
  })

  it('sorts by original problem number so two-column pages keep 쎈 order', () => {
    const planned = planSsenClassify(
      [
        item({ problem_id: 'right', original_problem_number: '0011', source_page: 9, stem: 'A+B를 구하시오', bbox_top: 0.12, bbox_x: 0.55 }),
        item({ problem_id: 'left', original_problem_number: '0001', source_page: 9, stem: '유형 01 내림차순', bbox_top: 0.18, bbox_x: 0.08 }),
      ],
      types,
      new Map(),
    )
    expect(planned.decisions.map((row) => row.original_problem_number)).toEqual(['0001', '0011'])
    expect(planned.decisions[1]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.decisions[1]?.evidence.join(' ')).toContain('inherit_previous_in_section')
  })

  it('uses a unique 유형 pill title and does not inherit into 실력 굳히기', () => {
    const headings = [
      {
        page: 12,
        y_norm: 0.14,
        x_norm: 0.12,
        kind: 'type_pill' as const,
        title_ocr: '다항식의 덧셈과 뺄셈',
        badge_ocr: '유형 01',
      },
      {
        page: 13,
        y_norm: 0.08,
        x_norm: 0.1,
        kind: 'type_pill' as const,
        title_ocr: '다항식의 전개식에서 계수 구하기',
        badge_ocr: '02',
      },
      {
        page: 13,
        y_norm: 0.47,
        x_norm: 0.52,
        kind: 'type_pill' as const,
        title_ocr: '곱셈 공식을 이용한 다항식의 전개',
        badge_ocr: '03',
      },
      {
        page: 20,
        y_norm: 0.04,
        x_norm: 0.08,
        kind: 'c_stage' as const,
        title_ocr: '실력 굳히기',
        badge_ocr: 'C',
      },
    ]
    const planned = planSsenClassify(
      [
        item({ problem_id: 'p40', original_problem_number: '0040', source_page: 12, stem: '두 다항식 A, B에 대하여', bbox_top: 0.11, bbox_x: 0.08, bbox_h: 0.2 }),
        item({ problem_id: 'p46', original_problem_number: '0046', source_page: 13, stem: '전개식에서 x의 계수는?', bbox_top: 0.12, bbox_x: 0.08, bbox_h: 0.18 }),
        item({ problem_id: 'p51', original_problem_number: '0051', source_page: 13, stem: '유형 03 전개식에서 x^9의 계수는?', bbox_top: 0.22, bbox_x: 0.55, bbox_h: 0.18 }),
        item({ problem_id: 'p52', original_problem_number: '0052', source_page: 13, stem: '다음 중 옳지 않은 것은?', bbox_top: 0.52, bbox_x: 0.55 }),
        item({ problem_id: 'p97', original_problem_number: '0097', source_page: 20, stem: '직사각형 ABCD의 넓이를 나타내시오', bbox_top: 0.12, bbox_x: 0.08 }),
      ],
      types,
      new Map(),
      headings,
    )
    expect(planned.decisions[0]?.type_code).toBe('01')
    expect(planned.decisions[1]?.type_code).toBe('02')
    expect(planned.decisions[2]?.type_code).toBe('02')
    expect(planned.decisions[3]?.type_code).toBe('03')
    expect(planned.decisions[4]?.verdict).toBe('HUMAN')
    expect(planned.decisions[4]?.reasons).toContain('TYPE_MARKER_MISSING')
  })

  it('maps a unique 기본 다잡기 concept title and clears inherit on a multi-type concept', () => {
    const headings = [
      {
        page: 9,
        y_norm: 0.08,
        x_norm: 0.08,
        kind: 'concept_pill' as const,
        title_ocr: '다항식의 덧셈과 뺄셈',
        badge_ocr: '01-1',
      },
      {
        page: 9,
        y_norm: 0.42,
        x_norm: 0.52,
        kind: 'concept_pill' as const,
        title_ocr: '다항식의 곱셈 유형 02, 03, 04, 08, 12',
        badge_ocr: '01-2',
      },
    ]
    const planned = planSsenClassify(
      [
        item({ problem_id: 'p1', original_problem_number: '0001', source_page: 9, stem: '내림차순으로 정리하시오', bbox_top: 0.12, bbox_x: 0.08 }),
        item({ problem_id: 'p13', original_problem_number: '0013', source_page: 9, stem: '다음 식을 전개하시오', bbox_top: 0.5, bbox_x: 0.55 }),
      ],
      types,
      new Map(),
      headings,
    )
    expect(planned.decisions[0]?.verdict).toBe('AUTO')
    expect(planned.decisions[0]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.decisions[1]?.verdict).toBe('HUMAN')
    expect(planned.decisions[1]?.reasons).toContain('TYPE_MARKER_MISSING')
  })

  it('matches a 유형 pill title even when OCR appends neighboring problem text', () => {
    const headings = [
      {
        page: 12,
        y_norm: 0.15,
        x_norm: 0.13,
        kind: 'type_pill' as const,
        title_ocr: '다항식의 덧셈과 Hag maori) | 0060 이 수',
        badge_ocr: '2201)',
      },
    ]
    const planned = planSsenClassify(
      [item({ problem_id: 'p40', original_problem_number: '0040', source_page: 12, stem: '두 다항식 A, B에 대하여', bbox_top: 0.17, bbox_x: 0.01, bbox_h: 0.25 })],
      types,
      new Map(),
      headings,
    )
    expect(planned.decisions[0]?.type_code).toBe('01')
    expect(planned.decisions[0]?.type_id).toBe('POLY_ADD_SUB')
  })

  it('maps 나머지정리 유형 05 나눗셈과 항등식 onto IDENTITY_PROPERTY, not POLY_DIVIDE', () => {
    const planned = planSsenClassify(
      [
        item({
          problem_id: 'p258',
          original_problem_number: '0258',
          source_page: 41,
          stem: '유형 05 삼차식 P(x)에 대하여 P(x)는 x^2-2x+3으로 나누어떨어진다',
        }),
      ],
      types,
      new Map(),
    )
    expect(planned.decisions[0]?.type_code).toBe('05')
    expect(planned.decisions[0]?.type_id).toBe('IDENTITY_PROPERTY')
    expect(planned.decisions[0]?.verdict).toBe('AUTO')
    expect(planned.decisions[0]?.reasons).not.toContain('UNIT_TYPE_INCONSISTENT')
  })

  it('does not map a short 다항식의 곱셈 concept onto 나눗셈 type 10', () => {
    const headings = [
      {
        page: 9,
        y_norm: 0.42,
        x_norm: 0.52,
        kind: 'concept_pill' as const,
        title_ocr: '다항식의 곱셈',
        badge_ocr: '01-2',
      },
    ]
    const planned = planSsenClassify(
      [item({ problem_id: 'p13', original_problem_number: '0013', source_page: 9, stem: '다음 식을 전개하시오', bbox_top: 0.5, bbox_x: 0.55 })],
      types,
      new Map(),
      headings,
    )
    expect(planned.decisions[0]?.type_code).not.toBe('10')
    expect(planned.decisions[0]?.verdict).toBe('HUMAN')
  })
})
