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

## 종목 코멘트 Google Sheets 연동

1. 코멘트를 저장할 Google 스프레드시트에서 **확장 프로그램 > Apps Script**를 엽니다.
2. `google-apps-script/Code.gs`의 코드를 붙여넣고 저장합니다. `종목 코멘트` 시트가 없으면 첫 제출 때 자동 생성됩니다.
3. Apps Script **프로젝트 설정 > 스크립트 속성**에 `SPREADSHEET_ID`(스프레드시트 URL의 `/d/`와 `/edit` 사이 값)와 `SHARED_SECRET`(충분히 긴 임의 값)을 추가합니다.
4. **배포 > 새 배포 > 웹 앱**에서 실행 사용자를 본인으로, 액세스 권한을 모든 사용자로 설정해 배포합니다. 생성된 `/exec` URL을 사용합니다.
5. 서버를 실행하는 환경에 다음 환경변수를 설정합니다. 두 값은 브라우저 코드에 넣지 마세요.

   ```text
   GOOGLE_SHEETS_WEB_APP_URL=https://script.google.com/macros/s/.../exec
   GOOGLE_SHEETS_SHARED_SECRET=<Apps Script의 SHARED_SECRET과 같은 값>
   ```

   PowerShell 로컬 실행 예시:
   ```powershell
   $env:GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/.../exec"
   $env:GOOGLE_SHEETS_SHARED_SECRET = "<같은 비밀 값>"
   npm.cmd start
   ```

환경변수가 설정되지 않으면 코멘트는 저장되지 않으며 폼에 설정 안내가 표시됩니다.

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
