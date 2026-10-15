# Minecraft LLM Agent

언어모델이 Minecraft의 주변 상태를 관찰하고 이동·채집·제작·대화를 수행하는 에이전트입니다. Python 컨트롤러가 행동을 결정하고 NeoForge 클라이언트 모드가 게임 안에서 실행합니다.

## 동작 방식

1. 클라이언트 모드가 위치·체력·인벤토리·주변 블록·채팅을 TCP로 전달합니다.
2. Actor가 관찰 요약과 파일 메모리를 읽고 tool calling으로 행동을 선택합니다.
3. 선택한 도구를 모드의 제어 명령으로 변환해 실행합니다. 이동과 채굴에는 Baritone 연결을 사용합니다.
4. Planner는 주요 사건, Actor의 요청 또는 일정 행동 수·시간 간격에 따라 목표와 교훈을 갱신합니다.
5. Responder는 별도 연결에서 채팅을 확인하고 응답합니다. 세 역할은 목표·교훈·장소·일지를 공유합니다.

## 코드 구조

| 경로 | 역할 |
|---|---|
| `minecraft_agent/actor.py` | 행동 루프, 실행 결과 확인, 이동·채굴 대기 |
| `minecraft_agent/planner.py` | 진행 상황 요약, 목표 재검토와 교훈 정리 |
| `minecraft_agent/chat_responder.py` | 게임 내 채팅 처리 |
| `minecraft_agent/game_client.py` | newline-delimited JSON TCP 통신과 재접속 |
| `minecraft_agent/model_client.py` | Chat Completions 요청, 재시도, 호출·토큰 집계 |
| `minecraft_agent/observations.py` | 게임 상태 요약, 주변 블록과 새 채팅 추출 |
| `minecraft_agent/file_memory.py` | 목표·교훈·장소·일지 저장과 검색 |
| `minecraft_agent/action_tools.py` | 모델 도구 스키마와 게임 명령 매핑 |
| `minecraft_agent/prompts.py` | Actor·Planner의 역할과 행동 지침 |
| `minecraft_agent/runtime_options.py` | 모델 연결, 호출 한도, 루프 옵션 |
| `minecraft_agent/cli.py` | 컨트롤러 실행 옵션 처리 |
| `minecraft_agent/manual_control.py` | 수동 명령 클라이언트 |
| `minecraft_agent/status_dashboard.py` | 게임 상태·로그·메모리 웹 뷰어 |
| `minecraft_agent/check_model_api.py` | 모델 tool calling과 생성 속도 확인 |
| `mod/src/main/java/mcagent/` | NeoForge 모드 소스 |
| `tests/` | 통신·메모리·관찰 처리 테스트 |

Java의 `ControlServer`가 TCP 요청을 받고, `ClientTickHandler`가 게임 틱에서 상태 관찰과 행동을 처리합니다. `BotControl`은 제어 상태를 보관하며 `BaritoneBridge`가 경로 탐색을 연결합니다. `McAgentMod`는 모드 진입점입니다.

## 컨트롤러 실행

Python 3.10 이상이며 Python 패키지는 표준 라이브러리만 사용합니다. Minecraft 1.21.1 / NeoForge 클라이언트에서 모드가 실행 중이어야 합니다. `mod/`는 Java 소스 디렉터리로, Gradle 빌드 프로젝트나 배포 JAR는 포함하지 않습니다. NeoForge 개발 프로젝트에 소스를 통합해 사용합니다.

저장소 루트에서 실행합니다. 모델 서버는 Chat Completions와 tool calling을 지원해야 합니다.

```bash
python -m minecraft_agent --help
python -m minecraft_agent \
  --bot-host 127.0.0.1 --bot-port 25599 \
  --server-host 127.0.0.1 --server-port 25566 \
  --actor-url http://127.0.0.1:8002/v1 --actor-model actor \
  --planner-url http://127.0.0.1:8001/v1 --planner-model planner \
  --memory-dir ./memory --max-calls 20
```

`--max-calls`와 `--max-tokens`는 공유 호출·토큰 집계에 따라 루프를 종료하는 기준입니다. `0`은 제한을 끕니다. `--loop-delay`는 행동 사이 대기 시간입니다. 목표·장소는 JSON, 교훈·일지는 Markdown으로 메모리 디렉터리에 저장됩니다.

## 수동 제어와 상태 확인

```bash
python -m minecraft_agent.manual_control --host 127.0.0.1 --port 25599
python -m minecraft_agent.status_dashboard --port 8899 \
  --memory-dir ./memory --log-file ./logs/agent.log
python -m minecraft_agent.check_model_api \
  --base-url http://127.0.0.1:8002/v1 --model actor
```

대시보드는 지정한 로그 파일과 메모리 디렉터리를 읽고 모드에서 현재 게임 상태를 조회합니다. 모델 정보 영역은 패키지 기본값을 표시합니다. API 확인 명령은 실제 모델 요청 두 건을 보냅니다.

## 테스트

```bash
python -m unittest discover -s tests -v
```

테스트에서는 게임 소켓과 모델 응답을 대체하므로 Minecraft나 모델 서버가 필요하지 않습니다.
