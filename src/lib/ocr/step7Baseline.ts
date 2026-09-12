export const STEP7_DOCUMENT_ID = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const STEP7_SAMPLE_COUNT = 26
export const STEP7_PAGES = [8, 12, 20, 36, 60, 96, 132, 156] as const
export const STEP7_GROUND_TRUTH_VERSION = 'bfd939311e7d5a6a8f627bc6fb9adaeb28443ae7b3d60898de5c7942acb70fae'
/** SHA256 of workers/ocr/ground-truth.json bytes. Not the STEP 7 crop-set label above. */
export const STEP7_GT_JSON_SHA256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

/** Frozen STEP 7 Windows OCR scoreboard. Do not recompute on a different corpus. */
export const STEP7_WINDOWS_OCR_BASELINE = {
  engine: 'windows-media-ocr-ko',
  version: 'winrt-3.2.1',
  GREEN: 8,
  YELLOW: 8,
  RED: 10,
  math_critical_errors: 23,
  sec_per_crop: 0.253,
  korean: 0.917,
  digits: 0.91,
  operators: 0.759,
  superscripts: 0.0,
  subscripts: 0.0,
  fractions: 0.0,
  radicals: 0.0,
  inequalities: 0.5,
  parens_abs: 0.378,
  choices: 0.0,
  problem_number: 0.955,
  figure_table: 0.714,
} as const

export const STEP7_KNOWN_FAILURES = [
  'x² -> x2',
  '√ lost',
  'fraction structure lost',
  '≤ -> <',
  '|b+c| -> lb+cl',
  '+ -> 十',
  'x -> 교',
  '①–⑤ lost',
] as const
