# Minecraft LLM Agent

생성형 LLM이 목표·계획·대화·기억을 관리하고, JEV가 행동과 인자를 선택하며, Mineflayer가 실행하는 Minecraft Java 봇입니다. 현재 개발 대상은 **v2**입니다.

실험적 **v2.5**는 LLM의 수집·제작 절차를 로컬이 실행하고 JEV가 유지·전환을 판단합니다. 기존 직접 선택 모드는 유지합니다. [작업 절차와 역할](v2/docs/PROCEDURES.md)

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
| 자동 관측·이동 | 사방 자동 관측, `move`, `follow` |
| 채집·건축 | `mine`, `pickup`, `place_block` |
| 제작·보관 | `craft`, `inspect_container`, `deposit`, `withdraw` |
| 생존·전투 | `eat`, `equip`, `attack`, `flee`, `sleep` |
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

## 한계

장기 생존과 자발적인 협동은 아직 검증되지 않았습니다. 전투는 근접 전투만 지원합니다.

## 문서

[사용법](v2/README.md) · [구조와 동작 규약](v2/docs/ARCHITECTURE.md) · [기존 구현과 비교](v2/docs/SYSTEM_COMPARISON.md)

소스는 `v2/src/`, 테스트는 `v2/test/`, 검증 도구는 `v2/scripts/`에 있습니다. Python·NeoForge 기반 v1은 [LEGACY.md](LEGACY.md)에 보존합니다.
