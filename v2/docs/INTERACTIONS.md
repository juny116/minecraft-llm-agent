# 컨테이너와 전달
inspect_container는 보이는 상자·화로를 열어 실제 내용과 관측 시각을 기억합니다. 과거 inspect_chest는 현재 액션이 아니며 옛 지침을 읽을 때 변환합니다.

deposit/withdraw는 container:{x,y,z}, transfer:{item,count}를 사용합니다. count1..64. 상자는 실제 내용과 내 인벤토리 변화를 확인합니다. 화로는 slot을 추가합니다(FURNACE.md).

give는 transfer:{item,count,recipient}로 보이는 플레이어 쪽에 떨어뜨립니다. 결과는 전달 시도이며 수령은 미확인입니다. 대화 기반 확인은 SOCIAL.md 참고.

클릭마다 취소를 검사하고 창을 닫은 뒤 소지품 변화를 검증합니다. 일반 재료·도구 왕복을 실제 검증했지만 동일 이름의 서로 다른 NBT 스택을 컨테이너에서 지정하는 기능은 아직 없습니다.
