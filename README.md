# Global Stock Watch

해외 대형주 급등 후 조정 종목을 한눈에 보는 웹 대시보드입니다.

## 프로젝트 구성

- `index.html`: 메인 프론트엔드 화면
- `server.js`: Express 기반 백엔드 API 서버
- `package.json`: 실행 스크립트와 의존성

## 실행 방법

1. 의존성 설치
   ```bash
   npm install
   ```

2. 서버 실행
   ```bash
   npm start
   ```

3. 브라우저 접속
   ```text
   http://localhost:3001
   ```

## 제공 기능

- 시가총액 기준 해외 종목 목록
- 최근 급등 후 조정 종목 필터링
- 검색 기능
- 종목 상세 차트 모달
- AI/Cloud/Semis 테마 구분
- 시장 요약 및 신호 카드
- Yahoo Finance 기반 시세 연동

## 참고

- API 호출은 서버에서 처리하여 CORS 및 보안 측면을 보완합니다.
- Yahoo Finance 응답이 제한되면 fallback 데이터가 사용됩니다.
