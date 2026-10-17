# 관측과 액션 규약
Mineflayer가 받은 전체 월드를 그대로 모델에 전달하지 않습니다. 눈 위치·방향에서 광선으로 보이는 블록/엔티티를 판정하고 가림·거리를 검사합니다. 렌더링 없는 근사 시야이며 사람의 픽셀 시야와 같지는 않습니다.

자신의 인벤토리·장비·체력·허기, 보이는 적 종류·플레이어, 들은 채팅, 해금 제작법, 직접 연 보관함을 제공합니다. 적의 HP·공격력 표와 다른 플레이어 인벤토리는 제공하지 않습니다.

| 액션 | 주요 파라미터 |
|---|---|
| look | look:{yaw,pitch} |
| move | destination:{x,y,z}; 관측한 목적지 |
| follow | 설정된 보이는 플레이어 |
| mine | mine:{position,expected,maxMs?,tool?,toolSlot?} |
| pickup | pickup:{entityId,expected} |
| place_block | build:{item,position,reference} |
| place_table | 소지 작업대·보이는 적합한 지지면 |
| craft | craft:{item,count}; count는 제작 횟수 |
| inspect_container | container:{x,y,z} |
| deposit / withdraw | container + transfer:{item,count,slot?} |
| give | transfer:{item,count,recipient} |
| equip | equip:{item 또는 null,destination,sourceSlot?} |
| eat / attack / flee / idle | 현재 관측·로컬 실행 규칙 |

모델 응답 후 후보·좌표·아이템을 재검증합니다. 스킬 내부 접근·도구 선택은 로컬 처리하며 중복 액션을 늘리지 않습니다. 세부 제약은 각 기능 문서를 참고하세요.

최근 실행 정합성: `move`는 저장된 관측 목적지를 허용하되 발판은 현재 접속에서 실제 관측한 것만 사용합니다. 경로가 막히면 카메라로 옆·뒤를 확인하고 다시 탐색합니다. 부분적으로만 보이는 채굴 대상은 재접근 후 검사하며 발밑 지지 블록은 후보에서 제외합니다. 제작은 이동 후 작업대를 다시 바라보고 확인합니다. `pickup`의 목표 아이템 인벤토리 증가가 확인되면 마지막 접근 오류와 별개로 획득을 기록하며, 특정 드롭에서 왔다는 인과는 확정하지 않습니다.
