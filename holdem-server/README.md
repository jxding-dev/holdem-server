## 파일 구조 26-04-01
```
holdem3/
├── server/
│   ├── server.js        ← WebSocket 서버 (Node.js)
│   ├── gameEngine.js    ← 게임 로직 (덱/족보/베팅/턴)
│   └── package.json
└── client/
    └── index.html       ← 클라이언트 (단일 파일)
```

---

## 현재 코드의 멀티플레이 문제점 (해결 완료)

| 문제 | 기존 | 해결 |
|------|------|------|
| 상태 분리 | 각자 localStorage | 서버가 유일한 상태 관리 |
| 카드 중복 | 각자 덱 생성 | 서버 단일 덱, 중복 불가 |
| 턴 순서 없음 | 누구나 언제든 베팅 | `currentIdx` 서버 관리 |
| 레이스 컨디션 | 동시 클릭 충돌 | 서버 액션 큐 직렬 처리 |
| 방장 없음 | 누구나 시작 | 방장 랜덤 지정, hostId 검증 |
| 연결 끊김 | 게임 중단 | 자동 폴드 + 마지막 1인 승리 |
| 타임아웃 없음 | 무한 대기 | 30초 자동 폴드 |
| 카드 노출 | 남 패 보임 | 서버가 개인별 state 생성 |

---

## 배포 방법

### 1단계: WebSocket 서버 (Render.com 무료)

1. GitHub에 `server/` 폴더 업로드
2. [Render.com](https://render.com) → New Web Service
3. Node → Build Command: `npm install` → Start Command: `npm start`
4. 생성된 URL 확인 (예: `https://holdem-xxx.onrender.com`)
5. WebSocket URL: `wss://holdem-xxx.onrender.com`

### 2단계: 클라이언트 (닷홈)

1. `client/index.html` 열기
2. 상단 `WS_URL` 변수를 실제 서버 주소로 변경:
   ```js
   return 'wss://holdem-xxx.onrender.com';
   ```
3. `index.html` + `.htaccess` (별도 제공)를 닷홈 `public_html`에 업로드
4. 브라우저에서 접속

### .htaccess (닷홈용)
```
AddType application/javascript .js
AddDefaultCharset UTF-8
DirectoryIndex index.html
```

---

## 주요 기능

### 멀티플레이
- 방 생성 / 방 코드 공유 / 입장
- 최대 5명 동시 플레이
- 랜덤 방장 지정 (첫 입장자)
- 방장만 게임 시작 가능
- 실시간 채팅 + 이모지 반응
- 30초 턴 타이머 (초과 시 자동 폴드)
- 연결 끊김 자동 처리

### 솔로 플레이
- AI 딜러와 1:1
- 족보 power 기반 AI 판단
- 힌트 자동 분석

### 게임 로직
- 정확한 블라인드 (SB 25 / BB 50)
- 콜 = `currentBet - myBet` 차액
- 레이즈 = 콜 + 추가 베팅
- 올인 사이드팟 지원
- 7장 중 최고 5장 조합 족보 판정
- 키커 비교까지 정확히 처리

### UI/UX
- 단계 바 (프리플랍 → 플랍 → 턴 → 리버 → 쇼다운)
- 턴 타이머 바
- 상대방 좌석 (딜러 버튼, 베팅액, 미니 카드)
- 사이드바 (힌트/족보/기록/채팅)
- 이모지 플로팅 애니메이션
- 승리 confetti

---

## 멀티플레이 확장 로드맵

- [ ] 토너먼트 모드
- [ ] 친구 초대 링크
- [ ] 프로필 / 아바타
- [ ] 칩 충전 (일일 보너스)
- [ ] 리더보드
