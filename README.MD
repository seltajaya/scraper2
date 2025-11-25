**Naver Shopping scraper + proxy rotation**

---

# Naver Shopping Scraper (Proxy Rotation + Load Test)

Proyek kecil **Node.js/Express** untuk _scraping_ API pencarian **Naver Shopping** (`paged-composite-cards`) dengan fitur:

- Rotasi **proxy HTTP** (pool dari `.env`)
- **Cooldown** otomatis untuk proxy yang terkena HTTP `418` atau `429`
- **Throttling** (ritme request dibuat lebih pelan & acak)
- Pencatatan performa proxy ke file **`proxy-usage.log`**
- Script **load test** untuk mengirim sampai `1000` request ke endpoint `/naver`

API akan mengembalikan data **JSON** berisi:

- `meta` – info total hasil, cursor, `hasMore`
- `products` – list produk dengan field:

  - `id`
  - `name`
  - `price`
  - `imageUrl`
  - `productUrl`
  - `mallName`
  - `mallUrl`
  - `rating`
  - `reviewCount`
  - `isAd`
  - `isOverseaProduct`
  - `categories`

---

## Fitur

- ✅ Ditulis full dengan **JavaScript** (Node.js + Express)
- ✅ Mengambil data langsung dari **Naver Shopping API** (`paged-composite-cards`)
- ✅ Mendukung **proxy rotation** via `PROXY_LIST`
- ✅ Ada **cooldown per-proxy** ketika kena `418 (I'm a teapot)` atau `429 (Too Many Requests)`
- ✅ Ada **throttling** + delay acak biar ritme request lebih “manusiawi”
- ✅ Semua request (berhasil/gagal) dicatat ke **`proxy-usage.log`**
- ✅ Disertai script **`loadtest.js`** untuk simulasi 1000 request ke endpoint `/naver`

---

## Stack Teknologi

- [Node.js](https://nodejs.org/) – runtime
- [Express](https://expressjs.com/) – HTTP API server
- [Axios](https://axios-http.com/) – HTTP client ke Naver API
- [https-proxy-agent](https://github.com/TooTallNate/node-https-proxy-agent) – proxy support
- [dotenv](https://github.com/motdotla/dotenv) – konfigurasi environment
- (Opsional) [ngrok](https://ngrok.com/) – expose server lokal ke internet untuk keperluan load test remote

---

## Struktur Proyek

```text
.
├─ index.js        # Express server, proxy rotation, logging, throttling
├─ loadtest.js     # Script load test 1000 request ke /naver
├─ proxy-usage.log # (akan dibuat otomatis) log penggunaan proxy
└─ .env            # konfigurasi environment (PORT, PROXY_LIST, dll.)
```

### `index.js`

Tugas utama:

- Membaca konfigurasi proxy dari `.env` (`PROXY_LIST` atau PROXY_HOST/PORT/USER/PASS)

- Memilih proxy secara acak dari pool, dengan logika **cooldown**:

  - Jika proxy pernah kena `418`, ia “istirahat” selama `5 menit`
  - Jika kena `429`, cooldown `10 menit`

- Membangun header “fingerprint-like”:

  - `User-Agent` acak
  - `Accept-Language`
  - `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`
  - `Referer` diset ke halaman Naver Shopping

- Memvalidasi bahwa param `url` benar-benar mengarah ke endpoint:

  ```text
  https://search.shopping.naver.com/ns/v1/search/paged-composite-cards...
  ```

- Mengirim request ke Naver API via Axios + `HttpsProxyAgent`

- Memetakan respon nested Naver menjadi:

  ```js
  {
    meta: { total, cursor, hasMore },
    products: [ { ... } ]
  }
  ```

- Melakukan **throttling** dengan:

  ```js
  BASE_DELAY_MS = 3000;
  RANDOM_DELAY_MS = 4000;
  MAX_CONCURRENT = 1;
  ```

  sehingga setiap request diberi delay acak dan tidak paralel brutal.

- Mencatat setiap request ke **`proxy-usage.log`**:

  ```json
  {
    "time": "...",
    "proxy": "http://xxx.xxx.xxx.xxx:3129",
    "success": true,
    "status": 200,
    "errorCode": null,
    "note": "OK in 5234ms, products=50"
  }
  ```

### `loadtest.js`

Tugas utama:

- Mengirim **1000 request** ke server kamu (`/naver`) dengan base URL:

  ```js
  const BASE = "https://unprecedented-designedly-buddy.ngrok-free.dev";
  ```

  (bisa diganti ke `http://localhost:3000` kalau tidak pakai ngrok)

- Setiap request mengirim param:

  ```js
  params: {
    url: NAVER_URL, // FULL URL paged-composite-cards + query=iphone
  }
  ```

- Menghitung statistik:

  - `Total` request
  - `Success`
  - `Fail`
  - `Error rate`
  - `Avg latency` (rata-rata waktu per request)

- Menambahkan delay acak antar request:

  - Kalau **sukses** → delay 1.5–4 detik
  - Kalau **error** → delay 3–7 detik (seolah-olah lagi “cool down”)

---

## Persiapan

### 1. Prasyarat

- Node.js **versi 18+**
- npm atau yarn
- (Opsional) ngrok, kalau ingin load test dari URL publik

### 2. Install dependencies

```bash
npm install
```

Dependensi utama:

- `express`
- `axios`
- `cors`
- `https-proxy-agent`
- `dotenv`

---

## Konfigurasi `.env`

Buat file `.env` di root proyek:

```env
PORT=3000

# NYALAKAN PROXY (1 = pakai proxy, selain itu = direct)
USE_PROXY=1

# Pool proxy HTTP (dipisah koma, sudah include prefix http://)
PROXY_LIST=http://209.50.167.25:3129,http://216.26.249.212:3129,...

# Fallback jika PROXY_LIST kosong (opsional)
PROXY_HOST=
PROXY_PORT=
PROXY_USER=
PROXY_PASS=
PROXY_SCHEME=http
```

**Catatan:**

- Jika `USE_PROXY=0` atau tidak diset → semua request akan **direct** (tanpa proxy).
- `PROXY_LIST` bisa diisi hanya proxy yang sudah terbukti sukses (berdasarkan `proxy-usage.log` dari percobaan sebelumnya).

---

## Menjalankan Server

```bash
node index.js
```

Jika berhasil, akan muncul:

```text
Naver scraper API listening on port 3000
```

Endpoint healthcheck:

```bash
curl http://localhost:3000/
```

Respons:

```json
{
  "ok": true,
  "message": "Naver scraper API up & running"
}
```

---

## Cara Pakai API `/naver`

### Endpoint

`GET /naver`

### Query parameter

- `url` – **wajib**, full URL ke endpoint Naver `paged-composite-cards`
  (boleh sudah include semua query string: `cursor`, `pageSize`, `query`, dsb.)

Contoh:

```bash
curl "http://localhost:3000/naver?url=https://search.shopping.naver.com/ns/v1/search/paged-composite-cards?cursor=1&pageSize=50&query=iphone&searchMethod=all.basic&isFreshCategory=false&isOriginalQuerySearch=false&isCatalogDiversifyOff=false&listPage=1&hiddenNonProductCard=true&hasMoreAd=true&hasMore=true"
```

### Contoh respons (disederhanakan)

```json
{
  "success": true,
  "url": "https://search.shopping.naver.com/ns/v1/search/paged-composite-cards?...",
  "meta": {
    "total": 1234,
    "cursor": "2|50|...",
    "hasMore": true
  },
  "products": [
    {
      "id": "1234567890",
      "name": "Apple iPhone 15 Pro 256GB",
      "price": 1500000,
      "imageUrl": "https://shopping-phinf.pstatic.net/....jpg",
      "productUrl": "https://shopping.naver.com/.../1234567890",
      "mallName": "Some Mall",
      "mallUrl": "https://smartstore.naver.com/...",
      "rating": 4.8,
      "reviewCount": 1234,
      "isAd": true,
      "isOverseaProduct": false,
      "categories": ["50000000", "50000123", "50000234", "50000345"]
    }
  ]
}
```

Jika terjadi error (misalnya 418 / 429 / 5xx), server akan mengembalikan bentuk:

```json
{
  "success": false,
  "error": "Failed to fetch Naver API",
  "status": 418,
  "details": "Request failed with status code 418",
  "code": "ERR_BAD_RESPONSE",
  "note": "Naver sementara membatasi akses dari IP ini (HTTP 418). Biasanya terjadi jika terlalu banyak request, memakai VPN/proxy tertentu, atau pola akses terdeteksi sebagai bot."
}
```

---

## Menjalankan Load Test

### 1. Pastikan server jalan

```bash
node index.js
```

### 2. (Opsional) Expose dengan ngrok

Kalau di challenge kamu diminta kasih URL publik:

```bash
ngrok http 3000
```

Lalu copy URL yang muncul, misalnya:

```text
https://unprecedented-designedly-buddy.ngrok-free.dev
```

Masukkan ke `loadtest.js`:

```js
const BASE = "https://unprecedented-designedly-buddy.ngrok-free.dev";
```

Kalau hanya lokal, bisa ganti:

```js
const BASE = "http://localhost:3000";
```

### 3. Jalankan load test

```bash
node loadtest.js
```

Output (kurang lebih):

```text
#1 OK in 5123ms, cards: 50
#2 ERROR in 10342ms: status=418, msg=Request failed with status code 418
...
==== SUMMARY ====
Total: 1000
Success: 612
Fail: 388
Error rate: 38.8 %
Avg latency: 5678.12 ms
```

---

## Log Proxy (`proxy-usage.log`)

Setiap hit ke `/naver` akan menambah satu baris JSON di `proxy-usage.log`, misalnya:

```json
{"time":"2025-11-24T16:15:31.123Z","proxy":"http://209.50.167.25:3129","success":true,"status":200,"errorCode":null,"note":"OK in 5234ms, products=50"}
{"time":"2025-11-24T16:15:40.987Z","proxy":"http://216.26.249.212:3129","success":false,"status":418,"errorCode":"ERR_BAD_RESPONSE","note":"Naver sementara membatasi akses dari IP ini (HTTP 418). Biasanya terjadi jika terlalu banyak request, memakai VPN/proxy tertentu, atau pola akses terdeteksi sebagai bot."}
```

File ini bisa kamu pakai untuk:

- Menyaring proxy mana saja yang benar-benar **stabil**
- Menghapus proxy yang terlalu sering gagal dari `PROXY_LIST`
- Menunjukkan ke pewawancara bahwa kamu melakukan **observasi & tuning** berdasarkan data, bukan random feeling 😄

---

## Catatan & Batasan

- **Hanya untuk keperluan technical test / belajar.**
  Tetap patuhi Terms of Service Naver dan jangan spam request.
- Proxy publik/gratis biasanya tidak stabil (sering timeout, 403, 5xx).
  Wajar kalau **success rate** tidak sampai 100%.
- Walaupun sudah ada cooldown & throttling, IP/proxy bisa tetap diblock jika dipakai terlalu agresif.

---

## Lisensi

Proyek ini bebas digunakan untuk keperluan **coding challenge**, belajar, atau eksperimen pribadi.
Silakan fork, modifikasi, dan sesuaikan dengan kebutuhanmu.
