# 기존 JEV 봇과 비교

[rmalde/minecraft-agent](https://github.com/rmalde/minecraft-agent)의 `78b40ed` 커밋 중 **nether-agent 지정 경로 완주 모드**와 비교합니다. 해당 저장소 전체의 기능을 일반화하거나 성능 우열을 주장하는 비교는 아닙니다.

두 구현 모두 Mineflayer의 사전 구현된 동작과 생성 모델·JEV를 사용하며 비동기 계획을 지원합니다.

| 항목 | 비교 대상의 지정 경로 모드 | 이 프로젝트 v2 |
|---|---|---|
| 목표 | 준비물·경유지·공략 단계를 구체적으로 설정 | 게임 설명·요청과 관측에서 LLM이 목표·작업 의도 관리 |
| 행동 선택 | 코드가 대상·수량까지 구성한 완성 후보 중 JEV가 선택 | JEV가 행동 종류와 인자를 순차 선택 |
| 제어 | 주 선택 루프가 동작 완료를 기다림; 별도 전투 제어 | 실행 중 유지·전환 판단, 계획·대화·경험 검토 분리 |
| 관측·기억 | 로드된 청크와 지정 경로 정보, 최근 기록·계획 활용 | 현재 시야와 과거 관측을 구분하고 목표·장소·경험·사회적 기억 저장 |
| 다중 봇 | 해당 모드는 단일 봇 완주 중심 | 봇별 기억과 상호 대화, 약속·목표 연결 지원 |

완성 후보 방식은 행동과 인자의 일관성을 확보하기 쉽지만 과업별 후보 구성에 의존합니다. v2는 더 많은 선택을 모델에 맡기는 대신 인자 철회·무동작 목적지·긴 행동 공백이 현재 병목입니다. 선택권이 넓다는 것이 플레이 능력이 높다는 뜻은 아닙니다.

비교 대상의 완주 기록과 v2의 기능검증은 월드·준비물·목표·관측 조건이 달라 시간을 직접 비교할 수 없습니다. v2의 장기 생존·자발적 협동과 기억의 성능 효과는 아직 검증하지 않았습니다. [검증 현황](VALIDATION.md)

코드 근거: [단계·후보·실행 루프](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/nether-agent.mjs), [모델 입력](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/models.mjs), [비동기 계획](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/async-planner.mjs), [실행 조건](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/README.md).
