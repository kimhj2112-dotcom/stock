const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
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
