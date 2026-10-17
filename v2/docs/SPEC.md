# 구현 명세
LLM은 장기 목표·중기 단계를 갱신하고, JEV는 즉시 실행할 스킬을 선택합니다. 로컬 실행기가 동작을 완료·취소하며 실제 결과를 확인합니다. 대화와 경험 검토도 동일 API 예산을 공유합니다.

| 모듈 | 역할 |
|---|---|
| cli/config/control | 설정, 시간·비용 제한, 실행 중 목표 변경 |
| providers/runtime/planning/goals | 모델 통신, 행동 소유권, 재계획, 증거 연결 |
| mineflayer/vision/protocol/recipe-book | 연결, 시야, 버전별 패킷, 제작법 해금 |
| combat/building/mining/pickup/equipment | 로컬 스킬과 결과 확인 |
| experience-memory/social/spatial-memory | 경험·대화·장소 저장 |

한 봇의 동작은 한 실행기만 소유합니다. 새 목표·대화·위협·계획 변경에 오래된 응답을 폐기합니다. 낮은 JEV 신뢰도만으로 유효 행동을 거절하지 않습니다.

채굴 성공과 획득, 전달과 수령, 적 실종과 처치를 구분합니다. 관측·실행 제약은 가이드라인보다 우선합니다. VISION_AND_ACTIONS.md와 PLANNING.md 참고.

게임 설명·사용자 요청·자율 목표·기억 입력을 분리합니다. 목표의 저장·근거·보류·재접속 게이트는 GOALS.md가 기준입니다.
