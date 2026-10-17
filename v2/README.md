# v2 사용법

전체 구조·액션·메모리·TODO는 [루트 README](../README.md)에 있습니다.

## 설치·모의검증

Node.js 22+, pnpm 11.25.0. 저장소 루트에서:

```bash
cd v2
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 typecheck
npx --yes pnpm@11.25.0 test
RUN_SECONDS=10 npx --yes pnpm@11.25.0 demo
```

## 개인 설정

```bash
test -f .env || cp .env.example .env
chmod 600 .env
```

`.env`에만 입력하세요.

| 설정 | 용도 |
|---|---|
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | 생성모델 연결 |
| `JEV_API_KEY`, `JEV_BASE_URL`, `JEV_MODEL` | JEV 연결 |
| `MC_HOST`, `MC_PORT`, `MC_VERSION`, `MC_AUTH` | 자신의 Minecraft 서버 |
| `BOT_NAMES` | 서버에서 허용한 봇 이름, 쉼표 구분 |
| `RUN_SECONDS`, `MAX_API_CALLS`, `MAX_ESTIMATED_USD` | 실행 제한 |

기본 설정은 OpenAI 호환 Chat Completions와 TypeSafe JEV입니다. JEV는 별도 `/systemone` 형식을 사용합니다. 모델·제공자를 바꾸면 토큰 단가도 갱신하세요. 포함된 단가는 최신 가격표나 청구 금액 보증이 아닙니다.

Java 1.21.1 기능검증 기준입니다. Microsoft 인증에는 해당 계정이 필요합니다. offline 인증은 접근을 제한한 개인 테스트 서버에서 사용하세요. [서버 준비](docs/SERVER_REQUEST.txt)

## 짧은 실제 실행

아래부터는 서버 접속과 API 요금이 발생할 수 있습니다.

```bash
BOT_NAMES=Alice RUN_SECONDS=60 MAX_API_CALLS=20 MAX_ESTIMATED_USD=0.10 npx --yes pnpm@11.25.0 start
```

Ctrl-C로 종료합니다. 사용자 지정 목표 없이 시작하며 실행 중 터미널에서 변경합니다.

```text
/goal Alice 주변을 관찰하고 가능한 일을 제안해
/goal * 상자 근처에서 협력해
/clear Alice
```

목표 변경은 기존 작업과 오래된 응답을 무효화합니다. clear는 목표 해제이지 일시정지가 아닙니다. 게임 채팅은 관측 데이터이며 이 관리자 명령 채널과 다릅니다.

`DECISION_MODE=jev|llm|rules`는 행동 선택만 바꿉니다. live의 rules도 LLM 계획을 호출합니다. 서버 없이 유료 연결만 확인하려면 `npx --yes pnpm@11.25.0 api:check`를 명시적으로 실행합니다.

## 결과·기억·비용

- `runs/<실행>/events.jsonl`: 선택·실행·상태 변화·대화
- `status.json`, `summary.json`: 현재 상태와 종료 요약
- `runs/memory/`: 봇별 경험·가이드라인·사회·공간 기억
- `MEMORY_NAMESPACE`: 월드/시나리오 기억 분리. 월드 초기화 시 변경

runs 전체는 비공개입니다. 현재 계획은 재시작 때 자동 재개하지 않습니다. 단순 텍스트 이력은 별도 파일로 복원되므로 완전히 새 시나리오는 기존 기록을 비공개 백업 후 분리해서 실행하세요.

요청 전 비용을 예약하고 실제 usage로 정산합니다. 사용량 미확인 시 추가 호출을 중단합니다. 일반 CLI 한도는 실행별입니다. 여러 기능검증의 합산 한도는 `scripts/functional-ledger.ts`를 쓰는 하네스만 공유합니다. ledger를 지우거나 미정산 실행을 무시하지 마세요.

## 개발용 기능검증

`scripts/`의 하네스는 정해진 재료·위치·상태를 요구하는 fixture입니다. 일반 플레이는 start로 실행합니다. 각 스크립트를 읽고 봇 중복 접속을 피하며 `--live-functional`로 명시적으로 시작하세요. API 검증은 별도 비용 범위를 정합니다. 본실험은 별도 승인·설계 없이 시작하지 않습니다.

[현재 범위](docs/READINESS.md) · [명세](docs/SPEC.md) · [인수인계](docs/HANDOFF.md)
