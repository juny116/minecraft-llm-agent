# 검증 현황

기준일: 2026-10-23. 기능 구현과 자율 플레이 성과를 구분합니다.

| 범위 | 확인한 내용 | 한계 |
|---|---|---|
| 모의검증 | 타입 검사·594개 테스트 통과, 실제 요청1,034개의 무손실 재인코딩 복원 일치 | 모델 판단 품질을 보장하지 않음 |
| 개별 동작 | Java 1.21.1에서 이동·채굴·획득·설치·제작·보관·식사·장비·근접 전투 | 준비된 상태의 짧은 검증 |
| 제어·기억 | 계획·대화 병렬 처리, 별명 응답, 재접속 복원, 리스폰·근거리 회수 | 위험 지역 회수·장기 기억 효과 미검증 |
| 관측 | 자동 주변 관찰, 벽 뒤 정보 차단, 직접 본 뒤 돌아왔을 때 과거 관측 복원 | 기하학적 감지이며 화면의 투명 텍스처와 다름 |
| 자율 플레이 | 자발적인 이동·설치·보관과 일부 짧은 실행의 채굴 확인 | 안정적인 장기 생존·생산적인 협동 미검증 |

## v2.5 절차 검증

`procedural`은 LLM 절차·JEV 상황 대응·로컬 대상 연결/재료 계산을 분리하고 기존 `direct`를 보존합니다. 행동별 실제 인자 범위와 범위 밖 자원, 철회 당시 후보를 함께 전달합니다. 명확한 사용자 요청의 초기 중기계획은 장기 검토와 병렬로 시작하며 오래된 응답 적용을 검사합니다.

같은 저장 입력6회 비교에서 인자 철회는 기존5회→범위 정보 추가3회였고, 철회 피드백까지 추가해도3회였습니다. 별도 공격 중단 입력6회 재생에서는 현재 대상 ID를 관측된 동물 정보와 연결한 뒤 `stop`이5회→0회였지만 실제 서버에서는 중단 반복이 남았습니다. 작은 표본의 판단 변화이며 안정성 증거가 아닙니다.

Normal/Survival에서 양·원목·기존 제작대와 장비를 준비하고 침대1개 목표만 제공했습니다. 잘못된 동물 수집 절차를 진단한44초 실행 후 초기 상태를 재설정했습니다. 다음180초에는 양털2·판자4를 얻었지만 침대는 만들지 못했습니다. 대상 정보 연결을 수정하고 같은 월드·소지품에서 별도53초 실행을 이어 양털1개를 추가 확보하고 침대1개를 만들었습니다. 서버 저장 기록과 일치합니다. 두 실행의 공백은79.0%/71.5%였으며, 마지막 실행에도 공격12회 취소·여분 제작대 제작이 남았습니다.

후속 서버 없는 분석에서 완료 절차의 현재 역할 혼동, 전투 타이밍 누락, 늦은 계획의 기준 시각을 보완했습니다. 같은 중단12장면을 각2회 재생한 최종 비교는 `stop`23/24→12/24회였습니다. 공격 선택12회 중11회는 기존 대상에 결합했고1회는 철회했습니다. 일부 설명 확장은 오히려 중단을 늘려 채택하지 않았습니다. 완료 판자·양털 획득 입력은 기존/수정 LLM 모두 남은 일을 구분했고, 실제 최종 관측으로 구성한 별도 입력에서는 둘 다 침대 완료를 판정했습니다. 작은 저장 입력 비교이며 실제 공백·전투 성공률 개선이나 장기 목표 갱신의 증거는 아닙니다.

후속45초 서버 검증은180초 종료 상태(양털2·판자4·원목1)를 복원했습니다. 전투 판단15/15회에 진행정보가 전달됐고, 양털1개를 추가 획득해24.7초에 침대를 제작했습니다. 제작 전 `stop`12→1회·공백71.5→51.3%였지만 양 위치와 모델 응답이 다른 단일 비교입니다. 중기·장기 완료 반영을 확인했으나 이후 장비 변경·공격이 이어졌습니다. 전체45초 공백53.5%, 비용0.092USD, API/계획 오류0건입니다.

양털 지급 조건의 이전 침대 성공과 구분합니다. 이번 결과는 연속 실행·통제된 성능 비교·야생 생존 검증이 아닙니다. 준비된 자원에서 획득→제작을 확인했으며 설치·집 건설·협동은 미검증입니다. [조건·한계·다음 과제](PROCEDURES.md)

## 목표층 연속성·채팅 요청 검증

10/21 침대 실행의 완료 시점 장기 검토를 같은 입력으로 재생하면 기존 지시는3/3 활성 목표 없음이었고, 새 지시는3/3 완료 처리와 새 탐색 목표를 반환했습니다. 완료 이후 행동층 판단11장면×2회에서 공격 선택은17→0회, 평균 공격 확률은0.44→0.05였습니다. 저장 입력 재생이며 실제 실행이 아닙니다.

`/goal` 없이 대본 플레이어가 게임 채팅으로 침대를 부탁한180초 서버 검증에서 목표층이6.6초 뒤 수락해 목표를 바꿨고, 대화는 결정과 일치하게 답했습니다. 양털을 얻어 기존 제작대에서 침대를 만들고 전달했으며, 서버 기록에서 상대가 1초 뒤 주운 것을 확인했습니다. 다만 처음72초 동안 이동이 없었고(이동·공격 인자 철회 반복), 이미 충분한 판자와 제작대를 다시 만들었으며 무실행 비율은90.2%였습니다. 전달 후에는 수령을 확인하지 못해 "근처에 떨어져 있다"고 잘못 말했습니다. 행동층 입력은 최대30.8k 토큰으로 기본 한도32k에 가까웠습니다. 단일 실행이며 협동 성능의 증거가 아닙니다.

같은 조건의 후속 검증에서 원인을 확인했습니다. 이동 목적지 후보 220개가 모두 같은 설명이라 확률이 칸마다 약0.03으로 흩어졌고, 단일 최댓값 선택에서는 철회가 항상 이겼습니다(저장 응답 107/107). 이동 선택지를 알려진 대상(관측 블록 종류별 가장 가까운 칸, 기억 장소, 보이는 개체, 계획·채팅 좌표, 범위 끝 방향, 정확한 좌표 목록)으로 바꾸고 선택한 대상까지 직접 이동하게 했습니다. 이후180초 검증에서 요청8초 → 수락13.6초 → 양 처치·양털 획득 → 침대 제작44.3초 → 전달49.7초였고, 서버 기록에서 상대가 2초 뒤 침대를 주웠습니다. 상대의 "받았어"에 대해 봇은 직접 수령을 확인하지 못했다고 구분해 답했습니다. 목적지 질문에서 모델이 직접 고른 비율은1/33에서14/28로 늘었습니다. 남은 문제는 제작물 선택 철회57회, 반복된 감사 응답, 행동층 입력 최대31.8k 토큰입니다. 단일 실행 결과입니다.

## 최근 관측·입력 검증

실제 서버 위치에서 만든 1인칭 렌더링과 관측을 대조했습니다. 네이티브 게임 클라이언트 화면은 아닙니다. 나뭇잎을 정면으로 바라본 기존 관측은2셀, 같은 위치의 자동 주변 관측은295셀이었습니다. 별도 벽 실험에서는 가려진 블록이 현재 관측에 없고, 뒤로 이동해 본 뒤 돌아오면 과거 기억에만 남았습니다.

이전 방식은 가까운8블록 최대256셀과48블록 이내 최대24구역 요약을 사용했습니다. 현재는 가까운12블록 관측 셀을 잘라내지 않고 정확한 영역으로 압축합니다. 모의검증에서 먼 지형2만셀을 추가해도 현재 지도 입력은 동일했습니다. 청크 저장·재접속·이전 형식 이관도 검사했습니다.

첫 서버 실행에서 JEV의 `max_tokens_exceeded`를 확인했습니다. 지도뿐 아니라 실행 결과의 지형 증거가 중복 전달된 것이 원인이었습니다. 공통 객체·문장 참조와 좌표·시각 차이값으로 정보를 보존해 압축한 뒤, 거절됐던 요청의 API 재생이 성공했습니다.

수정 후 두 봇90초 검증은 정상 종료했고 API 오류는0건이었습니다. 서버에서 이동과19블록 설치, 상자 보관을 확인했지만 채굴·전달·대화는0건이었습니다. 설치 완료 기록은16건으로 서버 변경과 차이가 있어, 취소된 동작의 실제 부수 효과를 구분하는 후속 확인이 필요합니다. 보관한 물건을 꺼내 다시 넣는 반복도3회 있었습니다. 액션 실행 구간 밖 시간은 Alice73.4%, Bob71.6%로, 공백 개선은 입증하지 못했습니다. 장기 목표 입력의 지도 누락은 이후 수정하고 모의검증했으며 이90초 실행에는 포함되지 않았습니다.

## 설치 진행·인자 묶기 검증

설치 단계와 취소 후 실제 반영 결과를 분리했습니다. 취소 전에 요청을 보내지 않은 경우, 서버 반영 직후 취소된 경우, 결과가 다음 행동 기록에 유지되는 경우를 모의검증했습니다. 실제 서버 비교에서는 설치 취소가 발생하지 않아 취소 후 반영 경로의 서버 재현은 남아 있습니다.

저장된4상황을 각각2회 API 재생한 결과, 설치 인자 선택은 순차2회→묶음1회, 중앙값603ms→320ms, 비용은 약48% 감소했습니다. 양쪽 모두 허용된 인자를 반환했지만 두 방식의 선택 결과는8쌍 중2쌍만 같았습니다. 같은 방식 안에서 반복 결과 일치도 순차4/4, 묶음1/4로, 선택 품질 동등성을 입증하지 못했습니다.

같은 원본 월드와 소지품에서 두 봇을 각60초 실행했습니다. 자유 탐색에서는 설치가 나오지 않아, 비교에는 동일한 ‘작은 구조물 설치·여분 재료 보관’ 요청을 사용했습니다. 위치·재료·수량·행동은 모델이 선택했습니다.

| 지표 | 순차 | 인자 묶기 |
|---|---:|---:|
| 설치 선택 완료 중앙값 | 969ms | 666ms |
| 평균 무실행 비율 | 76.9% | 77.0% |
| 서버 설치 / 완료 기록 | 19 / 19 | 17 / 17 |
| 설치 취소 | 0 | 0 |
| 빈 인자 범위 선택 | 44 | 40 |
| look 완료 | 9 | 34 |

두 조건 모두 HTTP 오류는 없었지만 장기 목표 출력 검증 오류가 각1건 있었습니다. 묶음 조건에서 한 봇이 자신 주변을 막는 배치를 만들어 이동에 제약이 생겼습니다. 블록 설치 수는 유용한 구조물·협동의 증거가 아닙니다. 취소0건은 이전의 다른 요청·실행과 직접 비교해 인과적 감소로 주장하지 않습니다.

앞선 시도에서는 이동 목적지 입력의 토큰 한도 초과가 재발했습니다. 긴 해시 참조를 요청 내부의 짧은 ID로 바꾸고 좌표 배열의 차이값 압축을 보존해, 가장 큰 실패 요청을20,982입력 토큰으로 재생했습니다. 정보·선택지는 제거하지 않았습니다. 정상 비교는 동일한 수정 코드로 수행했습니다.

## 이전 비교에서 확인한 점

- 세부 목표 없는14분 탐색에서는 생산 활동·협동이 없었습니다. 일부 후속3분 검증에서는 채굴·보관이 나왔지만 안정적으로 재현됐다고 보기 어렵습니다.
- look 선택을4회에서2회 호출로 묶은 각3분 비교에서 선택 중앙값은1.126초→0.605초, 평균 무실행 비율은52.4%→45.4%였습니다. 반면 look 반복은 늘고 생산 활동은 줄어, 호출 단축만으로 진척을 보장하지 못했습니다.
- 상대 회전량을 표시한 선택지는 저장 상황 API 재생8회에서 같은 명령 재선택을8회→0회로 줄였지만 실제 장기 효과는 미검증입니다. 기본 선택 설정은 유지합니다.

## 다음 검증

빈 설치 위치·상자 범위를 알고도 해당 행동을 반복 선택하는 이유, 지형 변경 뒤 이동·철거 계획, 상자 확인 반복과 무효화된 판단 비용을 우선 확인합니다. 다음 행동의 사전 선택은 현재 작업의 중단과 구분해야 하며, 단순히 호출을 늘리지 않습니다. 인자 묶기는 비교 옵션으로 유지합니다. 원거리 기억 검색·장기 입력 증가·투명 블록 관측도 남아 있습니다. 원본 로그·운영 기록은 공개하지 않습니다.

## 자동 관측·작업 접근 규약

사방 관측 모드의 `look` 선택 제거, 손 닿는 범위 밖의 설치 후보, 설치 전 접근과 접근 실패 시 무설치, 기억한 채굴 대상의 접근 후 재확인을 모의검증했습니다. 기존 벽 가림·지도 입력 범위·취소 후 반영 결과 검사도 유지합니다. 후속 기능검증에서 실제 API 선택과 작업 접근을 확인했습니다. 공백 감소나 자율 플레이 개선을 입증한 실험은 아닙니다.

## 작업 액션 통합 검증

사방 관측 선택지에서 제작대 설치를 `place_block`으로 통합하고, 작업대 선택·접근 제작, 작업별 공통 실행 증거, 부분 전송 수량, 대상 유실 처리를 점검했습니다. 모의검증은 취소된 제작의 실제 획득, 부분 전송의 양쪽 변화·잔량, 보이지 않는 플레이어 추적 중단, 늦은 드롭 출현을 포함합니다.

실제 API 합성 입력 6회는 모두 유효한 행동·인자를 반환했습니다. 설치 2회는 바로 설치를, 제작·채굴 각2회는 먼저 이동을 선택했습니다. 별도 명시적 과제를 준 짧은 서버 검증에서 작업대 접근 후 나무 곡괭이1개 제작, 판자2개 보관·1개 인출, 원목 파괴를 확인했습니다. 설치는 실행됐지만 지정 구역 평가는 재검증이 필요합니다. 테스트 지시가 관측 여부를 확인하지 않고 해당 바닥을 이미 관측한 것으로 표현했고 실제 관측·후보에서는 빠져 있었습니다. 이를 자율 계획 실패나 JEV 판단력만의 문제로 평가하지 않습니다. 첫 채굴에서는 드롭만 남았고, 제한 시간 안에서 늦은 드롭을 재확인하도록 보강한 재검증에서는 원목1개 획득도 확인했습니다.

다음 과제는 설치 대상의 구역·좌표 선택 정확도와 확장된 후보의 입력 크기, 작업 접근을 포함한 액션을 선택하는 비율입니다. 전투·전달·추적은 이번 서버 검증 범위가 아니며 기존 검증과 모의검증을 구분합니다. 장기 자율 실험은 진행하지 않았습니다.

## 근거리 지도 영역 검증

평지의 각도별 표본 관측에서 빠지던 바닥을 블록별 노출 면 검사로 보완했습니다. 모의검증은 지정 바닥15셀 관측, 벽 뒤 차단, 제거된 블록의 가시성 확인 후 공기 갱신, 영역 압축의 구멍·높이·재질·시각 보존, 설치 영역과 정확한 좌표의 모델 선택을 포함합니다. 실제 서버 무과금 점검에서는 가까운435셀을25개 영역, 설치 후보532개를48개 영역으로 표현하고 돌 바닥20셀의 관측을 확인했습니다. 후보는 전체 지도나 경로 안전 보장이 아닙니다. 새 지도 입력의 API 재생도 성공했습니다. 설치 과제의 별도 API 재생에서는 JEV가 설치 영역과 정확한 좌표를 선택했습니다. 서버 파일럿에서 이 설치 경로가 실행된 것은 아닙니다.


두 봇5분 파일럿은 세부 목표 없이 준비된 평지에서 정상 종료했습니다. 서버 기준 사망0, 각110블록가량 이동, 대화29건, 제작대1개 제작을 확인했습니다. 제작은 취소로 기록됐지만 판자4개 감소·제작대1개 획득이 결과에 보존됐고 서버와 일치했습니다. 채굴·설치·물품 전달은0건이며 생산적 협동은 입증하지 못했습니다. 돌 바닥의 실제 좌표를 대화에 사용하고 한 봇은 조사 완료 후 다른 탐색 목표로 갱신했습니다.

클라이언트 실행 구간 밖 시간은 Alice61.3%, Bob60.1%였습니다. 이는 서버에서 본 정지 시간과 다릅니다(실제 위치 변화 약57/59초). 전체 선택 중앙값은1.57/1.63초, 이동 취소는23/26건으로 잦았습니다. HTTP·입력 토큰 초과는0건, 장기 목표 완료조건의400자 제한 위반은2건 있었고 이후 갱신에 성공했습니다. 실행 비용은 설정 단가 기준 약$0.91이며 이전 실행과 조건이 달라 공백 감소의 인과 비교로 사용하지 않습니다. 다음은 반복 탐색·이동 전환의 입력 근거와 근거리 관측 계산 비용을 분석하는 것입니다. 세부 목표나 행동을 로컬에서 강제하지 않습니다.

## 서버 없는 계획·전환 검증

저장 로그에서 중기 요청91개를 추출하고 요청 ID별 응답 연결·미래 정보 배제를 검사했습니다.4상황을 각2회 비교한 뒤, 보류와 새 계획의 모순 및 오래된 상자 정보를 완료 증거로 오인하는 사례를 확인해 검토 규약과 시간 정보를 보완했습니다. 스키마 통과를 계획 품질 향상으로 계산하지 않습니다. 상자 재확인2상황을 각2회 재생한 후속 검사에서는4/4회 모두 과거 내용물·진행 중인 검사를 구분하고 완료를 보류했습니다. 적은 수의 동일 입력 재생이며 장기 효과는 미검증입니다. 이번 유료 재생 합산 비용은 설정 단가와 보수적 재시도 계산 기준 약$0.20입니다.

동일한 중단 상황4개를 각2회 재생했을 때 `stop`은 기존 설명7/8회, 수정 설명3/8회였습니다. 이는 중단 선택 빈도의 변화이며 모든 유지·전환 선택의 적절성이나 실제 공백 감소를 증명하지 않습니다. 작은 이동 도메인은 모의검증에서 행동+구역+좌표3회에서 행동+좌표2회로 줄고 모델의 좌표 선택을 보존했습니다. 실제 서버의 큰 도메인에는 이 단축이 적용되지 않을 수 있습니다. 인자를 기다리는 동안 기존 작업 유지, 유효하지 않은 대체 선택 시 유지, 신선한 중단과 오래된 단계 응답 거절을 함께 검사했습니다.

다음은 계획 완료 판단의 사실성, 다회 계획 갱신의 연속성, 큰 이동 도메인의 호출 수를 검증하는 것입니다. 서버 복구 후 동일 조건에서 공백과 유효 진척을 재측정해야 합니다.


Task-binding replay: six saved-input cases augmented with task/criterion IDs distinguished four unfinished chest checks from two completed wood pickups. One 13-reference response was repaired to two references. Mock tests cover identity continuity, wrong/stale IDs, unresolved criteria, ambiguous fields and the one-repair limit. The initial inconsistent output example and its failed replays are retained privately. No server run used this update; semantic accuracy is not guaranteed by schema validation.


Map-budget checks cover irregular terrain, remote-history invariance, hidden-cell exclusion and reachability of every member of a 513-value summarized domain. All 26 saved context-limit failures fit the new map budget; three actual API replays (first, last, largest transformed request) succeeded at 8,700-10,709 input tokens. Full suite: 480 tests. A subsequent two-bot 15-minute functional run in varied natural terrain completed without HTTP/context-limit errors. Map overview max9,325 bytes; total JEV input max16,391 tokens. Estimated cost1.21USD. Alice gathered8 logs, marked the goal complete from inventory evidence, and later crafted planks/tables; Bob obtained cobblestone. No construction or item transfer was demonstrated. Executor gaps were49.4%/45.7%, mostly overlapping action/argument API waits; this is not a matched comparison with the earlier flat world. Movement/pickup failures, repeated table crafting and eight planner/memory validation errors remain. Important-place growth and total non-map context remain separate limits.

Output-recovery mocks: 484 tests and typecheck pass. Tests cover evidence-reference round trips and collisions, unknown-reference rejection, field-specific length diagnostics, reflection/place repair and the one-repair limit. No live API or server run has verified this recovery update yet; schema validity does not establish semantic accuracy.

Local placement/equipment mocks cover local observation, short approach, automatic armor routing and explicit removals. Live panorama selection now has2 rounds for move/place/pickup/equip and at most3 for mining/crafting/transfers. Dense domains shrink complete radius shells to254 targets; tests check no omissions inside the reported scope, duplicate support faces, retained far landmarks, conditional transfer counts and identical scope facts in LLM/JEV requests. Legacy replay modes retain their prior selection behavior.

Frozen synthetic API comparison:14 decisions per version,79 total calls, estimated0.023USD. Mean decision latency762→667ms; calls45→34. New-version cost0.0131USD versus baseline0.0096USD: direct target lists use more tokens. Mining/placement/crafting arguments matched the supplied tasks; fresh-container withdrawal and giving preserved item/count. An out-of-scope construction request selected a local move first. Two initial withdrawal cases selected inspection in both versions and are not counted as withdrawal-path tests. This is a small synthetic comparison, not evidence of server idle-time or autonomous progress improvement. Nonspatial domains over254 and total request context limits remain explicit failure cases.

침대/동물 기능 점검: 전체504개 모의검증과 타입 검사 통과. 별도 서버 모터 점검에서 동향 침대2개 설치(각각1개 소모), 수면 진입과 기상을 확인했습니다. 직접 지정한 동작이며 자율 건축 성공 증거는 아닙니다.

공동 거처·침대2개 목표 검증은15분 예정이었으나9분51초에 입력 한도 오류58건으로 중단했습니다. 양이 있는 자연 지형에서 역할·부지는 합의했지만 제작·설치·양털 획득은0이었습니다. 최종 추가 소지품은 한 봇이 조약돌2·흙4, 다른 봇이 막대기2입니다. 드롭이 좁은 지형에 걸린 줍기 실패와 반복 접근을 확인했습니다. 실행 기록 구간 기준 공백은65.2%/53.6%, 비용은 미확정 응답 상한을 포함해 약1.22USD입니다. 후보254개 제한만으로 전체 토큰 크기를 보장하지 못했으며, 다음 검증은 후보 설명·좌표의 중복 압축과 장애물 있는 드롭 회수입니다. 개별 침대 점검 성공과 자율 건축 성공을 구분합니다.

### Pickup approach and large choice payloads

Pickup now targets nearby standing cells, retains a frozen last-seen destination during occlusion, and requires matching inventory gain. Mining/pickup route failures retain structured navigation evidence. Navigation supports one-block jumps and bounded drops (maximum four); it does not alter terrain automatically. Large choice lists share exact descriptions and columnar values without removing candidates.

Validation: 508 offline tests passed. Two previously rejected API inputs were accepted after lossless repacking (about 34–38% smaller serialized payloads). Controlled server checks confirmed pickup beside a low ceiling, pickup from a raised platform, explicit one-block ascent, and pickup after a two-block descent. A subsequent two-bot 15-minute shelter run completed with zero context-limit errors, but produced no wood, wool, crafting, building, or beds; only five dirt were collected. Lower executor gaps did not translate into productive progress. Remaining issues: autonomous repeated-target behavior, movement cancellation, and planner/reflection output validation. Task-transition consistency and choice representation have since received the offline/API checks below. Controlled motor success does not establish autonomous construction ability.

### Plan transition and choice representation

Continuation now requires unchanged completion conditions and inventory totals; conflicting model output receives one bounded repair before acceptance. A model-selected replacement or deferral gets matching new task criteria. Landmark visibility is attached before map compression; incomplete archived observations retain unknown status.

514 tests passed. On one recorded 230-block failure input, reference-only options selected the first entry in all six calls across three orders; inline names/coordinates selected the same oak log in all six. Candidate sets and context facts were preserved. Inline identity is now used for large block/coordinate lists, while shared tables retain metadata. Three planner replays preserved task/criterion consistency and exact transfer to JEV input. Two earlier oversized inputs also passed live API checks. These are bounded replay results, not evidence of autonomous construction success; no server run accompanied this change.

Additional saved-scene replay: six scenes, two samples each, distinguished actual inventory gains from failed/cancelled labels and preserved bound plans through JEV encoding. Completion led to plank crafting in both wood-completion probes, but furnace prerequisites and one ore-name claim remained incorrect; recorded later snapshots are not continuous rollouts. A fixed 29-block input selected logs in2/6 reference-format calls versus6/6 inline-name/coordinate calls across three orders. The small-domain formatter is evaluation-only; production still applies it at32+ options. No server execution or idle-time improvement is claimed.
