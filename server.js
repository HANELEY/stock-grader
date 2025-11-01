// server.js - simple proxy + lookup for Stock Grader Live
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;

// load tickers mapping
let tickers = {};
try {
  tickers = JSON.parse(fs.readFileSync(path.join(__dirname, 'tickers.json'), 'utf8'));
} catch (e) {
  console.warn('tickers.json load error', e.message);
}

// Lookup endpoint: returns name if in mapping, else null
app.get('/api/lookup', (req, res) => {
  const q = (req.query.symbol || '').toString().trim().toUpperCase();
  if (!q) return res.status(400).json({ error: 'symbol required' });
  const clean = q.replace(/\s+/g, '');
  const entry = tickers[clean] || tickers[clean.replace('.KL','')];
  if (entry) return res.json({ found: true, symbol: clean, name: entry.name, exchange: entry.exchange });
  return res.json({ found: false });
});

// Quote endpoint: fetches from Yahoo Finance v7 quote endpoint
app.get('/api/quote', async (req, res) => {
  const q = (req.query.symbol || '').toString().trim().toUpperCase();
  if (!q) return res.status(400).json({ error: 'symbol required' });
  try {
    // Use Yahoo query1 finance quote
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(q);
    const r = await axios.get(url, { timeout: 10000 });
    const result = (r.data && r.data.quoteResponse && r.data.quoteResponse.result && r.data.quoteResponse.result[0]) || null;
    if (!result) return res.status(404).json({ error: 'not found' });

    // Basic grading logic (customizable)
    const pe = result.trailingPE || result.forwardPE || null;
    const eps = result.epsTrailingTwelveMonths || null;
    const volume = result.regularMarketVolume || null;
    const marketCap = result.marketCap || null;
    let score = 50;
    if (pe && pe > 0) score += Math.max(-20, Math.round((30 - Math.min(pe,100)) / 3));
    if (eps) score += Math.max(-15, Math.round(Math.min(eps,10) * 2));
    if (marketCap) score += Math.min(15, Math.round(Math.log10(marketCap || 1) - 6));
    score = Math.max(0, Math.min(100, score));
    let grade = 'F';
    if (score >= 85) grade = 'A'; else if (score >= 70) grade = 'B'; else if (score >= 55) grade = 'C'; else if (score >= 40) grade = 'D';

    const response = {
      symbol: result.symbol || q,
      name: result.longName || result.shortName || null,
      exchange: result.fullExchangeName || null,
      currency: result.currency || null,
      price: result.regularMarketPrice || null,
      change: result.regularMarketChangePercent || null,
      pe: pe,
      eps: eps,
      volume: volume,
      marketCap: marketCap,
      grade: grade,
      score: score
    };
    res.json(response);
  } catch (err) {
    console.error('quote error', err.message);
    res.status(500).json({ error: 'fetch error', details: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
  console.log('Stock Grader Live server listening on port', PORT);
});
