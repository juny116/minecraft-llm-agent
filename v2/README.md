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
| `WORKFLOW_MODE` | `direct`(기본): JEV 세부 선택 / `procedural`: v2.5 작업 절차 실행 |

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

기본 `TARGET_POLICY=observed`에서는 LLM이 작업 의도를 주고 JEV가 대상을 고릅니다. `planner`는 이전 정책과의 비교용입니다. `JEV_ARGUMENT_CONTRACT`의 기본값은 `legacy`, `JEV_WITHDRAWAL_MODE`는 `direct`입니다. `direct`는 인자 선택 중 `revise`로 제안을 철회할 수 있고, 모든 인자를 고르면 추가 승인 없이 실행을 시도합니다. 철회는 기존 실행을 중단하거나 대체 행동을 선택하지 않습니다. 최신 상태 검사도 유지합니다. `coordinated`, `joint`, `separate`, `proposal` 등 비교 설정이 있으며 최신 검증 결과가 기본 설정 전체에 적용되는 것은 아닙니다. [구조](docs/ARCHITECTURE.md) · [검증 현황](docs/VALIDATION.md)

실제 서버는 가림을 유지한 사방 자동 관측을 사용하며 `look`을 선택지에 제공하지 않습니다. `JEV_LOOK_BINDING`과 시선 실행 코드는 과거 비교 도구 호환용입니다. 제작대 설치는 `place_block`으로 통합했습니다. 채굴·작업대 제작·상자 작업은 대상까지 접근하는 과정을 포함합니다. 작업 대상은 최대 반경12블록 안에서 고르며, 후보가 많으면 전체 반경을 줄여254개 이하로 맞춥니다. 현재 반경과 후보 수는 `actionScopes`로 LLM·JEV에 전달합니다. 설치는 현재 관측한 곳만 가능하고 짧은 접근을 포함합니다. 범위 밖 작업은 먼저 `move`로 가까이 가서 다시 관측합니다.

현재 사방 관측 경로는 행동 선택을 포함해 이동·설치·줍기·장비 등이2회, 채굴·제작·전달·보관·인출이최대3회 호출입니다. 구역 선택은 없습니다. 인자를 묶어도 대상·수량은 JEV가 결정합니다. `JEV_ARGUMENT_BINDING`은 이전 관측 모드 비교용이며 현재 경로는 필요한 인자를 묶습니다. 호출 감소가 토큰 비용 감소를 보장하지는 않습니다.

`equip`은 행동 선택 후 장비 변경을 한 번 고릅니다. 방어구는 해당 부위에 자동 착용하고, 일반 아이템은 주 손 기본·보조 손 별도 선택입니다. 부위별 해제도 같은 목록에 있으며, 장착은 먹기·방패 막기 등의 사용 동작과 다릅니다.

`runs/`에는 이벤트·종료 요약과 봇별 기억이 저장됩니다. 월드를 초기화하면 기억 namespace를 분리하세요. 기억한 목표는 재접속 후 현재 관측으로 재검토합니다.

요청 전 비용을 예약하고 사용량으로 정산하며, 확인되지 않은 사용량은 보수적으로 처리합니다. 일반 CLI의 한도는 실행별입니다. 일부 기능검증 도구만 `functional-ledger.ts`로 합산 한도를 공유합니다.

`scripts/`는 특정 초기 상태를 요구하는 개발용 검증 도구입니다. 실행 전에 요구 조건과 비용 옵션을 확인하고 봇 중복 접속을 피하세요. 로그·기억·키·개인 작업 기록은 Git에 올리지 않습니다.

## 서버 없는 평가

```bash
npx --yes pnpm@11.25.0 procedure:mock
```

v2.5의 원목 수집→판자 제작을 서버·API 없이 검증하고 `runs/`에 실행 기록을 남깁니다. 모델 응답과 월드는 고정된 테스트 자료이므로 판단 품질·실제 속도 검증은 아닙니다. 실제 실행에서 `WORKFLOW_MODE=procedural`을 지정하면 LLM의 절차를 JEV가 시작·유지·전환하고, 로컬은 위임 범위 안에서 대상·재료 부족분을 계산합니다. 기존 개별 행동 선택도 유지합니다. 현재 절차는 `mine`·`pickup`·`craft` 조합에 한정합니다. [역할과 제한](docs/PROCEDURES.md)

`scripts/offline-planning-eval.ts <events.jsonl> <runs/output-dir>`는 저장된 중기 계획 요청·응답을 추출합니다. 이후 관측은 입력에 합치지 않습니다. `--api`와 비교할 이전 프롬프트 파일을 지정하면 유료 재생(실행당 최대20호출·추정$0.50)을 수행합니다. `offline-stop-eval.ts`도 `--api`가 필요한 별도 유료 비교입니다. 출력에는 원본 관측이 있으므로 `runs/` 밖에 공개하지 마세요. 평가 기준은 완료 근거·다음 작업·보류 조건·정보 출처·계획 연속성이며 특정 액션을 정답으로 강제하지 않습니다. 재생은 실제 이동·생존 성능 검증을 대체하지 않습니다.
