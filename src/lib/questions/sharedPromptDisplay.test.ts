import { describe, expect, it } from 'vitest'
import { splitSharedRangePrompt, worksheetItemHasSharedCondition } from './sharedPromptDisplay'

describe('shared prompt display split', () => {
  it('keeps a lone stem without a range header', () => {
    expect(splitSharedRangePrompt('$x$에 대한 내림차순')).toEqual({
      shared: null,
      body: '$x$에 대한 내림차순',
    })
  })

  it('splits a composed range stem so the problem number is not repeated in the body', () => {
    const stem =
      '[0003~0004] 다항식 $2x^2+3xy-y^2+x-10y+1$을 다음과 같이 정리하시오.\n$x$에 대한 내림차순'
    const parts = splitSharedRangePrompt(stem)
    expect(parts.shared).toBe('[0003~0004] 다항식 $2x^2+3xy-y^2+x-10y+1$을 다음과 같이 정리하시오.')
    expect(parts.body).toBe('$x$에 대한 내림차순')
    expect(parts.body).not.toContain('0003.')
    expect(worksheetItemHasSharedCondition(stem)).toBe(true)
  })

  it('does not treat math brackets as a shared prompt', () => {
    expect(splitSharedRangePrompt('구간 $[0,1]$의 길이')).toEqual({
      shared: null,
      body: '구간 $[0,1]$의 길이',
    })
  })
})
