require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const DEFAULT_FIREBASE_DATABASE_URL = 'https://stock-database-5c0c9-default-rtdb.asia-southeast1.firebasedatabase.app';
const SESSION_COOKIE_NAME = 'stock_session';
const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;
let firebaseDatabase;
const signupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }
});
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.' }
});

app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname));

const DEFAULT_SYMBOLS = ['MSFT', 'AAPL', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'AMD', 'CRM', 'PLTR'];

function buildYahooChartUrl(symbol) {
  const normalizedSymbol = decodeURIComponent(String(symbol || '')).trim().toUpperCase();
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}`);
  url.searchParams.set('range', '1mo');
  url.searchParams.set('interval', '1d');
  return url.toString();
}

function getFirebaseApp() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Firebase service account is not configured');
  }

  const existingApp = getApps().find(item => item.name === 'stock-api');
  if (existingApp) return existingApp;

  return initializeApp({
    credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_DATABASE_URL
  }, 'stock-api');
}

function normalizePhoneNumber(value) {
  const phone = String(value || '').trim();
  if (phone.startsWith('+')) {
    const international = `+${phone.slice(1).replace(/\D/g, '')}`;
    return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
  }

  const local = phone.replace(/\D/g, '');
  if (!/^0\d{8,10}$/.test(local)) return null;
  return `+82${local.slice(1)}`;
}

function readSessionCookie(req) {
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const entry = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function setSessionCookie(res, value) {
  res.cookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS
  });
}

async function fetchQuoteFromYahoo(symbol) {
  const normalizedSymbol = decodeURIComponent(String(symbol || '')).trim().toUpperCase();
  const url = buildYahooChartUrl(normalizedSymbol);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo API error for ${symbol}: ${response.status}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(`No chart data found for ${symbol}`);
  }

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp || [];
  const closes = [];
  const dates = [];
  (quote?.close || []).forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    closes.push(value);
    dates.push(new Date((timestamps[index] || 0) * 1000).toISOString().slice(0, 10));
  });

  if (!closes.length) {
    throw new Error(`No close data found for ${symbol}`);
  }

  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? last;
  const pct = meta.regularMarketChangePercent ?? ((last - prev) / (prev || 1)) * 100;

  return {
    symbol,
    name: meta.shortName || symbol,
    price: Number(last).toFixed(2),
    change: `${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%`,
    changeValue: Number(pct),
    chart: closes.slice(-20),
    chartLabels: dates.slice(-20),
    marketState: meta.marketState || 'CLOSED'
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/auth/signup', signupRateLimit, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const phoneNumber = normalizePhoneNumber(req.body?.phone);

  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ ok: false, message: '회원 이름은 2자 이상 40자 이하로 입력해 주세요.' });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: '이메일 주소를 확인해 주세요.' });
  }
  if (!phoneNumber) {
    return res.status(400).json({ ok: false, message: '전화번호를 확인해 주세요. 예: 010-1234-5678' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ ok: false, message: '비밀번호는 8자 이상 128자 이하로 입력해 주세요.' });
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return res.status(503).json({ ok: false, message: 'Firebase 서비스 계정 설정이 필요합니다.' });
  }

  try {
    const user = await getAuth(getFirebaseApp()).createUser({
      displayName: name,
      email,
      password,
      phoneNumber
    });
    res.status(201).json({ ok: true, uid: user.uid, message: '회원가입이 완료되었습니다.' });
  } catch (error) {
    const knownErrors = {
      'auth/email-already-exists': [409, '이미 가입된 이메일입니다.'],
      'auth/phone-number-already-exists': [409, '이미 등록된 전화번호입니다.'],
      'auth/invalid-email': [400, '이메일 주소를 확인해 주세요.'],
      'auth/invalid-phone-number': [400, '전화번호를 확인해 주세요.'],
      'auth/invalid-password': [400, '비밀번호는 8자 이상 입력해 주세요.']
    };
    const [status, message] = knownErrors[error.code] || [503, 'Firebase 설정을 확인해 주세요.'];
    console.error('Firebase signup failed:', error.code || 'unknown');
    res.status(status).json({ ok: false, message });
  }
});

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const webApiKey = process.env.FIREBASE_WEB_API_KEY;

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    return res.status(400).json({ ok: false, message: '이메일과 비밀번호를 확인해 주세요.' });
  }
  if (!webApiKey || (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return res.status(503).json({ ok: false, message: 'Firebase 로그인 설정을 확인해 주세요.' });
  }

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json();
    if (!response.ok) {
      const errorCode = result.error?.message;
      if (errorCode === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
        return res.status(429).json({ ok: false, message: '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.' });
      }
      if (['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED'].includes(errorCode)) {
        return res.status(401).json({ ok: false, message: '이메일 또는 비밀번호를 확인해 주세요.' });
      }
      throw new Error(errorCode || 'Firebase sign-in failed');
    }

    const sessionCookie = await getAuth(getFirebaseApp()).createSessionCookie(result.idToken, { expiresIn: SESSION_DURATION_MS });
    setSessionCookie(res, sessionCookie);
    res.json({ ok: true, message: '로그인되었습니다.' });
  } catch (error) {
    console.error('Firebase login failed:', error.message);
    res.status(503).json({ ok: false, message: 'Firebase 로그인 설정을 확인해 주세요.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  const sessionCookie = readSessionCookie(req);
  if (!sessionCookie) return res.json({ authenticated: false });

  try {
    const session = await getAuth(getFirebaseApp()).verifySessionCookie(sessionCookie, true);
    res.json({
      authenticated: true,
      user: { uid: session.uid, email: session.email || '', name: session.name || '' }
    });
  } catch {
    res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

app.post('/api/comments', async (req, res) => {
  const { ticker, name, comment, website } = req.body || {};
  if (website) return res.status(202).json({ ok: true });

  const normalizedTicker = String(ticker || '').trim().toUpperCase();
  const normalizedName = String(name || '').trim().slice(0, 40) || '익명';
  const normalizedComment = String(comment || '').trim();

  if (!/^[A-Z][A-Z0-9.^-]{0,14}$/.test(normalizedTicker)) {
    return res.status(400).json({ ok: false, message: '종목 정보를 확인해 주세요.' });
  }
  if (normalizedComment.length < 2 || normalizedComment.length > 1000) {
    return res.status(400).json({ ok: false, message: '코멘트는 2자 이상 1,000자 이하로 입력해 주세요.' });
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return res.status(503).json({ ok: false, message: 'Firebase 서비스 계정 설정이 필요합니다.' });
  }

  try {
    if (!firebaseDatabase) {
      firebaseDatabase = getDatabase(getFirebaseApp());
    }

    const commentRef = firebaseDatabase.ref(`comments/${normalizedTicker}`).push();
    await commentRef.set({
      ticker: normalizedTicker,
      name: normalizedName,
      comment: normalizedComment,
      createdAt: ServerValue.TIMESTAMP
    });
    res.status(201).json({ ok: true, message: '코멘트를 등록했습니다.' });
  } catch (error) {
    console.error('Firebase comment save failed:', error.message);
    res.status(503).json({ ok: false, message: 'Firebase 저장 설정을 확인해 주세요.' });
  }
});

app.get('/api/quotes', async (req, res) => {
  try {
    const rawSymbols = Array.isArray(req.query.symbols) ? req.query.symbols.join(',') : (req.query.symbols || DEFAULT_SYMBOLS.join(','));
    const symbols = rawSymbols
      .split(',')
      .map(s => decodeURIComponent(String(s || '')).trim().toUpperCase())
      .filter(Boolean);
    const uniqueSymbols = [...new Set(symbols.length ? symbols : DEFAULT_SYMBOLS)];

    const data = await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        try {
          return await fetchQuoteFromYahoo(symbol);
        } catch (error) {
          return {
            symbol,
            name: symbol,
            price: '0.00',
            change: '+0.00%',
            changeValue: 0,
            chart: [10, 11, 10, 12, 11, 13, 12, 14],
            marketState: 'CLOSED',
            fallback: true
          };
        }
      })
    );

    res.json({ items: data });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/api/stock', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'MSFT').trim().toUpperCase();
    const data = await fetchQuoteFromYahoo(symbol);
    res.json({ item: data });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Stock backend running on http://localhost:${PORT}`);
});
