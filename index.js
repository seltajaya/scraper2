require('dotenv').config();
const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;


app.set('json spaces', 2);

// ====== LOG FILE PROXY ======
const LOG_FILE = path.join(__dirname, 'proxy-usage.log');

function logProxyUsage({ proxyUrl, success, status, errorCode, note }) {
  const time = new Date().toISOString();

  const line =
    JSON.stringify(
      {
        time,
        proxy: proxyUrl || null,
        success,
        status: status ?? null,
        errorCode: errorCode ?? null,
        note: note ?? null,
      }
    ) + '\n';

  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) {
      console.error('[log] Failed to write proxy log:', err.message);
    }
  });

  // update in-memory state  cooldown
  markProxyState(proxyUrl, { success, status });
}


// ====== 1. User-Agent & helper ======
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

function getRandomArrayItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomUserAgent() {
  return getRandomArrayItem(USER_AGENTS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====== 2. Proxy pool dari ENV ======
const rawProxyList = process.env.PROXY_LIST || '';
const proxyPool = rawProxyList
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

// ====== 2b. State per-proxy ======
const proxyState = new Map(); 

const COOLDOWN_418_MS = 5 * 60 * 1000; 
const COOLDOWN_429_MS = 10 * 60 * 1000; 

function markProxyState(proxyUrl, { success, status }) {
  if (!proxyUrl) return;

  const now = Date.now();
  const state =
    proxyState.get(proxyUrl) || {
      success: 0,
      fail: 0,
      last418: null,
      last429: null,
    };

  if (success) {
    state.success++;
  } else {
    state.fail++;
    if (status === 418) state.last418 = now;
    if (status === 429) state.last429 = now;
  }

  proxyState.set(proxyUrl, state);
}

function pickProxyFromPool() {
  if (proxyPool.length === 0) return null;
  const now = Date.now();

  const healthy = proxyPool.filter((p) => {
    const st = proxyState.get(p);
    if (!st) return true;

    if (st.last418 && now - st.last418 < COOLDOWN_418_MS) return false;
    if (st.last429 && now - st.last429 < COOLDOWN_429_MS) return false;

    return true;
  });

  const candidates = healthy.length > 0 ? healthy : proxyPool;
  return getRandomArrayItem(candidates);
}


// ====== 3. fingerprint headers ======
function buildRandomHeaders() {
  const acceptLanguages = [
    'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7',
  ];

  const secChUaList = [
    '"Chromium";v="130", "Not=A?Brand";v="24"',
    '"Google Chrome";v="130", "Chromium";v="130", "Not=A?Brand";v="24"',
  ];

  const secChUaMobile = ['?0', '?1'];
  const secChUaPlatform = ['"Windows"', '"macOS"', '"Linux"'];

  return {
    'User-Agent': getRandomUserAgent(),
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': getRandomArrayItem(acceptLanguages),
    Referer: 'https://search.shopping.naver.com/ns/search',

    'sec-ch-ua': getRandomArrayItem(secChUaList),
    'sec-ch-ua-mobile': getRandomArrayItem(secChUaMobile),
    'sec-ch-ua-platform': getRandomArrayItem(secChUaPlatform),

    Connection: 'keep-alive',
  };
}

// ====== 4. Axios client per request ======
function createHttpClientForRequest() {
  const useProxy = process.env.USE_PROXY === '1';

  if (!useProxy) {
    console.log('[http] Using direct connection (no proxy)');
    const client = axios.create({
      timeout: 10000,
      proxy: false,
    });
    return { client, proxyUrl: null };
  }

  let proxyUrl = null;

  if (proxyPool.length > 0) {
    proxyUrl = pickProxyFromPool(); 
  } else if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
    const scheme = process.env.PROXY_SCHEME || 'http';

    if (process.env.PROXY_USER && process.env.PROXY_PASS) {
      proxyUrl =
        `${scheme}://${process.env.PROXY_USER}:${process.env.PROXY_PASS}` +
        `@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
    } else {
      proxyUrl = `${scheme}://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
    }
  }

  if (!proxyUrl) {
    console.log('[http] Proxy config not found, using direct connection');
    const client = axios.create({
      timeout: 10000,
      proxy: false,
    });
    return { client, proxyUrl: null };
  }

  console.log('[http] Using proxy:', proxyUrl.replace(/:.+@/, ':****@'));
  const agent = new HttpsProxyAgent(proxyUrl);

  const client = axios.create({
    timeout: 10000,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
  });

  return { client, proxyUrl };
}


// ====== 5. Validator URL Naver API ======
function isValidNaverApiUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes('naver.com') &&
      u.pathname.includes('paged-composite-cards')
    );
  } catch (e) {
    return false;
  }
}

// ====== 6. Mapper: output produk ======
function mapNaverProducts(raw) {

  const inner = raw && raw.data ? raw.data : {};
  const cards = Array.isArray(inner.data) ? inner.data : [];

  const products = cards
    .map((item) => {
      const card = item && item.card ? item.card : {};
      const p = card.product || {};

      if (!p.nvMid && !p.productName) return null;

      const imagesArray =
        p.images ||
        p.productImages ||
        (Array.isArray(p.imageUrls)
          ? p.imageUrls.map((url) => ({ imageUrl: url }))
          : []);

      const firstImage =
        imagesArray && imagesArray[0]
          ? imagesArray[0].imageUrl || imagesArray[0].url
          : null;

      const productUrl =
        (p.productUrl && (p.productUrl.pcUrl || p.productUrl.mobileUrl)) ||
        null;

      const mallUrl =
        (p.mallUrl && (p.mallUrl.pcUrl || p.mallUrl.mobileUrl)) || null;

      return {
        id: p.nvMid || null,
        name: p.productName || null,
        price:
          p.discountedSalePrice ??
          p.salePrice ??
          p.lowPrice ??
          p.mobilePrice ??
          null,
        imageUrl: firstImage,
        productUrl,
        mallName: p.mallName || null,
        mallUrl,
        rating:
          typeof p.averageReviewScore === 'number'
            ? p.averageReviewScore
            : null,
        reviewCount:
          typeof p.totalReviewCount === 'number' ? p.totalReviewCount : 0,
        isAd: !!p.adId,
        isOverseaProduct: !!p.isOverseaProduct,
        categories: [p.lCatId, p.mCatId, p.sCatId, p.dCatId].filter(Boolean),
      };
    })
    .filter(Boolean);

  return {
    meta: {
      total: typeof inner.total === 'number' ? inner.total : products.length,
      cursor: inner.cursor ?? null,
      hasMore: !!inner.hasMore,
    },
    products,
  };
}

// ====== 7. Simple throttling (global concurrency) ======
let inFlight = 0;
const MAX_CONCURRENT = 1; 
const BASE_DELAY_MS = 3000; 
const RANDOM_DELAY_MS = 4000; 

async function throttle() {

  const delay = BASE_DELAY_MS + Math.random() * RANDOM_DELAY_MS;
  await sleep(delay);

  
  while (inFlight >= MAX_CONCURRENT) {
    await sleep(100);
  }
}

// ====== 8. Middleware dasar ======
app.use(cors());
app.use(express.json());

// ====== 9. Endpoint healthcheck ======
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Naver scraper API up & running' });
});

// ====== 10. Endpoint utama ======
app.get('/naver', async (req, res) => {
  const start = Date.now();

  let targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({
      success: false,
      error: 'Missing "url" query parameter',
      hint: 'Kirim param "url" yang berisi base Naver API, misalnya ...paged-composite-cards?cursor=1&pageSize=50&...',
    });
  }

  const extraParams = { ...req.query };
  delete extraParams.url;

  const extraKeys = Object.keys(extraParams);
  if (extraKeys.length > 0) {
    const qs = new URLSearchParams(extraParams).toString();
    if (qs) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + qs;
    }
  }

  if (!isValidNaverApiUrl(targetUrl)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Naver paged-composite-cards URL',
      hint: 'Pastikan "url" mengarah ke API paged-composite-cards di Naver.',
      targetUrl,
    });
  }

  await throttle();
  inFlight++;

  const { client, proxyUrl } = createHttpClientForRequest();

  try {
    const response = await client.get(targetUrl, {
      headers: buildRandomHeaders(),
    });

    const duration = Date.now() - start;
    console.log('[naver] OK in', duration, 'ms');

    const { meta, products } = mapNaverProducts(response.data);

    // LOG BERHASIL
    logProxyUsage({
      proxyUrl,
      success: true,
      status: 200,
      errorCode: null,
      note: `OK in ${duration}ms, products=${products.length}`,
    });

    return res.json({
      success: true,
      url: targetUrl,
      meta,
      products,
    });
  } catch (err) {
    const duration = Date.now() - start;
    console.error('[naver] ERROR in', duration, 'ms');
    console.error('Naver request error RAW:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
      address: err.address,
      port: err.port,
    });

    const status = err.response?.status || 500;
    const errorPayload = {
      success: false,
      error: 'Failed to fetch Naver API',
      status,
      details: err.message,
      code: err.code,
    };

    if (status === 429) {
      errorPayload.note =
        'Rate limited by Naver, coba kurangi kecepatan request atau gunakan proxy lain.';
    }

    if (status === 418) {
      errorPayload.note =
        'Naver sementara membatasi akses dari IP ini (HTTP 418). ' +
        'Biasanya terjadi jika terlalu banyak request, memakai VPN/proxy tertentu, atau pola akses terdeteksi sebagai bot.';
    }

    if (err.response?.data) {
      const data = err.response.data;
      if (typeof data === 'string' && data.trim().startsWith('<')) {
        errorPayload.naverResponse = data.slice(0, 5000); 
      } else {
        errorPayload.naverResponse = data;
      }
    }

    logProxyUsage({
      proxyUrl,
      success: false,
      status,
      errorCode: err.code,
      note: errorPayload.note || `ERROR in ${duration}ms`,
    });

    return res.status(status).json(errorPayload);
  } finally {
    inFlight--;
  }
});

// ====== 11. Start server ======
app.listen(PORT, () => {
  console.log(`Naver scraper API listening on port ${PORT}`);
});
