const axios = require('axios');

const BASE = 'https://unprecedented-designedly-buddy.ngrok-free.dev';

// FULL Naver API URL persis seperti dari Network tab
const NAVER_URL =
  'https://search.shopping.naver.com/ns/v1/search/paged-composite-cards' +
  '?cursor=1&pageSize=50&query=iphone' +
  '&searchMethod=all.basic' +
  '&isFreshCategory=false' +
  '&isOriginalQuerySearch=false' +
  '&isCatalogDiversifyOff=false' +
  '&listPage=1' +
  '&categoryIdsForPromotions=50000204' +
  '&categoryIdsForPromotions=50000205' +
  '&categoryIdsForPromotions=50000209' +
  '&hiddenNonProductCard=true' +
  '&hasMoreAd=true' +
  '&hasMore=true' +
  '&score=4.8%7C5';

// helper delay
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// delay acak “lebih manusiawi”
// sukses  : 1.5s – 4s
// gagal   : 3s – 7s (kasih jeda lebih panjang biar keliatan "istirahat" setelah error)
function randomBetween(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

async function run() {
  const TOTAL = 1000;
  let success = 0;
  let fail = 0;
  let totalTime = 0;

  for (let i = 0; i < TOTAL; i++) {
    const start = Date.now();
    try {
      const res = await axios.get(BASE + '/naver', {
        params: {
          // KIRIM FULL URL SEBAGAI SATU PARAM "url"
          url: NAVER_URL,
        },
        timeout: 20000,
      });

      const ms = Date.now() - start;
      totalTime += ms;
      success++;

      const cardsLen =
        res.data?.data?.data?.data?.length ??
        res.data?.data?.data?.length ??
        'n/a';

      console.log(`#${i + 1} OK in ${ms}ms, cards:`, cardsLen);

      // delay random setelah sukses
      const delay = randomBetween(1500, 4000);
      await sleep(delay);
    } catch (err) {
      const ms = Date.now() - start;
      totalTime += ms;
      fail++;

      const status = err.response?.status;
      console.log(
        `#${i + 1} ERROR in ${ms}ms: status=${status}, msg=${err.message}`
      );

      if (err.response?.data) {
        console.dir(err.response.data, { depth: 1 });
      }

      // delay random setelah error
      const delay = randomBetween(3000, 7000);
      await sleep(delay);
    }
  }

  console.log('==== SUMMARY ====');
  console.log('Total:', TOTAL);
  console.log('Success:', success);
  console.log('Fail:', fail);
  console.log('Error rate:', (fail / TOTAL) * 100, '%');
  console.log('Avg latency:', totalTime / TOTAL, 'ms');
}

run();
