/**
 * Candidate HYPER absolute difficulty for 공통수학2.
 * Not wired into classify:book / Production persist.
 *
 * Scores the mathematical solving load of the question stem only.
 * Publisher 상·중·하 / ★ / 고난도 / 연도 are evidence, never inputs.
 * 그림 / 단, / (가)(나) raise a dim only when they actually constrain the solution.
 */
import type { DifficultyDims } from '../workflow/difficulty'

export const CM2_DIFFICULTY_ENGINE = 'cm2-absolute-v1'
export const CM2_DIFFICULTY_CUTS = [0.2, 0.32, 0.42, 0.54] as const
export const CM2_DIM_CUTS = [0.22, 0.38, 0.54, 0.7] as const
export const CM2_DIFFICULTY_WEIGHTS = {
  concept_difficulty: 0.22,
  reasoning_depth: 0.22,
  condition_complexity: 0.18,
  calculation_complexity: 0.16,
  representation_complexity: 0.12,
  trap_level: 0.1,
} as const

export type Cm2DifficultyInput = {
  stem: string
  type_id?: string | null
}

export type Cm2DifficultyEstimate = {
  engine: typeof CM2_DIFFICULTY_ENGINE
  question_stem: string
  overall_score: number
  overall_level: 1 | 2 | 3 | 4 | 5
  dims: DifficultyDims
  dim_levels: Record<keyof DifficultyDims, 1 | 2 | 3 | 4 | 5>
  families: string[]
  extra_families: string[]
  publisher_badge_used: false
  notes: string[]
}

const TYPE_HOME: Record<string, string[]> = {
  DISTANCE_TWO_POINTS: ['distance'],
  SEGMENT_DIVISION: ['division'],
  LINE_EQUATION: ['line'],
  LINE_PARALLEL_PERP: ['line', 'line_pos'],
  POINT_LINE_DISTANCE: ['line_pos'],
  CIRCLE_EQUATION: ['circle'],
  CIRCLE_LINE: ['circle', 'circle_line'],
  TRANSLATION: ['move'],
  REFLECTION: ['move'],
  SET_BASIC: ['set_basic'],
  SET_OPS: ['set_ops'],
  SET_COUNT: ['set_count'],
  PROPOSITION_LOGIC: ['logic'],
  PROPOSITION_CONDITION: ['condition'],
  FUNCTION_BASIC: ['function'],
  COMPOSITE_INVERSE: ['function'],
  RATIONAL_FN: ['rational'],
  IRRATIONAL_FN: ['rational'],
}

const FAMILIES: Array<{ id: string; re: RegExp }> = [
  { id: 'distance', re: /두\s*점|사이의\s*거리|같은\s*거리|선분\s*[A-Z]{1,2}의\s*길이/ },
  { id: 'division', re: /내분|외분|중점/ },
  { id: 'line', re: /기울기|절편|직선의\s*방정식|x축에\s*평행|y축에\s*평행/ },
  { id: 'line_pos', re: /두\s*직선.{0,16}(평행|수직|일치)|점과\s*직선\s*사이/ },
  { id: 'circle', re: /원의\s*방정식|반지름|중심이|원\s*[A-ZCc]|원\s*\$|원\s+[xy$]/ },
  { id: 'circle_line', re: /접선|원과\s*직선|접할|서로\s*다른\s*두\s*점/ },
  { id: 'move', re: /평행이동|대칭이동/ },
  { id: 'set_basic', re: /원소나열|조건제시|포함\s*관계/ },
  { id: 'set_ops', re: /합집합|교집합|여집합|차집합|서로소|∪|∩|\^c|\^C|\\cup|\\cap|\\setminus/ },
  { id: 'set_count', re: /원소의\s*개수|부분집합의\s*개수|진부분집합|n\s*\(|집합\s*\$?[A-ZXY]\$?의\s*개수/ },
  { id: 'logic', re: /명제|대우|삼단논법|참인|거짓/ },
  { id: 'condition', re: /충분조건|필요조건|필요충분/ },
  { id: 'function', re: /정의역|치역|대응|합성함수|역함수|함수값/ },
  { id: 'rational', re: /유리함수|점근선|무리함수/ },
  { id: 'extrema', re: /최댓값|최솟값|최대|최소/ },
  { id: 'count_int', re: /정수.{0,12}개수|개수를\s*구|자연수.{0,12}개/ },
  { id: 'ineq', re: /이하|이상|초과|미만|부등식|[<>≤≥]/ },
  { id: 'area', re: /넓이|정사각형|삼각형|무게중심/ },
  { id: 'construction', re: /각각\s*한\s*[변번]으로|정사각형\s*\$?[A-Z]_1|네\s*점/ },
]

const SOLUTION_START =
  /(?:이므로|양변을|따라서|그러므로|위의\s*식|정답\s*:|∴|원의\s*중심\s*\(|집합\s*[A-Z]의\s*부분집합\s*중에서|P\s*\(\s*[a-z]\s*,\s*0\s*\)\s*이라\s*하면)/
const ASK =
  /구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)|값은\?|것은\?|개수는\?|넓이는\?|거리는\?|좌표는\?|합은\?|곱은\?|말하시오|써넣으시오/
const GUIDED = /설명한\s*것이다|빈칸|boxed|□\s*안에/
const TRIVIAL_DAN =
  /단,\s*(?:O는|원점|[a-zA-Z]\s*는\s*(?:상수|실수|양수)|[pq],\s*[pq]는\s*서로소|[A-Z]\s*\\neq|U\s*\\neq)/

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function mapScoreToLevel(score: number, cuts: readonly number[] = CM2_DIFFICULTY_CUTS): 1 | 2 | 3 | 4 | 5 {
  if (score < cuts[0]) return 1
  if (score < cuts[1]) return 2
  if (score < cuts[2]) return 3
  if (score < cuts[3]) return 4
  return 5
}

export function isolateQuestionStem(raw: string): string {
  let text = raw.replace(/This Document has been modified[\s\S]*?(?:flexcil[^\n]*|PDF[^\n]*)/gi, ' ')
  text = text.replace(/정답과\s*해설[\s\S]*$/g, ' ')
  text = text.replace(/Flexcil[\s\S]*$/g, ' ')
  text = text.replace(/[★☆✦✧*＊]+/g, ' ')
  text = text.replace(/(?:19|20)\d{2}\s*(?:년|학년도)/g, ' ')
  text = text.replace(/\d{1,2}월(?:학평|학령|학명|모평)?/g, ' ')
  text = text.replace(/고난도|실력\s*UP|기본\s*다잡기|난이도\s*[ABC가나다상중하1-5]|대표\s*(?:문제|형태|초점|문자)/g, ' ')
  text = text.replace(/\b(?:학평|학령|학명|수능|모평)\b/g, ' ')
  text = text.replace(/\(\s*고\s*[12]\s*\)/g, ' ')
  text = text.replace(/\d{1,3}번(?=\s|\()/g, ' ')
  text = text.replace(/원본문자|원출판|점포문제|실종의|실용어|대조\s*\d|다른\s*표제|선행\s*\d+/g, ' ')
  text = text.replace(/\s+#\s+\d{3,4}\b[\s\S]*$/, ' ')
  if (!GUIDED.test(text)) {
    const ask = ASK.exec(text)
    if (ask && ask.index != null) {
      const after = text.slice(ask.index + ask[0].length)
      const sol = SOLUTION_START.exec(after)
      if (sol && sol.index != null && sol.index < 120) {
        text = text.slice(0, ask.index + ask[0].length)
      } else {
        const choiceEnd = /⑤[^\n①-⑤]{0,48}/.exec(after)
        if (choiceEnd && choiceEnd.index != null) {
          const rest = after.slice(choiceEnd.index + choiceEnd[0].length)
          if (SOLUTION_START.test(rest) || /\$\$/.test(rest) || rest.replace(/\s+/g, '').length > 60) {
            text = text.slice(0, ask.index + ask[0].length) + after.slice(0, choiceEnd.index + choiceEnd[0].length)
          }
        }
      }
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

function familiesOf(stem: string): string[] {
  return FAMILIES.filter((row) => row.re.test(stem)).map((row) => row.id)
}

function extras(typeId: string | null | undefined, found: string[]): string[] {
  const home = new Set(TYPE_HOME[typeId ?? ''] ?? [])
  const extraIds = ['extrema', 'count_int', 'ineq', 'area', 'construction']
  if (!home.size) return found.filter((id) => extraIds.includes(id) || found.length > 1)
  return found.filter((id) => !home.has(id))
}

function paramCount(stem: string): number {
  const hits = stem.match(/(?:양수|정수|자연수|실수|상수|모든)\s*[a-zA-Z]|[a-zA-Z]\s*의\s*(?:값|개수|최댓값|최솟값)/g) ?? []
  return new Set(hits.map((hit) => hit.replace(/[^a-zA-Z]/g, '').toLowerCase())).size
}

function conceptScore(found: string[], extra: string[]): number {
  if (!found.length && !extra.length) return 0.12
  if (!extra.length) return 0.16
  const cross = extra.filter((id) => ['ineq', 'extrema', 'count_int', 'area', 'function', 'circle'].includes(id)).length
  return clamp01(0.18 + 0.16 * extra.length + (cross >= 2 ? 0.12 : 0))
}

function hasGaNa(stem: string): boolean {
  return /\(\s*가\s*\)[\s\S]{0,240}\(\s*나\s*\)/.test(stem)
}

function reasoningScore(stem: string): number {
  if (GUIDED.test(stem)) return 0.2
  let score = 0.12
  if (/일\s*때/.test(stem) && /값|개수|좌표|상수/.test(stem)) score += 0.16
  if (/만족시/.test(stem)) score += 0.26
  if (/보기.?\s*에서|ㄱ\s*\.|옳은\s*것만을\s*있는\s*대로/.test(stem) && /항상|서로소|조건|명제|만족시/.test(stem)) score += 0.32
  else if (/보기.?\s*에서|ㄱ\s*\.|옳은\s*것만을\s*있는\s*대로/.test(stem)) score += 0.1
  if (/최댓값|최솟값/.test(stem) && /거리|접선|원|집합|√|sqrt|선분|길이|넓이/.test(stem)) score += 0.2
  if (/증명하(?:시\s*오|십시오)/.test(stem)) score += 0.22
  if (/한\s*[변번]으로\s*하는\s*정사각형/.test(stem) && /각각|네\s*점|세\s*점|A_1|넓이의\s*비/.test(stem)) score += 0.42
  else if (/한\s*[변번]으로\s*하는\s*정사각형/.test(stem)) score += 0.12
  if (hasGaNa(stem) && /만족|부등식|[<>≤≥]/.test(stem)) score += 0.28
  if (hasGaNa(stem) && /\(\s*다\s*\)/.test(stem)) score += 0.12
  if (/(?:[⊂⊃]|\\subset)\s*X\s*(?:[⊂⊃]|\\subset)/.test(stem) && /만족/.test(stem)) score += 0.2
  if (/자취의\s*방정식|같은\s*거리에\s*있는|나타내는\s*도형/.test(stem)) score += 0.16
  if (/접선이\s*이루는\s*각|이등분하는\s*직선/.test(stem)) score += 0.2
  if (/접선/.test(stem) && /원/.test(stem) && /최솟값|만나/.test(stem) && /자연수|정수/.test(stem)) score += 0.16
  if (!hasGaNa(stem) && /움직이/.test(stem) && /최솟값|최댓값|둘레/.test(stem)) score += 0.18
  if (!hasGaNa(stem) && /\\angle|각\s*[A-Z]{2,3}/.test(stem) && /만족시/.test(stem)) score += 0.16
  if (/되도록\s*하는\s*(?:정수|자연수|양수|실수).{0,12}개수/.test(stem)) score += 0.12
  return clamp01(score)
}

function conditionScore(stem: string): number {
  let score = 0.08
  const trivialDan = (stem.match(new RegExp(TRIVIAL_DAN.source, 'g')) ?? []).length
  const dan = (stem.match(/단,/g) ?? []).length - trivialDan
  if (dan > 0 && /제\d사분면|서로\s*다른\s*(?:두\s*)?점|접하|만나지|양의\s*정수/.test(stem)) score += 0.22
  const when = (stem.match(/일\s*때/g) ?? []).length
  if (when >= 2) score += 0.24
  else if (when === 1 && /개수|상수|값/.test(stem)) score += 0.14
  if (/보기.?\s*에서\s*(?:항상\s*)?옳은\s*것만을\s*있는\s*대로/.test(stem)) score += 0.28
  if (/(?:[⊂⊃]|\\subset)\s*X\s*(?:[⊂⊃]|\\subset)|X\s*(?:∪|∩|-|\\cup|\\cap)/.test(stem) && /만족/.test(stem)) score += 0.32
  if (hasGaNa(stem) && /만족|조건|부등식/.test(stem)) score += 0.3
  if (hasGaNa(stem) && /\(\s*다\s*\)/.test(stem)) score += 0.12
  if (/넓이의\s*비/.test(stem) && /각각/.test(stem)) score += 0.28
  return clamp01(score)
}

function calculationScore(stem: string): number {
  let score = 0.12
  const params = paramCount(stem)
  if (params >= 2) score += 0.16
  else if (params === 1) score += 0.08
  if (/\^\s*2|제곱|√|sqrt/.test(stem) && /거리|방정식|원|선분/.test(stem)) score += 0.1
  if (/이하|이상|부등식|[<>≤≥]/.test(stem) && /정수|자연수|실수|개수/.test(stem)) score += 0.14
  if (/두\s*원|교점|연립/.test(stem)) score += 0.18
  if (/정수.{0,12}개수|자연수.{0,12}개수/.test(stem)) score += 0.12
  const latex = (stem.match(/\$.+?\$/g) ?? []).length
  score += Math.min(0.1, latex * 0.02)
  return clamp01(score)
}

function representationScore(stem: string): number {
  if (GUIDED.test(stem) && /좌표평면을\s*잡으면/.test(stem)) return 0.28
  let score = 0.1
  if (/좌표평면을\s*잡으면|원점을.{0,12}으로|x축.{0,20}y축으로/.test(stem)) score += 0.3
  if (/벤\s*다이어그램으로\s*나타내면/.test(stem)) score += 0.22
  if (/그래프의\s*개형|평행이동한\s*(?:원|그래프|도형)/.test(stem)) score += 0.28
  if (/시속|km|도로/.test(stem)) score += 0.26
  return clamp01(score)
}

function trapScore(stem: string): number {
  let score = 0.08
  if (/옳지\s*않은/.test(stem) && /항상|명제|보기|여집합|부분집합/.test(stem)) score += 0.2
  if (/항상\s*(?:옳은|같은|성립)/.test(stem)) score += 0.24
  if (/서로소인\s*(?:집합|두\s*집합).{0,16}개수/.test(stem)) score += 0.16
  if (/(?:정수|자연수).{0,12}개수/.test(stem) && /이하|이상|서로\s*다른/.test(stem)) score += 0.16
  return clamp01(score)
}

export function estimateCm2Difficulty(input: Cm2DifficultyInput): Cm2DifficultyEstimate {
  const question_stem = isolateQuestionStem(input.stem)
  const families = familiesOf(question_stem)
  const extra_families = extras(input.type_id, families)
  const dims: DifficultyDims = {
    concept_difficulty: conceptScore(families, extra_families),
    calculation_complexity: calculationScore(question_stem),
    reasoning_depth: reasoningScore(question_stem),
    condition_complexity: conditionScore(question_stem),
    representation_complexity: representationScore(question_stem),
    trap_level: trapScore(question_stem),
  }
  const weighted = clamp01(
    CM2_DIFFICULTY_WEIGHTS.concept_difficulty * dims.concept_difficulty +
      CM2_DIFFICULTY_WEIGHTS.reasoning_depth * dims.reasoning_depth +
      CM2_DIFFICULTY_WEIGHTS.condition_complexity * dims.condition_complexity +
      CM2_DIFFICULTY_WEIGHTS.calculation_complexity * dims.calculation_complexity +
      CM2_DIFFICULTY_WEIGHTS.representation_complexity * dims.representation_complexity +
      CM2_DIFFICULTY_WEIGHTS.trap_level * dims.trap_level,
  )
  const logicPeak = Math.max(dims.reasoning_depth, dims.condition_complexity)
  const overall_score = clamp01(0.65 * weighted + 0.35 * logicPeak)
  const dim_levels = {
    concept_difficulty: mapScoreToLevel(dims.concept_difficulty, CM2_DIM_CUTS),
    calculation_complexity: mapScoreToLevel(dims.calculation_complexity, CM2_DIM_CUTS),
    reasoning_depth: mapScoreToLevel(dims.reasoning_depth, CM2_DIM_CUTS),
    condition_complexity: mapScoreToLevel(dims.condition_complexity, CM2_DIM_CUTS),
    representation_complexity: mapScoreToLevel(dims.representation_complexity, CM2_DIM_CUTS),
    trap_level: mapScoreToLevel(dims.trap_level, CM2_DIM_CUTS),
  }
  return {
    engine: CM2_DIFFICULTY_ENGINE,
    question_stem,
    overall_score: Number(overall_score.toFixed(3)),
    overall_level: mapScoreToLevel(overall_score),
    dims,
    dim_levels,
    families,
    extra_families,
    publisher_badge_used: false,
    notes: [`families=${families.join(',') || 'none'}`, `extra=${extra_families.join(',') || 'none'}`],
  }
}
