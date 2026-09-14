# STEP 8.40 review-minimize audit

- start REVIEW_REQUIRED: 128
- unique pages: 61
- PASS_FALSE_POSITIVE 61 · AUTO_SAFE 0 · REVIEW 67 · BLOCKED 0 · PAID 0
- human remaining 67 (47.7% cleared)
- applies: 0
- paid OCR calls: 0

## P1

| number | page | verdict | reason |
|---|---|---|---|
| 0333 | 50 | REVIEW_REQUIRED | 동일 스텁 본문. 원본 페이지에는 선택지가 있으나 숫자를 추측해 채우지 않는다 |
| 0381 | 56 | REVIEW_REQUIRED | 동일 스텁 본문. 원본 페이지에는 선택지가 있으나 숫자를 추측해 채우지 않는다 |
| 0284 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |
| 0297 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |
| 0279 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |
| 0282 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |
| 0296 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |
| 0331 | 50 | REVIEW_REQUIRED | 동일 스텁 본문. 원본 페이지에는 선택지가 있으나 숫자를 추측해 채우지 않는다 |
| 0283 | 47 | PASS_FALSE_POSITIVE | 원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다 |

## Decisions

| number | page | 8.39 | 8.40 | rules |
|---|---|---|---|---|
| 0581 | 85 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0572 | 85 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0951 | 137 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0982 | 141 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 1023 | 147 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 1035 | 151 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0274 | 44 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0333 | 50 | DUPLICATE_BODY | REVIEW_REQUIRED | duplicate_body_stub |
| 0381 | 56 | DUPLICATE_BODY | REVIEW_REQUIRED | duplicate_body_stub |
| 0284 | 47 | TOO_SHORT | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0297 | 47 | TOO_SHORT | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0003 | 9 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0015 | 9 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0005 | 9 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0008 | 9 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0020 | 9 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0036 | 11 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0027 | 11 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0038 | 11 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0029 | 11 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0116 | 25 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0122 | 25 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0140 | 27 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0279 | 47 | TOO_SHORT | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0315 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0282 | 47 | TOO_SHORT | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0296 | 47 | TOO_SHORT | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0298 | 47 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0305 | 49 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0307 | 49 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0331 | 50 | DUPLICATE_BODY | REVIEW_REQUIRED | duplicate_body_stub |
| 0411 | 63 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0415 | 63 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0424 | 63 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0429 | 65 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0440 | 65 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0561 | 83 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0564 | 83 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0554 | 83 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0662 | 99 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0667 | 99 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0684 | 101 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0795 | 117 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0807 | 119 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0801 | 119 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1033 | 151 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1049 | 151 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1051 | 151 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1064 | 153 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1214 | 175 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0319 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 0321 | 49 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0323 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 0325 | 49 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0327 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 0308 | 49 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0309 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0329 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0395 | 59 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0463 | 69 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0480 | 71 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0495 | 73 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0597 | 87 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0601 | 88 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0507 | 75 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0094 | 19 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0108 | 21 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0110 | 22 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0124 | 25 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0125 | 25 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0127 | 25 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0129 | 25 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0130 | 25 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0132 | 25 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0781 | 117 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 0265 | 42 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0551 | 83 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 0590 | 86 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0648 | 95 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0737 | 108 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0735 | 108 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0783 | 117 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0754 | 111 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0774 | 114 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0775 | 114 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0825 | 121 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0856 | 125 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0882 | 129 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0880 | 129 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0886 | 131 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 0924 | 134 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0925 | 134 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0931 | 135 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 0935 | 135 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0945 | 136 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0997 | 143 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 0968 | 139 | HEADER_NOISE | REVIEW_REQUIRED | needs_human |
| 1009 | 145 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 1014 | 146 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 1040 | 151 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1042 | 151 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 1044 | 151 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 1046 | 151 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 1056 | 153 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1058 | 153 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 1060 | 153 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 1095 | 156 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1098 | 157 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1057 | 153 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 1059 | 153 | RANGE_LEAK | REVIEW_REQUIRED | range_leak_unique_copy |
| 1054 | 153 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 1157 | 165 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 1159 | 165 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 1162 | 166 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1165 | 166 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1167 | 167 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1168 | 167 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1179 | 168 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1181 | 169 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1186 | 170 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1190 | 171 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | next_leak_false_detect |
| 1197 | 172 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 1200 | 175 | NEXT_NUMBER_LEAK | PASS_FALSE_POSITIVE | own_range_token_false_positive |
| 1202 | 175 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_missing_listed |
| 0313 | 49 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | own_range_glued_siblings |
| 1300 | 189 | NEXT_NUMBER_LEAK | REVIEW_REQUIRED | next_leak_unequal |
| 0283 | 47 | LEADING_NUMBER_DUP | PASS_FALSE_POSITIVE | too_short_math_atom |
| 0285 | 47 | OWN_RANGE_HEADER | PASS_FALSE_POSITIVE | own_range_token_false_positive |
