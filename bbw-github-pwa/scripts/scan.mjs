import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://fapi.binance.com';
const OUT = path.resolve('site/data');
const HOUR_MS = 60 * 60 * 1000;
const TZ_OFFSET_MS = 8 * HOUR_MS;
const MAX_HISTORY_RUNS = 30;
const CONCURRENCY = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Free-BBW-PWA-Scanner/1.0' } });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || (700 * (i + 1));
        await sleep(wait);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(350 * (i + 1));
    }
  }
  throw last;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); }
      catch (error) { results[i] = { error: String(error?.message || error) }; }
      await sleep(100);
    }
  });
  await Promise.all(workers);
  return results;
}

function bollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const values = closes.slice(-period);
  const mean = values.reduce((a, b) => a + b, 0) / period;
  if (!mean) return null;
  const variance = values.reduce((a, b) => a + ((b - mean) ** 2), 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + multiplier * sd;
  const lower = mean - multiplier * sd;
  return { middle: mean, upper, lower, width: ((upper - lower) / mean) * 100 };
}

function completedHourlyBars(raw, now) {
  return raw.filter(k => Number(k[6]) < now).map(k => ({
    openTime: Number(k[0]), closeTime: Number(k[6]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
  }));
}

function aggregateNHours(hourBars, n) {
  // Use the most recent complete N-hour groups, anchored backwards from the latest closed 1h bar.
  const count = Math.floor(hourBars.length / n);
  if (count < 20) return [];
  const usable = hourBars.slice(hourBars.length - count * n);
  const out = [];
  for (let i = 0; i < usable.length; i += n) {
    const group = usable.slice(i, i + n);
    out.push({
      openTime: group[0].openTime, closeTime: group[group.length - 1].closeTime,
      open: group[0].open,
      high: Math.max(...group.map(x => x.high)),
      low: Math.min(...group.map(x => x.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((a, x) => a + x.volume, 0)
    });
  }
  return out;
}

function ema(values, period) {
  if (values.length < period) return null;
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  let value = seed;
  for (let i = period; i < values.length; i++) value = values[i] * alpha + value * (1 - alpha);
  return value;
}

function getLocalDate(timestamp) {
  return new Date(timestamp + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function enrichStreaks(currentRows, priorRuns, type) {
  const today = getLocalDate(Date.now());
  const rows = currentRows.map(row => {
    const hitDates = new Set([today]);
    for (const run of priorRuns) {
      if (!run || !run.timestamp || getLocalDate(run.timestamp) === today) continue;
      const list = type === 'breakout' ? run.breakout : run.squeeze;
      if (Array.isArray(list) && list.some(x => x.symbol === row.symbol)) hitDates.add(getLocalDate(run.timestamp));
    }
    let streak = 0;
    const date = new Date(`${today}T00:00:00+08:00`).getTime();
    for (let d = 0; d < 90; d++) {
      const day = getLocalDate(date - d * 24 * HOUR_MS);
      if (hitDates.has(day)) streak++; else break;
    }
    return { ...row, streakDays: streak };
  });
  return rows;
}

await fs.mkdir(OUT, { recursive: true });
const now = Date.now();
console.log('Loading Binance USD-M perpetual market metadata and live prices...');
const [exchangeInfo, tickerPrices] = await Promise.all([
  getJson(`${BASE}/fapi/v1/exchangeInfo`),
  getJson(`${BASE}/fapi/v1/ticker/price`)
]);
const symbols = exchangeInfo.symbols
  .filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.symbol.endsWith('USDT'))
  .map(s => s.symbol);
const prices = new Map(tickerPrices.map(t => [t.symbol, +t.price]));
console.log(`Scanning ${symbols.length} USDT perpetual symbols...`);

const scanned = await pool(symbols, CONCURRENCY, async symbol => {
  const [hourRaw, dailyRaw] = await Promise.all([
    getJson(`${BASE}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=500`),
    getJson(`${BASE}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=260`)
  ]);
  const hourly = completedHourlyBars(hourRaw, now);
  const daily = dailyRaw.filter(k => Number(k[6]) < now).map(k => +k[4]);
  if (hourly.length < 400 || daily.length < 200) return { symbol, skipped: 'insufficient history' };
  const price = prices.get(symbol);
  if (!Number.isFinite(price) || price <= 0) return { symbol, skipped: 'no price' };
  const dailyEma = ema(daily, 200);
  const dailyMa = daily.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const spread = dailyMa ? ((dailyEma - dailyMa) / dailyMa) * 100 : null;
  const breakout = [];
  const squeeze = [];
  for (let hours = 1; hours <= 20; hours++) {
    const bars = aggregateNHours(hourly, hours);
    const closes = bars.map(b => b.close);
    const bb = bollinger(closes);
    if (!bb) continue;
    const deviation = ((price - bb.upper) / bb.upper) * 100;
    if (bb.width >= 50 && deviation > 0 && spread !== null && spread >= 2) {
      breakout.push({ symbol, hours, price, bbw: bb.width, deviation, dailyEma200: dailyEma, dailyMa200: dailyMa, dailySpread: spread });
    }
    if (((hours >= 1 && hours <= 5) || (hours >= 16 && hours <= 20)) && bb.width <= 2) {
      squeeze.push({ symbol, hours, price, bbw: bb.width, deviation, dailySpread: spread });
    }
  }
  return { symbol, breakout, squeeze };
});

let breakout = [];
let squeeze = [];
let failed = 0;
for (const item of scanned) {
  if (!item || item.error) { failed++; continue; }
  if (item.breakout) breakout.push(...item.breakout);
  if (item.squeeze) squeeze.push(...item.squeeze);
}
breakout.sort((a, b) => b.deviation - a.deviation);
squeeze.sort((a, b) => a.bbw - b.bbw);

let previous = { runs: [] };
try { previous = JSON.parse(await fs.readFile(path.join(OUT, 'history.json'), 'utf8')); } catch {}
const priorRuns = Array.isArray(previous.runs) ? previous.runs : [];
breakout = enrichStreaks(breakout, priorRuns, 'breakout');
squeeze = enrichStreaks(squeeze, priorRuns, 'squeeze');
const timestamp = Date.now();
const run = { timestamp, scannedSymbols: symbols.length, successfulSymbols: scanned.length - failed, failedSymbols: failed, breakout, squeeze };
const runs = [run, ...priorRuns.filter(r => r && Math.abs((r.timestamp || 0) - timestamp) > 2 * 60 * 60 * 1000)].slice(0, MAX_HISTORY_RUNS);
const latest = {
  version: 1,
  timestamp,
  timestampLocal: new Date(timestamp + TZ_OFFSET_MS).toISOString().replace('Z', '+08:00'),
  market: 'Binance USD-M USDT perpetual futures',
  rules: {
    bollingerPeriod: 20, standardDeviations: 2,
    breakout: 'BBW >= 50%, live price above upper band, daily EMA200 above MA200 by >= 2%; periods 1–20h; sorted by deviation descending.',
    squeeze: 'BBW <= 2%; periods 1–5h and 16–20h; sorted by BBW ascending.',
    dailyIndicatorsUseCompletedCandles: true,
    multiHourBars: 'Aggregated from complete 1h candles in consecutive N-hour groups anchored backwards from the latest closed 1h candle.'
  },
  scannedSymbols: symbols.length,
  successfulSymbols: symbols.length - failed,
  failedSymbols: failed,
  breakout,
  squeeze
};
await fs.writeFile(path.join(OUT, 'latest.json'), JSON.stringify(latest));
await fs.writeFile(path.join(OUT, 'history.json'), JSON.stringify({ version: 1, runs }));
console.log(`Done. Successful: ${latest.successfulSymbols}/${symbols.length}; breakout hits: ${breakout.length}; squeeze hits: ${squeeze.length}; failed: ${failed}`);
