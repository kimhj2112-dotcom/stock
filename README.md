# Global Stock Watch

해외 대형주 급등 후 조정 종목을 한눈에 보는 웹 대시보드입니다.

## 프로젝트 구성

- `index.html`: 화면 구조 및 리소스 연결
- `login.html`: 로그인 화면 (`/login`)
- `signup.html`: 회원가입 화면 (`/signup`)
- `css/app.css`: 화면 스타일
- `css/login.css`: 로그인 화면 스타일
- `css/signup.css`: 회원가입 화면 스타일
- `js/app.js`: 대시보드 동작과 브라우저 로직
- `js/login.js`: Firebase 로그인 화면 연동
- `js/signup.js`: 회원가입 화면 입력 검증과 API 요청
- `app.py`: FastAPI/Firebase 백엔드 API
- `analysis.py`: 종목 시세 집계·분석
- `run-python.js`: npm 명령용 Python 서버 실행기
- `requirements.txt`: Python 의존성
- `package.json`: 실행 스크립트와 의존성

## 실행 방법

1. 의존성 설치
   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r requirements.txt
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

`npm start`는 Python FastAPI 백엔드를 실행합니다. 가상환경 경로를 자동으로 찾지 못하는 환경에서는 `PYTHON_EXECUTABLE`에 `.venv`의 Python 실행 파일 경로를 지정하세요.

## 종목 코멘트 Firebase 연동

코멘트는 Realtime Database의 `comments/{티커}/{pushId}` 경로에 저장됩니다. 서버는 Firebase Admin SDK로 접근하므로 브라우저에 관리자 키를 노출하지 않습니다.

1. Firebase Console에서 Realtime Database가 생성되어 있는지 확인합니다. 기본 URL은 `https://stock-database-5c0c9-default-rtdb.asia-southeast1.firebasedatabase.app`이며, 다른 DB를 쓰면 `FIREBASE_DATABASE_URL`로 덮어씁니다.
2. 프로젝트 설정의 **서비스 계정**에서 서버용 서비스 계정 키를 생성합니다. JSON 키 파일은 저장소 밖의 안전한 경로에 둡니다.
3. Realtime Database **규칙**에 [`database.rules.json`](database.rules.json)의 규칙을 적용합니다. Admin SDK 서버 요청은 이 클라이언트 규칙을 우회하며, 브라우저에서 직접 읽고 쓰는 것은 차단됩니다.
4. 서버 환경에 서비스 계정 경로를 설정하고 실행합니다.

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\firebase-service-account.json"
   $env:FIREBASE_DATABASE_URL = "https://stock-database-5c0c9-default-rtdb.asia-southeast1.firebasedatabase.app"
   npm.cmd start
   ```

서비스 계정 키 파일은 Git에 커밋하지 마세요. 자격 증명이 설정되지 않았거나 Firebase 접근에 실패하면 코멘트 저장 API는 오류를 반환합니다.

로컬 환경변수는 `.env`에서 읽습니다. `.env.example`을 참고해 서비스 계정 JSON의 경로를 지정하고, JSON 키 파일은 저장소 밖에 보관하세요. `.env`는 Git에서 제외됩니다.

## Firebase 인증

Firebase Console의 **Authentication > Sign-in method**에서 이메일/비밀번호 로그인을 활성화합니다. `/api/auth/signup`은 계정과 안전하게 해시된 비밀번호를 Firebase Authentication에 생성하고, 회원 이름·이메일·전화번호·가입 시각을 Realtime Database `users/{uid}` 프로필에 저장합니다. 국내 번호는 `+82` E.164 형식으로 변환합니다. 비밀번호 원문은 Realtime Database에 저장하지 않습니다. 가입 요청은 IP당 15분에 5회로 제한됩니다.

로그인은 Firebase Web API로 비밀번호를 확인한 뒤 5일 유효한 HttpOnly 세션 쿠키를 발급합니다. `.env`에 `FIREBASE_WEB_API_KEY`를 설정해야 합니다. 세션 확인은 `/api/auth/session`, 로그아웃은 `/api/auth/logout`입니다.

## Python API 및 분석

- `GET /api/quotes?symbols=MSFT,AAPL`: 시세 항목과 Python 요약 분석 반환
- `GET /api/analysis?symbols=MSFT,AAPL`: 상승·하락 수, 평균 변화율, 표준편차, 최고·최저 종목 반환
- `POST /api/auth/signup`, `POST /api/auth/login`: Firebase 사용자 및 세션 처리
- `GET /api/auth/session`, `POST /api/auth/logout`: 로그인 상태 처리
- `POST /api/comments`: Firebase Realtime Database에 종목 코멘트 저장

분석은 fallback 시세를 제외해 계산합니다. Python 분석 테스트는 `python -m unittest discover -s tests`로 실행합니다.

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
