# OrganoLeaf 통로 설계 시뮬레이터

2026 체인지메이커 OrganoLeaf 팀의 탐구용 웹 시뮬레이터입니다.

**탐구 질문:** 직선형 통로와 잎맥처럼 갈라지는 통로 중 어떤 구조가 조직 내부의 각 지점과 통로 사이의 거리를 더 짧게 만들까? 통로 간격에 따라 결과는 어떻게 달라질까?

## 기능

1. **구조 비교:** 직선형(A)과 잎맥형(B) 통로의 거리 색상 지도, 평균·최대 거리, 기준 거리 이내 비율, 필요한 입구 수
2. **공정 비교:** 두 구조의 통로 총 길이를 같게 맞추기, 직선형도 입구 1개로 연결하기
3. **통로 양(간격)별 그래프:** 총 길이 4~20 mm 결과 그래프와 표, CSV 내려받기
4. **체험:** 직접 통로를 그려 직선형·잎맥형과 비교하기

## 계산 방법

- 조직: 2 mm × 2 mm 정사각형 단면(2차원), 1칸 = 10 μm (200 × 200 격자)
- 통로 굵기: 20 μm
- 각 칸의 중심에서 가장 가까운 통로 벽까지의 직선 거리를 계산합니다.
- 필요한 입구 수 = 서로 연결되지 않은 통로망의 개수
- 확산 시간(상대값) = (최대 거리 ÷ 직선형 최대 거리)². 한천 실험에서 확인한 시간 ∝ 거리² 관계를 적용한 참고값입니다.

## 한계

- 통로까지의 거리만 계산합니다. 실제 산소 공급, 혈류, 압력, 세포 생존은 예측하지 않습니다.
- 정사각형 조직을 가정했으므로 잎맥형은 입구 쪽 모서리에서 불리할 수 있습니다.

## GitHub Pages 배포 방법

1. GitHub에서 새 저장소를 만들고 `index.html`과 `README.md`를 올립니다.
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Build and deployment**의 Source를 **Deploy from a branch**로 두고, Branch를 `main` / `(root)`로 선택한 뒤 저장합니다.
4. 몇 분 뒤 `https://<사용자이름>.github.io/<저장소이름>/` 주소로 접속합니다.

별도 설치나 빌드 없이 `index.html` 파일 하나로 동작합니다.

## 참고문헌

- Nwokoye, N. P., & Abilez, O. J. (2024). Bioengineering methods for vascularizing organoids. *Cell Reports Methods*, 100779.
- Gershlak, J. R., et al. (2017). Crossing kingdoms: Using decellularized plants as perfusable tissue engineering scaffolds. *Biomaterials*. PMID 28222326.
