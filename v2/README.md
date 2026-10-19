# v2 사용법

Node.js 22+가 필요합니다. 설치·테스트·무과금 demo는 [루트 README](../README.md)를 참고하세요.

## 설정

`v2/`에서 로컬 설정을 만듭니다. 기존 `.env`는 덮어쓰지 않습니다.

```bash
test -f .env || cp .env.example .env
chmod 600 .env
```

| 설정 | 용도 |
|---|---|
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | OpenAI 호환 생성모델 연결 |
| `JEV_API_KEY`, `JEV_BASE_URL`, `JEV_MODEL` | JEV `/systemone` 연결 |
| `MC_HOST`, `MC_PORT`, `MC_VERSION`, `MC_AUTH` | 자신의 Minecraft 서버 |
| `BOT_NAMES` | 허용된 봇 이름, 쉼표 구분 |
| `RUN_SECONDS`, `MAX_API_CALLS`, `MAX_ESTIMATED_USD` | 실행 시간·호출·추정 비용 상한 |
| `MEMORY_NAMESPACE` | 월드·시나리오별 기억 분리 |

키와 실제 서버 정보는 `.env`에만 저장합니다. 모델을 바꾸면 단가 설정도 갱신하세요. 포함된 단가는 최신 청구 금액을 보장하지 않습니다.

서버 검증 기준은 Minecraft Java 1.21.1입니다. 봇 이름을 화이트리스트에 등록하고 인증 방식을 맞추세요. Microsoft 인증에는 해당 계정이 필요합니다. offline 인증은 접근을 제한한 개인 서버에서 사용하며, 화이트리스트 UUID도 offline 방식과 일치해야 합니다.

## 실제 실행

아래 명령은 서버 접속과 유료 API 호출을 사용합니다.

```bash
BOT_NAMES=Alice RUN_SECONDS=60 MAX_API_CALLS=20 MAX_ESTIMATED_USD=0.10 npx --yes pnpm@11.25.0 start
```

Ctrl-C로 종료합니다. 목표는 선택 사항이며 `.env` 대신 실행 중 터미널에서 변경합니다.

```text
/goal Alice 주변을 관찰하고 가능한 일을 제안해
/goal * 상자 근처에서 협력해
/clear Alice
```

`/clear`는 요청 해제이며 일시정지가 아닙니다. 게임 채팅은 이 관리자 명령 채널과 별개입니다.

`DECISION_MODE=jev|llm|rules`는 행동 선택 방식을 바꿉니다. 실제 실행의 `rules`도 LLM 계획을 호출하므로 무과금 모드가 아닙니다. `api:check`는 서버 없이 유료 API 연결을 확인합니다.

## 선택 방식과 기록

기본 `TARGET_POLICY=observed`에서는 LLM이 작업 의도를 주고 JEV가 대상을 고릅니다. `planner`는 이전 정책과의 비교용입니다. `JEV_ARGUMENT_CONTRACT`의 기본값은 `legacy`, `JEV_WITHDRAWAL_MODE`는 `direct`입니다. `direct`는 모든 액션에서 인자 선택 후 추가 승인 없이 실행을 시도하며 최신 상태 검사는 유지합니다. `coordinated`, `joint`, `separate`, `proposal` 등 비교 설정이 있으며 최신 검증 결과가 기본 설정 전체에 적용되는 것은 아닙니다. [구조](docs/ARCHITECTURE.md) · [검증 현황](docs/VALIDATION.md)

`JEV_LOOK_BINDING=parallel-branches`는 `coordinated`/`direct` 설정에서 look 인자를 한 요청에 묶는 비교 옵션입니다. 모든 1도 단위 각도를 유지하며 기본값은 `sequential`입니다. `relative-branches`는 동일한 2회 구조에서 현재 시선 대비 회전량과 절대각도 범위를 함께 제시하는 비교 옵션이며, 저장 입력의 실제 API 검증까지 완료했습니다. 실제 서버에서 선택 지연 감소는 확인했지만, 생산적인 작업·목표 완료 개선은 확인되지 않았습니다.

`JEV_ARGUMENT_BINDING=independent`는 `coordinated`/`direct`에서 설치 재료·위치와 일반 상자의 보관 대상·아이템을 같은 요청으로 묶는 비교 옵션입니다. 수량은 선택한 아이템 이후에, 화로의 슬롯·아이템은 기존 순서대로 선택합니다. 기본값은 `sequential`입니다. 호출 지연은 줄었지만 전체 공백·행동 품질 개선은 확인하지 못했습니다.

`runs/`에는 이벤트·종료 요약과 봇별 기억이 저장됩니다. 월드를 초기화하면 기억 namespace를 분리하세요. 기억한 목표는 재접속 후 현재 관측으로 재검토합니다.

요청 전 비용을 예약하고 사용량으로 정산하며, 확인되지 않은 사용량은 보수적으로 처리합니다. 일반 CLI의 한도는 실행별입니다. 일부 기능검증 도구만 `functional-ledger.ts`로 합산 한도를 공유합니다.

`scripts/`는 특정 초기 상태를 요구하는 개발용 검증 도구입니다. 실행 전에 요구 조건과 비용 옵션을 확인하고 봇 중복 접속을 피하세요. 로그·기억·키·개인 작업 기록은 Git에 올리지 않습니다.
