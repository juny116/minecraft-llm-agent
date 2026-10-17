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
