// @name KKYS0
// @author mumu
// @version 3.0.0
// @description 完整版：UA 池、代理、速率限制、缓存、重试、Playwright 回退、隐藏标题与封面识别、多线路解析、OmniBox 嗅探集成
// @dependencies axios, cheerio, https-proxy-agent, playwright
// 注意：在你的运行环境中确保已提供 OmniBox 全局对象（sniffVideo/getVideoMediaInfo/addPlayHistory 等）

const runner = require("spider_runner");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

// ====== CONFIG ======
const DEFAULT_BASE = "https://www.kkys0.com";
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
];
const PROXY = ""; // e.g. "http://127.0.0.1:1080"
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRY = 3;
const CACHE_TTL = 10 * 60 * 1000;
const RATE_LIMIT = 1.0; // requests per second
const PLAYWRIGHT_HEADLESS = true;

// ====== UTIL ======
const cache = new Map();
function setCache(key, data, ttl = CACHE_TTL) { cache.set(key, { data, expire: Date.now() + ttl }); }
function getCache(key) { const e = cache.get(key); if (!e) return null; if (Date.now() > e.expire) { cache.delete(key); return null; } return e.data; }
function randUA() { return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeUrl(u, base = DEFAULT_BASE) { if (!u) return ""; try { return /^https?:\/\//i.test(u) ? u : new URL(u, base).href; } catch { return u; } }

let tokens = RATE_LIMIT;
let lastRefill = Date.now();
function refillTokens() {
  const now = Date.now();
  const delta = (now - lastRefill) / 1000;
  if (delta > 0) {
    tokens = Math.min(RATE_LIMIT, tokens + delta * RATE_LIMIT);
    lastRefill = now;
  }
}
async function acquireToken() {
  while (true) {
    refillTokens();
    if (tokens >= 1) { tokens -= 1; return; }
    await sleep(100);
  }
}

function createAxios() {
  const opts = {
    timeout: DEFAULT_TIMEOUT,
    headers: {
      "User-Agent": randUA(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Referer": DEFAULT_BASE,
      "Connection": "keep-alive"
    },
    maxRedirects: 5
  };
  if (PROXY) {
    const HttpsProxyAgent = require("https-proxy-agent");
    opts.httpsAgent = new HttpsProxyAgent(PROXY);
    opts.proxy = false;
  }
  return axios.create(opts);
}

async function fetchWithRetry(url) {
  let lastErr = null;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      await acquireToken();
      const client = createAxios();
      const res = await client.get(url);
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      return res.data;
    } catch (err) {
      lastErr = err;
      const wait = 300 * Math.pow(2, i) + Math.floor(Math.random() * 200);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function renderWithPlaywright(url) {
  const browser = await chromium.launch({ headless: PLAYWRIGHT_HEADLESS });
  const context = await browser.newContext({ userAgent: randUA() });
  const page = await context.newPage();
  page.on("dialog", async d => { try { await d.dismiss(); } catch(e){} });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    const name = `debug-kkys-render-${Date.now()}.html`;
    fs.writeFileSync(path.join(process.cwd(), name), html, "utf8");
    await browser.close();
    return html;
  } catch (e) {
    try { await browser.close(); } catch(e){}
    throw e;
  }
}

// ====== TITLE & COVER HELPERS ======
function isHiddenElement($el) {
  if (!$el || !$el.attr) return false;
  const style = ($el.attr("style") || "").replace(/\s+/g, "").toLowerCase();
  if (/display\s*:\s*none/.test(style)) return true;
  if (/visibility\s*:\s*hidden/.test(style)) return true;
  if (/opacity\s*:\s*0/.test(style)) return true;
  const cls = ($el.attr("class") || "").toLowerCase();
  if (/\b(hidden|hide|d-none|sr-only|visually-hidden)\b/.test(cls)) return true;
  return false;
}

function extractVisibleTitle($, titlesCollection) {
  if (!titlesCollection || titlesCollection.length === 0) return "";
  function isHiddenWithAncestors($node) {
    let cur = $node;
    for (let k = 0; k < 4 && cur && cur.length; k++) {
      if (isHiddenElement(cur)) return true;
      cur = cur.parent();
    }
    return false;
  }
  for (let i = titlesCollection.length - 1; i >= 0; i--) {
    const tEl = titlesCollection.eq(i);
    const txt = (tEl.text() || "").trim();
    if (!txt) continue;
    if (!isHiddenWithAncestors(tEl)) return txt;
  }
  for (let i = titlesCollection.length - 1; i >= 0; i--) {
    const txt = (titlesCollection.eq(i).text() || "").trim();
    if (txt) return txt;
  }
  return "";
}

function isPlaceholderUrl(u) {
  if (!u) return true;
  const s = String(u).toLowerCase();
  if (s.includes("logo_placeholder") || s.includes("placeholder") || s.includes("nonecover")) return true;
  if (s.includes("vf.dgmckj.com")) return true;
  return false;
}

function normalizeCoverUrl(u, origin) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return "https:" + u;
  if (/^\/?vod1\//i.test(u) || /\/vod\/cover\//i.test(u)) {
    const path = u.startsWith("/") ? u : "/" + u;
    return "https://vres.dgmckj.com" + path;
  }
  try { return new URL(u, origin).href; } catch (e) { return origin.replace(/\/$/, "") + (u.startsWith("/") ? u : "/" + u); }
}

function getCover($, $el, origin) {
  const imgs = $el.find("img");
  const candidates = [];
  imgs.each((i, im) => {
    const $im = $(im);
    const attrs = [
      $im.attr("data-original"),
      $im.attr("data-src"),
      $im.attr("src"),
      $im.attr("data-lazy"),
      $im.attr("data-lazy-src")
    ];
    for (const a of attrs) if (a && String(a).trim()) candidates.push(String(a).trim());
  });
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) { if (!seen.has(c)) { seen.add(c); uniq.push(c); } }
  for (let i = uniq.length - 1; i >= 0; i--) {
    const u = uniq[i];
    if (!isPlaceholderUrl(u)) return normalizeCoverUrl(u, origin);
  }
  if (uniq.length > 0) return normalizeCoverUrl(uniq[uniq.length - 1], origin);
  return "";
}

// ====== MULTI-SOURCE PARSER ======
function parseSourcesAndEpisodes($, origin) {
  const sources = [];
  const sourceEls = $(".source-list-box-main .source-item");
  const sourceLabels = [];
  sourceEls.each((i, s) => {
    const $s = $(s);
    const label = $s.find(".source-item-label").first().text().trim() || $s.text().trim();
    sourceLabels.push(label || `线路${i+1}`);
  });
  const episodeLists = $(".episode-list-box-main .episode-list");
  for (let i = 0; i < episodeLists.length; i++) {
    const idx = i;
    const label = sourceLabels[idx] || `线路${idx+1}`;
    const $list = episodeLists.eq(i);
    const eps = [];
    $list.find("a.episode-item").each((j, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const name = $a.text().trim() || $a.find("span").text().trim() || `第${j+1}集`;
      if (href) {
        let playUrl = href;
        try { playUrl = /^https?:\/\//i.test(href) ? href : new URL(href, origin).href; } catch (e) { playUrl = origin.replace(/\/$/, "") + (href.startsWith("/") ? href : "/" + href); }
        eps.push({ name, playId: playUrl });
      }
    });
    if (eps.length > 0) sources.push({ name: label, episodes: eps });
  }
  if (sources.length === 0) {
    const iframe = $("iframe").first().attr("src");
    if (iframe) {
      const playUrl = /^https?:\/\//i.test(iframe) ? iframe : new URL(iframe, origin).href;
      sources.push({ name: "播放入口", episodes: [{ name: "点击播放", playId: playUrl }] });
    }
  }
  return sources;
}

// ====== MEDIA EXTRACTION HELPERS ======
const MEDIA_RE = /https?:\/\/[^\s'"]+\.(m3u8|mp4)(\?[^'"\s]*)?/ig;
const BLOCK_RE = /\b(playSource|config)\s*[:=]\s*\{[\s\S]{0,2000}\}|\bfunction\s+gogogo\s*\([\s\S]{0,400}\}\s*/i;
const SRC_FIELD_RE = /(?:src|url)\s*[:=]\s*['"]([^'"]+)['"]/i;

function findMedia(text) {
  if (!text) return null;
  const m = text.match(MEDIA_RE);
  return m ? m[0] : null;
}

function extractMediaFromHtml(html, baseUrl) {
  if (!html) return null;
  const blockMatch = html.match(BLOCK_RE);
  if (blockMatch) {
    const block = blockMatch[0];
    const directInBlock = findMedia(block);
    if (directInBlock) return directInBlock;
    const srcMatch = block.match(SRC_FIELD_RE);
    if (srcMatch && srcMatch[1]) {
      const candidate = srcMatch[1].trim();
      try { return /^https?:\/\//i.test(candidate) ? candidate : new URL(candidate, baseUrl).href; } catch (e) { return candidate; }
    }
  }
  const directAll = findMedia(html);
  if (directAll) return directAll;
  const b64 = html.match(/(?:base64_decode|atob)\(['"]([A-Za-z0-9+/=]{50,})['"]\)/i);
  if (b64) {
    try {
      const txt = Buffer.from(b64[1], "base64").toString("utf8");
      const m2 = findMedia(txt);
      if (m2) return m2;
    } catch (e) {}
  }
  return null;
}

// ====== API METHODS ======
async function home() {
  return {
    class: [
      { type_id: "1", type_name: "电影" },
      { type_id: "2", type_name: "剧集" },
      { type_id: "3", type_name: "动漫" },
      { type_id: "4", type_name: "综艺" },
      { type_id: "6", type_name: "短剧" }
    ]
  };
}

async function category(params) {
  const cate = String(params.categoryId || "1").trim();
  const page = Number(params.page || 1);
  const path = page === 1 ? `/show/${cate}------.html` : `/show/${cate}-----${page}-2.html`;
  const url = normalizeUrl(path, DEFAULT_BASE);
  const cacheKey = `kkys:cat:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  await sleep(200 + Math.floor(Math.random() * 400));
  let html;
  try { html = await fetchWithRetry(url); } catch (e) { try { html = await renderWithPlaywright(url); } catch (err) { return { page, pagecount: 0, total: 0, list: [] }; } }
  const origin = (() => { try { const m = html.match(/<base\s+href=['"]([^'"]+)['"]/i); if (m) return m[1].replace(/\/$/, ""); const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return DEFAULT_BASE; } })();
  const $ = cheerio.load(html);
  const items = [];
  $(".module-item, .v-item, .video-item").each((i, el) => {
    const $el = $(el);
    const href = $el.find("a.v-item, a").first().attr("href");
    const titles = $el.find(".v-item-footer .v-item-title, .title");
    const title = extractVisibleTitle($, titles);
    const cover = getCover($, $el, origin);
    const remarks = $el.find(".v-item-bottom span, .meta, .time").first().text().trim() || "";
    if (href && title) {
      items.push({ vod_id: normalizeUrl(href, origin), vod_name: title, vod_pic: cover, vod_remarks: remarks });
    }
  });
  const result = { page, pagecount: 9999, total: items.length, list: items };
  setCache(cacheKey, result);
  return result;
}

async function detail(params) {
  const id = String(params.videoId || "").trim();
  if (!id) return { list: [] };
  const url = id.startsWith("http") ? id : normalizeUrl(id, DEFAULT_BASE);
  const cacheKey = `kkys:detail:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  await sleep(150 + Math.floor(Math.random() * 300));
  let html;
  try { html = await fetchWithRetry(url); } catch (e) { try { html = await renderWithPlaywright(url); } catch (err) { return { list: [] }; } }
  const $ = cheerio.load(html);
  const title = $("h1, .title").first().text().trim();
  const desc = $(".detail-desc p, .intro, .description").first().text().trim() || "";
  let cover = $("meta[property='og:image']").attr("content") || "";
  if (!cover) {
    const $detailPic = $(".detail-pic");
    if ($detailPic && $detailPic.length) cover = getCover($, $detailPic, url);
  }
  if (!cover) {
    const firstImg = $("img").first().attr("src") || $("img").first().attr("data-original") || "";
    cover = normalizeCoverUrl(firstImg, url);
  }
  cover = cover || "";
  const origin = (() => { try { const m = html.match(/<base\s+href=['"]([^'"]+)['"]/i); if (m) return m[1].replace(/\/$/, ""); const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return DEFAULT_BASE; } })();
  const vod_play_sources = parseSourcesAndEpisodes($, origin);
  if (!vod_play_sources || vod_play_sources.length === 0) {
    const episodes = [];
    $(".episode-list-box-main .episode-list a.episode-item").each((i, el) => {
      const href = $(el).attr("href");
      const name = $(el).text().trim() || `第${i+1}集`;
      if (href) episodes.push({ name, playId: normalizeUrl(href, origin) });
    });
    if (episodes.length > 0) vod_play_sources.push({ name: "播放列表", episodes });
  }
  const result = { list: [{ vod_id: url, vod_name: title, vod_pic: cover, vod_content: desc, vod_play_sources }] };
  setCache(cacheKey, result);
  return result;
}

async function search(params) {
  const wd = String(params.keyword || "").trim();
  const page = Number(params.page || 1);
  if (!wd) return { page, pagecount: 0, total: 0, list: [] };
  const url = `${DEFAULT_BASE}/search/${encodeURIComponent(wd)}-----${page}-2.html`;
  const cacheKey = `kkys:search:${wd}:${page}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  await sleep(200 + Math.floor(Math.random() * 300));
  let html;
  try { html = await fetchWithRetry(url); } catch (e) { try { html = await renderWithPlaywright(url); } catch (err) { return { page, pagecount: 0, total: 0, list: [] }; } }
  const $ = cheerio.load(html);
  const items = [];
  $(".module-item, .v-item, .video-item").each((i, el) => {
    const $el = $(el);
    const href = $el.find("a.v-item, a").first().attr("href");
    const titles = $el.find(".v-item-footer .v-item-title, .title");
    const title = extractVisibleTitle($, titles);
    const origin = (() => { try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return DEFAULT_BASE; } })();
    const cover = getCover($, $el, origin);
    const remarks = $el.find(".v-item-bottom span, .meta, .time").first().text().trim() || "";
    if (href && title) items.push({ vod_id: normalizeUrl(href, origin), vod_name: title, vod_pic: cover, vod_remarks: remarks });
  });
  const result = { page, pagecount: 9999, total: items.length, list: items };
  setCache(cacheKey, result);
  return result;
}

async function play(params) {
  const playId = String(params.playId || "").trim();
  if (!playId) throw new Error("playId 不能为空");

  try {
    const html = await fetchWithRetry(playId);
    const m = html.match(/https?:\/\/[^\s'"]+\.(m3u8|mp4)(\?[^'"\s]*)?/i);
    if (m) return { urls: [{ name: "直链播放", url: m[0] }], flag: "play", header: { "User-Agent": randUA(), "Referer": DEFAULT_BASE }, parse: 0 };

    const cfgMatch = html.match(/player\s*[:=]\s*(\{[\s\S]{0,2000}\})/i) || html.match(/var\s+player\s*=\s*(\{[\s\S]{0,2000}\})/i);
    if (cfgMatch) {
      try {
        const cfg = eval("(" + cfgMatch[1] + ")");
        const cand = cfg.file || cfg.src || cfg.url || cfg.play;
        if (cand) { const u = Array.isArray(cand) ? cand[0] : cand; return { urls: [{ name: "直链播放", url: normalizeUrl(u) }], flag: "play", header: { "User-Agent": randUA(), "Referer": DEFAULT_BASE }, parse: 0 }; }
      } catch (e) {}
    }
  } catch (e) {
    try {
      const html = await renderWithPlaywright(playId);
      const m = html.match(/https?:\/\/[^\s'"]+\.(m3u8|mp4)(\?[^'"\s]*)?/i);
      if (m) return { urls: [{ name: "直链播放", url: m[0] }], flag: "play", header: { "User-Agent": randUA(), "Referer": DEFAULT_BASE }, parse: 0 };
    } catch (err) {}
  }

  return { urls: [{ name: "嗅探播放", url: playId }], flag: "play", header: { "User-Agent": randUA(), "Referer": DEFAULT_BASE }, parse: 1 };
}