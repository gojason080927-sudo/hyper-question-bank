import type { FeatureArea } from '../types'

export const FEATURE_AREAS: FeatureArea[] = [
  {
    id: 'sources',
    code: '01',
    title: '원본 자료 관리',
    summary: 'PDF / HWP / HWPX / 스캔 시험지 원본',
  },
  {
    id: 'extraction',
    code: '02',
    title: '문제 추출',
    summary: '문제 단위 분리 · 본문/수식/도형 인식',
  },
  {
    id: 'questions',
    code: '03',
    title: '문제 데이터베이스',
    summary: '구조화된 문제 저장',
  },
  {
    id: 'classification',
    code: '04',
    title: '유형·난이도 분류',
    summary: '단원 / 유형 / 난이도 / 풀이전략',
  },
  {
    id: 'similarity',
    code: '05',
    title: '쌍둥이 문제 검색',
    summary: '유사문제 · 쌍둥이 문제 검색',
  },
  {
    id: 'worksheets',
    code: '06',
    title: 'HYPER 문제지 생성',
    summary: 'HYPER 형식 시험지 · PDF 출력',
  },
  {
    id: 'exams',
    code: '07',
    title: '학교 시험 분석',
    summary: '스캔 시험지 복원 · 오답 분석',
  },
  {
    id: 'review',
    code: '08',
    title: '강사 검수',
    summary: '추출/분류 결과 사람 검수',
  },
]
