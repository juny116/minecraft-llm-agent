# Minecraft LLM Agent

생성형 LLM이 목표·계획·대화·기억을 관리하고, JEV가 행동과 인자를 선택하며, Mineflayer가 실행하는 Minecraft Java 봇입니다. 현재 개발 대상은 **v2**이며, 자율 행동의 안정성을 검증 중입니다.

## 동작 구조

```text
현재 관측 + 자기 상태 + 대화 + 기억
  → LLM: 목표·작업 의도·경험 지침 갱신
  → JEV: 행동과 대상·좌표·수량 선택
  → 로컬 실행기: 실행·취소·결과 확인
  → 선택과 상태 변화를 다음 판단에 반영
```

행동 실행과 계획·대화는 비동기로 진행합니다. 모델에는 기하학적 시야 검사로 관측한 환경, 과거 관측 기억, 자기 인벤토리와 해금된 제작법을 제공합니다. 화면을 읽거나 키보드를 조작하는 방식은 아닙니다.

## 구현된 기능

| 범주 | 액션 |
|---|---|
| 관찰·이동 | `look`, `move`, `follow`, `idle` |
| 채집·건축 | `mine`, `pickup`, `place_block`, `place_table` |
| 제작·보관 | `craft`, `inspect_container`, `deposit`, `withdraw` |
| 생존·전투 | `eat`, `equip`, `attack`, `flee` |
| 전달 | `give` |

봇 간 대화·별명 기억, 목표의 완료/보류 관리, 경험 기반 지침 갱신, 재접속 시 기억 복원, 사망 후 회수 여부 판단도 구현되어 있습니다. 전투는 근접 전투이며 활·방패와 기본 조작부터 학습하는 모드는 미구현입니다.

## 실행

Node.js 22+와 pnpm이 필요하며 GPU는 사용하지 않습니다.

```bash
cd v2
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 typecheck
npx --yes pnpm@11.25.0 test
RUN_SECONDS=10 npx --yes pnpm@11.25.0 demo
```

`demo`는 서버·API 없이 동작합니다. 실제 서버와 API 키 설정은 [사용법](v2/README.md)을 참고하세요.

## 검증과 남은 과제

Java 1.21.1의 통제된 서버에서 주요 개별 액션, 대화·계획의 병렬 처리, 리스폰과 근거리 아이템 회수를 확인했습니다. **장기 생존과 자발적인 협동은 아직 검증되지 않았습니다.**

개별 검증에서는 제작·설치·보관과 명시적 요청에 따른 채굴·획득·목표 완료를 확인했습니다. 반면 세부 목표 없는 두 봇14분 탐색 실험에서는 이동·관찰·대화에 머물렀고 생산적인 작업이나 협동은 확인되지 않았습니다.

다음 개발은 탐색·장소 기록 작업의 완료와 목표 전환, 근거 인용 오류, 선택 호출 사이 실행 공백에 집중합니다. [검증 현황과 한계](v2/docs/VALIDATION.md)

## 문서

[사용법](v2/README.md) · [구조와 동작 규약](v2/docs/ARCHITECTURE.md) · [기존 구현과 비교](v2/docs/SYSTEM_COMPARISON.md) · [검증 현황](v2/docs/VALIDATION.md)

소스는 `v2/src/`, 테스트는 `v2/test/`, 검증 도구는 `v2/scripts/`에 있습니다. Python·NeoForge 기반 v1은 [LEGACY.md](LEGACY.md)에 보존합니다.
