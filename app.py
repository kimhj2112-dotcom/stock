from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import firebase_admin
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from firebase_admin import auth, credentials, db
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from analysis import analyze_quotes


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DEFAULT_FIREBASE_DATABASE_URL = (
    "https://stock-database-5c0c9-default-rtdb.asia-southeast1.firebasedatabase.app"
)
SESSION_COOKIE_NAME = "stock_session"
SESSION_DURATION = timedelta(days=5)
SESSION_DURATION_SECONDS = int(SESSION_DURATION.total_seconds())
DEFAULT_SYMBOLS = ["MSFT", "AAPL", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "AMD", "CRM", "PLTR"]
FIREBASE_APP_NAME = "stock-api"

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("stock-api")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Global Stock Watch API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.mount("/css", StaticFiles(directory=BASE_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")


def firebase_credentials_configured() -> bool:
    return bool(os.getenv("FIREBASE_SERVICE_ACCOUNT") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))


def get_firebase_app():
    if not firebase_credentials_configured():
        raise RuntimeError("Firebase service account is not configured")

    try:
        return firebase_admin.get_app(FIREBASE_APP_NAME)
    except ValueError:
        account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT")
        if account_json:
            service_account = json.loads(account_json)
            credential = credentials.Certificate(service_account)
        else:
            credential = credentials.Certificate(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])

        return firebase_admin.initialize_app(
            credential,
            {"databaseURL": os.getenv("FIREBASE_DATABASE_URL", DEFAULT_FIREBASE_DATABASE_URL)},
            name=FIREBASE_APP_NAME,
        )


def normalize_phone_number(value: str) -> str | None:
    phone = value.strip()
    if phone.startswith("+"):
        international = "+" + re.sub(r"\D", "", phone[1:])
        return international if re.fullmatch(r"\+[1-9]\d{7,14}", international) else None

    local = re.sub(r"\D", "", phone)
    if not re.fullmatch(r"0\d{8,10}", local):
        return None
    return f"+82{local[1:]}"


def fallback_quote(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "name": symbol,
        "price": "0.00",
        "change": "+0.00%",
        "changeValue": 0,
        "chart": [10, 11, 10, 12, 11, 13, 12, 14],
        "chartLabels": [],
        "marketState": "CLOSED",
        "fallback": True,
    }


async def fetch_quote(client: httpx.AsyncClient, symbol: str) -> dict:
    encoded_symbol = quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_symbol}"
    response = await client.get(url, params={"range": "1mo", "interval": "1d"})
    response.raise_for_status()
    payload = response.json()
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise ValueError("No chart data found")

    meta = result.get("meta") or {}
    quote_data = (result.get("indicators", {}).get("quote") or [{}])[0]
    timestamps = result.get("timestamp") or []
    closes = []
    dates = []

    for index, value in enumerate(quote_data.get("close") or []):
        if not isinstance(value, (int, float)):
            continue
        timestamp = timestamps[index] if index < len(timestamps) else 0
        closes.append(float(value))
        dates.append(datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat())

    if not closes:
        raise ValueError("No close data found")

    last = closes[-1]
    previous = closes[-2] if len(closes) > 1 else last
    change = meta.get("regularMarketChangePercent")
    if not isinstance(change, (int, float)):
        change = ((last - previous) / (previous or 1)) * 100

    return {
        "symbol": symbol,
        "name": meta.get("shortName") or meta.get("longName") or symbol,
        "price": f"{last:.2f}",
        "change": f"{change:+.2f}%",
        "changeValue": float(change),
        "chart": closes[-20:],
        "chartLabels": dates[-20:],
        "marketState": meta.get("marketState", "CLOSED"),
        "fallback": False,
    }


async def load_quotes(symbols: list[str]) -> list[dict]:
    async with httpx.AsyncClient(
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        timeout=12,
    ) as client:
        async def load_one(symbol: str) -> dict:
            try:
                return await fetch_quote(client, symbol)
            except Exception as error:
                logger.info("Quote fallback for %s: %s", symbol, type(error).__name__)
                return fallback_quote(symbol)

        return await asyncio.gather(*(load_one(symbol) for symbol in symbols))


def parse_symbols(raw_symbols: str | None) -> list[str]:
    raw = raw_symbols if raw_symbols is not None else ",".join(DEFAULT_SYMBOLS)
    symbols = [symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()]
    return list(dict.fromkeys(symbols or DEFAULT_SYMBOLS))


def auth_error_message(error: Exception) -> tuple[int, str]:
    code = getattr(error, "code", "")
    known_errors = {
        "email-already-exists": (409, "이미 가입된 이메일입니다."),
        "phone-number-already-exists": (409, "이미 등록된 전화번호입니다."),
        "ALREADY_EXISTS": (409, "이미 등록된 이메일 또는 전화번호입니다. 아래 로그인 링크를 이용해 주세요."),
        "already-exists": (409, "이미 등록된 이메일 또는 전화번호입니다. 아래 로그인 링크를 이용해 주세요."),
        "invalid-email": (400, "이메일 주소를 확인해 주세요."),
        "invalid-phone-number": (400, "전화번호를 확인해 주세요."),
        "invalid-password": (400, "비밀번호는 8자 이상 입력해 주세요."),
    }
    return known_errors.get(code, (503, "Firebase 설정을 확인해 주세요."))


@app.exception_handler(RateLimitExceeded)
async def rate_limit_error(request: Request, error: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"ok": False, "message": "요청이 많습니다. 잠시 후 다시 시도해 주세요."},
    )


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/auth/signup")
@limiter.limit("5/15minutes")
def signup(request: Request, payload: dict):
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    phone_number = normalize_phone_number(str(payload.get("phone", "")))

    if len(name) < 2 or len(name) > 40:
        return JSONResponse(status_code=400, content={"ok": False, "message": "회원 이름은 2자 이상 40자 이하로 입력해 주세요."})
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return JSONResponse(status_code=400, content={"ok": False, "message": "이메일 주소를 확인해 주세요."})
    if not phone_number:
        return JSONResponse(status_code=400, content={"ok": False, "message": "전화번호를 확인해 주세요. 예: 010-1234-5678"})
    if len(password) < 8 or len(password) > 128:
        return JSONResponse(status_code=400, content={"ok": False, "message": "비밀번호는 8자 이상 128자 이하로 입력해 주세요."})
    if not firebase_credentials_configured():
        return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 서비스 계정 설정이 필요합니다."})

    firebase_app = None
    user = None
    try:
        firebase_app = get_firebase_app()
        user = auth.create_user(
            display_name=name,
            email=email,
            password=password,
            phone_number=phone_number,
            app=firebase_app,
        )
        db.reference(f"users/{user.uid}", app=firebase_app).set(
            {
                "uid": user.uid,
                "name": name,
                "email": email,
                "phoneNumber": phone_number,
                "createdAt": {".sv": "timestamp"},
            }
        )
        return JSONResponse(status_code=201, content={"ok": True, "uid": user.uid, "message": "회원가입이 완료되었습니다."})
    except Exception as error:
        if user and firebase_app:
            try:
                auth.delete_user(user.uid, app=firebase_app)
            except Exception as cleanup_error:
                logger.error("Firebase signup rollback failed: %s", getattr(cleanup_error, "code", type(cleanup_error).__name__))
        status, message = auth_error_message(error)
        logger.error("Firebase signup failed: %s", getattr(error, "code", type(error).__name__))
        return JSONResponse(status_code=status, content={"ok": False, "message": message})


@app.post("/api/auth/login")
@limiter.limit("10/15minutes")
async def login(request: Request, payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    web_api_key = os.getenv("FIREBASE_WEB_API_KEY")

    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not password:
        return JSONResponse(status_code=400, content={"ok": False, "message": "이메일과 비밀번호를 확인해 주세요."})
    if not web_api_key or not firebase_credentials_configured():
        return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 로그인 설정을 확인해 주세요."})

    endpoint = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={quote(web_api_key, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(endpoint, json={"email": email, "password": password, "returnSecureToken": True})
        result = response.json()
        if response.is_error:
            error_code = (result.get("error") or {}).get("message", "")
            if error_code == "TOO_MANY_ATTEMPTS_TRY_LATER":
                return JSONResponse(status_code=429, content={"ok": False, "message": "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."})
            if error_code in {"EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"}:
                return JSONResponse(status_code=401, content={"ok": False, "message": "이메일 또는 비밀번호를 확인해 주세요."})
            return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 로그인 설정을 확인해 주세요."})

        session_cookie = auth.create_session_cookie(
            result["idToken"],
            expires_in=SESSION_DURATION,
            app=get_firebase_app(),
        )
        response = JSONResponse(content={"ok": True, "message": "로그인되었습니다."})
        response.set_cookie(
            SESSION_COOKIE_NAME,
            session_cookie,
            max_age=SESSION_DURATION_SECONDS,
            httponly=True,
            secure=os.getenv("NODE_ENV") == "production",
            samesite="lax",
            path="/",
        )
        return response
    except Exception as error:
        logger.error("Firebase login failed: %s", type(error).__name__)
        return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 로그인 설정을 확인해 주세요."})


@app.get("/api/auth/session")
def auth_session(request: Request, response: JSONResponse):
    session_cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_cookie:
        return {"authenticated": False}
    try:
        session = auth.verify_session_cookie(session_cookie, check_revoked=True, app=get_firebase_app())
        return {
            "authenticated": True,
            "user": {
                "uid": session["uid"],
                "email": session.get("email", ""),
                "name": session.get("name", ""),
            },
        }
    except Exception:
        response.delete_cookie(SESSION_COOKIE_NAME, httponly=True, samesite="lax", path="/")
        return {"authenticated": False}


@app.post("/api/auth/logout")
def logout(response: JSONResponse):
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=os.getenv("NODE_ENV") == "production",
        samesite="lax",
        path="/",
    )
    return {"ok": True, "message": "로그아웃되었습니다."}


@app.post("/api/comments")
def create_comment(payload: dict):
    if payload.get("website"):
        return JSONResponse(status_code=202, content={"ok": True})

    ticker = str(payload.get("ticker", "")).strip().upper()
    name = str(payload.get("name", "")).strip()[:40] or "익명"
    comment = str(payload.get("comment", "")).strip()
    if not re.fullmatch(r"[A-Z][A-Z0-9.^-]{0,14}", ticker):
        return JSONResponse(status_code=400, content={"ok": False, "message": "종목 정보를 확인해 주세요."})
    if len(comment) < 2 or len(comment) > 1000:
        return JSONResponse(status_code=400, content={"ok": False, "message": "코멘트는 2자 이상 1,000자 이하로 입력해 주세요."})
    if not firebase_credentials_configured():
        return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 서비스 계정 설정이 필요합니다."})

    try:
        db.reference(f"comments/{ticker}", app=get_firebase_app()).push().set(
            {"ticker": ticker, "name": name, "comment": comment, "createdAt": {".sv": "timestamp"}}
        )
        return JSONResponse(status_code=201, content={"ok": True, "message": "코멘트를 등록했습니다."})
    except Exception as error:
        logger.error("Firebase comment save failed: %s", type(error).__name__)
        return JSONResponse(status_code=503, content={"ok": False, "message": "Firebase 저장 설정을 확인해 주세요."})


async def quote_response(symbols: str | None) -> dict:
    items = await load_quotes(parse_symbols(symbols))
    return {"items": items, "analysis": analyze_quotes(items)}


@app.get("/api/quotes")
async def quotes(symbols: str | None = None):
    return await quote_response(symbols)


@app.get("/api/analysis")
async def market_analysis(symbols: str | None = None):
    return (await quote_response(symbols))["analysis"]


@app.get("/api/stock")
async def stock(symbol: str = "MSFT"):
    normalized = symbol.strip().upper()
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, timeout=12
        ) as client:
            item = await fetch_quote(client, normalized)
        return {"item": item}
    except Exception as error:
        return JSONResponse(status_code=502, content={"ok": False, "message": f"시세를 가져오지 못했습니다: {type(error).__name__}"})


@app.get("/login")
def login_page():
    return FileResponse(BASE_DIR / "login.html")


@app.get("/signup")
def signup_page():
    return FileResponse(BASE_DIR / "signup.html")


@app.get("/")
def dashboard_page():
    return FileResponse(BASE_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "3001")))