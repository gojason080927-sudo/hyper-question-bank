import { describe, expect, it } from 'vitest'
import { estimateRubricDifficulty } from './difficultyRubric'
import {
  CM2_DIFFICULTY_ENGINE,
  estimateCm2Difficulty,
  isolateQuestionStem,
} from './cm2DifficultyRubric'

const S = {
  lightDistanceDrill:
    '[0001~0005] 다음 두 점 사이의 거리를 구하시오. 0004 A(4), B(-6)',
  math2IntegerT:
    '0019 두 점 A(3, t), B(t, 7) 사이의 거리가 4 이하가 되도록 하는 정수 t의 개수를 구하시오.',
  motherSquareArea:
    '030 ★★★ 2019년 3월 23일 나형 23분(고2) 좌표평면 위의 두 점 $A(-1, 3)$, $B(4, 1)$ 에 대하여 선분 $AB$ 를 한 번으로 하는 정사각형의 넓이를 구하시오. (3점)',
  motherChainSquares:
    '038 ★★★ 2013년 9월학령 28번(고1) 그림과 같이 $x$축 위의 네 점 $A_1, A_2, A_3, A_4$에 대하여 $OA_1, \\overline{A_1A_2}, \\overline{A_2A_3}, \\overline{A_3A_4}$를 각각 한 변으로 하는 정사각형 $OA_1B_1C_1, A_1A_2B_2C_2, A_2A_3B_3C_3, A_3A_4B_4C_4$가 있다. 점 $B_4$의 좌표가 (30, 18)이고 정사각형 $OA_1B_1C_1, A_1A_2B_2C_2, A_2A_3B_3C_3$의 넓이의 비가 1 : 4 : 9일 때, $\\overline{B_1B_2}$의 값을 구하시오. (단, O는 원점이다.) (4점) ![img-8.jpeg](img-8.jpeg)',
  typelevelSquareSolved:
    '0024 좌표평면 위의 두 점 $A(-1, 3)$, $B(4, 1)$에 대하여 선분 $AB$를 한 번으로 하는 정사각형의 넓이를 구하시오. $29$ $$\\overline{AB} = \\sqrt{(4+1)^2 + (1-3)^2} = \\sqrt{29}$$ 따라서 정사각형의 넓이는 $$\\overline{AB}^2 = 29$$',
  lightCircleK:
    '0286 원 $x^2+y^2-4x+6y+k=0$이 $x$축에 접할 때, 상수 $k$의 값을 구하시오.',
  math2Tangent:
    '0248 원 (x+1)²+y²=4 위의 점 (0, √3)에서의 접선의 방정식을 구하시오.',
  motherTangentR:
    '091 ★★★ 2023년 9월학명 26번(고1) 좌표평면에서 원 $x^2+y^2=25$ 위의 점 (3, -4)에서의 접선이 원 $(x-6)^2+(y-8)^2=r^2$ 과 만나도록 하는 자연수 $r$ 의 최솟값을 구하시오. (4점)',
  typelevelCircleSolved:
    '0315 원 (x-2)²+y²=18과 직선 y=x+n이 만나지 않도록 하는 자연수 n의 최솟값은? ① 2 ② 3 ③ 4 ④ 5 ⑤ 6 원의 중심 (2, 0)과 직선 x-y+n=0 사이의 거리는 $$\\frac{|2+n|}{\\sqrt{2}}$$ 이므로 |n+2|>6 따라서 구하는 자연수 n의 최솟값은 5이다.',
  lightSetOps:
    '[0638~0641] 다음 두 집합 A, B에 대하여 A∩B를 구하시오. 0638 A={1, 2, 3, 4}, B={3, 4, 5}',
  wanjaComplement:
    '0520 전체집합 $U=\\{1, 2, 3, 4, 5\\}$의 부분집합 $A=\\{1, 3, 5\\}$에 대하여 집합 $A^c$의 모든 원소의 곱은? ① 2 ② 4 ③ 6 ④ 8 ⑤ 10 $A^c=U-A=\\{2, 4\\}$이므로 모든 원소의 곱은 $2 \\times 4 = 8$',
  gojaengSetIneq:
    '318 실수 전체의 집합 $R$ 의 두 부분집합 $$A = \\{x \\mid ax^2 + bx - 6 < 0\\}$$ $$B = \\{x \\mid x^2 + 3x - 18 \\leq 0\\}$$ 이 다음 조건을 만족시킬 때, $a + b$ 의 값을 구하시오. (단, $a, b$ 는 상수이다.) (가) $A \\cup B = R$ (나) $A \\cap B = \\{x \\mid -2 < x \\leq 3\\}$',
  motherUnionSum:
    '101 ★★★ 2016년 3월학령 나령 22번(고2) 두 집합 $A=\\{2, 4, 6\\}, B=\\{3, 6, 9\\}$에 대하여 집합 $A \\cup B$의 모든 원소의 합을 구하시오. (3점)',
  motherSetView:
    '154 ★★☆ 2009년 11월학명 13번(고1) 전체집합 U의 공집합이 아닌 두 부분집합 A, B에 대하여 A, Bᶜ이 서로소일 때, [보기]에서 항상 옳은 것만을 있는 대로 고른 것은? (3점) [보기] ㄱ. A - B = ∅ ㄴ. (A ∩ B)ᶜ = Aᶜ ㄷ. (Aᶜ ∪ B) ∩ A = A',
  lightSubsetDrill:
    '[0537~0540] 다음 집합의 부분집합을 모두 구하시오. 0537 {7}',
  motherNestedX:
    '167★★★ 2016년 9월학명 나령 25번(고2) 두 집합 $A = \\{1, 2, 3, 4, 5\\}, B = \\{1, 2\\}$에 대하여 $B \\subset X \\subset A$를 만족시키는 모든 집합 $X$의 개수를 구하시오. (3점)',
  lightGuidedProof:
    '0051 다음은 직사각형 ABCD와 임의의 점 P에 대하여 $\\overline{AP}^2 + \\overline{CP}^2 = \\overline{BP}^2 + \\overline{DP}^2$ 이 성립함을 설명한 것이다. 오른쪽 그림과 같이 직선 BC 를 x축, 직선 AB를 y축으로 하는 좌표평면을 잡으면 점 (가) 가 원점이다. 이때 직사각형 ABCD의 두 꼭짓점 A, C의 좌표를 각각 (0, b), (a, 0)이라 하면 꼭짓점 D의 좌표는 (나) 이므로',
  gojaengMovingPerimeter:
    '254 그림과 같이 직선 $y=x$ 위에 두 점 A, B가 $\\overline{AB}=2\\sqrt{2}$를 만족시키며 움직이고 있다. 두 점 C(1, -1), D(7, 1)에 대하여 사각형 ACDB의 둘레의 길이의 최솟값은?',
  gojaengFunctionGaNaDa:
    '525 집합 $X=\\{1, 2, 3, 4, 5, 6, 7, 8\\}$에 대하여 함수 $f:X\\to X$가 다음 조건을 만족시킨다. (가) 함수 $f$의 치역의 원소의 개수는 7이다. (나) $f(1)+f(2)+f(3)+f(4)+f(5)+f(6)+f(7)+f(8)=40$ (다) 함수 $f$의 최댓값은 8이다. $f(1)+f(8)$의 값을 구하시오.',
  gojaengApollonius:
    '159 두 양수 m, n과 좌표평면 위의 두 점 A(-4, 0), B(4, 0)에 대하여 $\\overline{PA}:\\overline{PB}=m:n$을 만족시키는 점 P가 나타내는 도형 C에 대한 설명으로 <보기>에서 옳은 것만을 있는 대로 고른 것은? <보기> ㄱ. 도형 C는 원이다.',
}

function oldLevel(stem: string): number {
  return estimateRubricDifficulty({
    stem,
    choice_count: 0,
    math_count: (stem.match(/\$/g) ?? []).length / 2,
    figure_hint: /그림|좌표|그래프/.test(stem),
    graph_hint: /그래프/.test(stem),
  }).difficulty_level
}

describe('cm2 absolute difficulty candidate', () => {
  it('keeps publisher stars/year/고난도 and surface 그림/단,/(가)(나) out of the score', () => {
    const base = estimateCm2Difficulty({ stem: S.lightDistanceDrill, type_id: 'DISTANCE_TWO_POINTS' })
    const decorated = estimateCm2Difficulty({
      stem: `${S.lightDistanceDrill} 고난도 ★★★ 그림과 같이 (가) (나) 단, O는 원점이다.`,
      type_id: 'DISTANCE_TWO_POINTS',
    })
    expect(base.overall_level).toBe(1)
    expect(decorated.overall_level).toBe(base.overall_level)
    expect(decorated.publisher_badge_used).toBe(false)
    expect(isolateQuestionStem(S.motherUnionSum)).not.toMatch(/★★|2016|학령/)
  })

  it('drops OCR solution tails so they cannot inflate calculation or reasoning', () => {
    const clean = estimateCm2Difficulty({ stem: S.motherSquareArea, type_id: 'DISTANCE_TWO_POINTS' })
    const dirty = estimateCm2Difficulty({ stem: S.typelevelSquareSolved, type_id: 'DISTANCE_TWO_POINTS' })
    expect(isolateQuestionStem(S.typelevelSquareSolved)).not.toMatch(/따라서|이므로/)
    expect(dirty.overall_level).toBe(clean.overall_level)
    const circleDirty = estimateCm2Difficulty({ stem: S.typelevelCircleSolved, type_id: 'CIRCLE_LINE' })
    expect(circleDirty.question_stem).not.toMatch(/이므로/)
    expect(circleDirty.overall_level).toBeLessThanOrEqual(3)
  })

  it('separates same-type intro / type-book / exam / hard items on one scale', () => {
    const light = estimateCm2Difficulty({ stem: S.lightDistanceDrill, type_id: 'DISTANCE_TWO_POINTS' })
    const ssen = estimateCm2Difficulty({ stem: S.math2IntegerT, type_id: 'DISTANCE_TWO_POINTS' })
    const examEasy = estimateCm2Difficulty({ stem: S.motherSquareArea, type_id: 'DISTANCE_TWO_POINTS' })
    const examHard = estimateCm2Difficulty({ stem: S.motherChainSquares, type_id: 'DISTANCE_TWO_POINTS' })
    expect(light.overall_level).toBe(1)
    expect(ssen.overall_level).toBeGreaterThanOrEqual(2)
    expect(ssen.overall_level).toBeLessThanOrEqual(3)
    expect(examEasy.overall_level).toBeLessThanOrEqual(2)
    expect(examHard.overall_level).toBeGreaterThanOrEqual(4)
    expect(examHard.overall_level).toBeGreaterThan(ssen.overall_level)
    expect(ssen.overall_level).toBeGreaterThan(light.overall_level)

    const setDrill = estimateCm2Difficulty({ stem: S.lightSetOps, type_id: 'SET_OPS' })
    const examUnion = estimateCm2Difficulty({ stem: S.motherUnionSum, type_id: 'SET_OPS' })
    const examView = estimateCm2Difficulty({ stem: S.motherSetView, type_id: 'SET_OPS' })
    const hardIneq = estimateCm2Difficulty({ stem: S.gojaengSetIneq, type_id: 'SET_OPS' })
    const wanja = estimateCm2Difficulty({ stem: S.wanjaComplement, type_id: 'SET_OPS' })
    expect(setDrill.overall_level).toBe(1)
    expect(examUnion.overall_level).toBe(1)
    expect(wanja.overall_level).toBe(1)
    expect(examView.overall_level).toBeGreaterThanOrEqual(3)
    expect(hardIneq.overall_level).toBeGreaterThanOrEqual(4)
    expect(hardIneq.overall_level).toBeLessThan(5)
    expect(hardIneq.overall_level).toBeGreaterThan(setDrill.overall_level)

    const nested = estimateCm2Difficulty({ stem: S.motherNestedX, type_id: 'SET_COUNT' })
    const subset = estimateCm2Difficulty({ stem: S.lightSubsetDrill, type_id: 'SET_COUNT' })
    expect(subset.overall_level).toBe(1)
    expect(nested.overall_level).toBeGreaterThanOrEqual(3)

    const tangent = estimateCm2Difficulty({ stem: S.math2Tangent, type_id: 'CIRCLE_LINE' })
    const k = estimateCm2Difficulty({ stem: S.lightCircleK, type_id: 'CIRCLE_LINE' })
    const examR = estimateCm2Difficulty({ stem: S.motherTangentR, type_id: 'CIRCLE_LINE' })
    expect(tangent.overall_level).toBe(1)
    expect(k.overall_level).toBeLessThanOrEqual(2)
    expect(examR.overall_level).toBeGreaterThanOrEqual(2)
    expect(examR.overall_level).toBeGreaterThan(tangent.overall_level)
  })

  it('keeps a guided 입문 proof at D1-D2 instead of the old surface D4', () => {
    const next = estimateCm2Difficulty({ stem: S.lightGuidedProof, type_id: 'DISTANCE_TWO_POINTS' })
    const prev = oldLevel(S.lightGuidedProof)
    expect(prev).toBeGreaterThanOrEqual(3)
    expect(next.overall_level).toBeLessThanOrEqual(2)
    expect(next.dim_levels.condition_complexity).toBeLessThanOrEqual(2)
    expect(next.engine).toBe(CM2_DIFFICULTY_ENGINE)
  })

  it('computes six distinct dims instead of cloning one integer', () => {
    const hard = estimateCm2Difficulty({ stem: S.gojaengSetIneq, type_id: 'SET_OPS' })
    const drill = estimateCm2Difficulty({ stem: S.lightSetOps, type_id: 'SET_OPS' })
    expect(hard.dim_levels.reasoning_depth).toBeGreaterThan(hard.dim_levels.representation_complexity)
    expect(hard.dim_levels.condition_complexity).toBeGreaterThan(drill.dim_levels.condition_complexity)
    expect(new Set(Object.values(hard.dim_levels)).size).toBeGreaterThan(1)
    expect(drill.dim_levels.representation_complexity).toBe(1)
  })

  it('puts stacked high-end items on D4/D5 without collapsing D1-D3', () => {
    const drill = estimateCm2Difficulty({ stem: S.lightDistanceDrill, type_id: 'DISTANCE_TWO_POINTS' })
    const ssen = estimateCm2Difficulty({ stem: S.math2IntegerT, type_id: 'DISTANCE_TWO_POINTS' })
    const nested = estimateCm2Difficulty({ stem: S.motherNestedX, type_id: 'SET_COUNT' })
    const chain = estimateCm2Difficulty({ stem: S.motherChainSquares, type_id: 'DISTANCE_TWO_POINTS' })
    const ineq = estimateCm2Difficulty({ stem: S.gojaengSetIneq, type_id: 'SET_OPS' })
    const moving = estimateCm2Difficulty({ stem: S.gojaengMovingPerimeter, type_id: 'REFLECTION' })
    const stacked = estimateCm2Difficulty({ stem: S.gojaengFunctionGaNaDa, type_id: 'FUNCTION_BASIC' })
    const apollonius = estimateCm2Difficulty({ stem: S.gojaengApollonius, type_id: 'DISTANCE_TWO_POINTS' })
    expect(drill.overall_level).toBe(1)
    expect(ssen.overall_level).toBe(2)
    expect(nested.overall_level).toBe(3)
    expect(chain.overall_level).toBe(4)
    expect(ineq.overall_level).toBe(4)
    expect(moving.overall_level).toBeGreaterThanOrEqual(4)
    expect(apollonius.overall_level).toBeGreaterThanOrEqual(4)
    expect(stacked.overall_level).toBe(5)
    expect(stacked.overall_score).toBeGreaterThan(chain.overall_score)
    expect(chain.overall_score).toBeGreaterThan(nested.overall_score)
  })
})
