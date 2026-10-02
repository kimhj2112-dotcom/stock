const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

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

  const endpoint = process.env.GOOGLE_SHEETS_WEB_APP_URL;
  const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (!endpoint || !secret) {
    return res.status(503).json({ ok: false, message: 'Google Sheets 저장 서비스가 아직 설정되지 않았습니다.' });
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: normalizedTicker,
        name: normalizedName,
        comment: normalizedComment,
        secret
      }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Google Sheets rejected the comment');
    res.status(201).json({ ok: true, message: '코멘트를 등록했습니다.' });
  } catch (error) {
    console.error('Google Sheets comment save failed:', error.message);
    res.status(502).json({ ok: false, message: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
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

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Stock backend running on http://localhost:${PORT}`);
});
