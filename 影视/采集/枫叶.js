// @name 枫叶
// @author 梦
// @description 影视站：支持首页、分类、详情、搜索与播放，基于 https://www.budaichuchen.net
// @dependencies cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/枫叶.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const https = require("https");
const http = require("http");

const BASE_URL = "https://www.budaichuchen.net";
const UA = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36";
const PAGE_LIMIT = 20;
const LIST_CACHE_TTL = Number(process.env.FENGYE_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.FENGYE_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.FENGYE_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "1", name: "电影" },
  { id: "2", name: "电视剧" },
  { id: "3", name: "综艺" },
  { id: "4", name: "动漫" },
  { id: "5", name: "短剧" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}, redirectCount = 0) {
  await OmniBox.log("info", `[枫叶][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  if ([301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 5) {
    const location = res?.headers?.location || res?.headers?.Location || res?.headers?.LOCATION;
    if (location) return requestText(absoluteUrl(location), options, redirectCount + 1);
  }
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return String(res.body || "");
}

async function requestTextNative(url, options = {}) {
  await OmniBox.log("info", `[枫叶][native-request] ${options.method || "GET"} ${url}`);
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = options.body == null ? "" : String(options.body);
    const headers = {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(options.headers || {}),
    };
    if (body && headers["Content-Length"] == null && headers["content-length"] == null) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const transport = requestUrl.protocol === "http:" ? http : https;
    const req = transport.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || (requestUrl.protocol === "http:" ? 80 : 443),
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode} @ ${url}`));
          return;
        }
        resolve(String(data || ""));
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout @ ${url}`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getCachedText(cacheKey, ttl, producer) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const value = String(await producer());
  try {
    await OmniBox.setCache(cacheKey, value, ttl);
  } catch (_) {}
  return value;
}

function absoluteUrl(url) {
  try {
    return new URL(String(url || ""), BASE_URL).toString();
  } catch (_) {
    return String(url || "");
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function categoryNameById(categoryId) {
  return CATEGORY_CONFIG.find((item) => item.id === String(categoryId))?.name || "影视";
}

function extractVodId(href) {
  const match = String(href || "").match(/detail\/(.*?)\.html/i);
  return match?.[1] || "";
}

function extractPlayId(href) {
  const match = String(href || "").match(/play\/(.*?)\.html/i);
  return match?.[1] || "";
}

function buildVodCard($, el) {
  const box = $(el);
  const a = box.find(".public-list-exp").first();
  const href = a.attr("href") || "";
  const vodId = extractVodId(href);
  if (!vodId) return null;
  const pic = box.find("img").first().attr("data-src") || box.find("img").first().attr("src") || "";
  return {
    vod_id: vodId,
    vod_name: normalizeText(a.attr("title") || ""),
    vod_pic: absoluteUrl(pic),
    vod_remarks: normalizeText(box.find(".public-list-prb").first().text()),
  };
}

function parseHomeList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $(".public-list-box").each((_, el) => {
    const item = buildVodCard($, el);
    if (!item?.vod_id || seen.has(item.vod_id)) return;
    seen.add(item.vod_id);
    list.push(item);
  });
  return list;
}

function parseSearchList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $(".search-box").each((_, el) => {
    const box = $(el);
    const a = box.find(".public-list-exp").first();
    const href = a.attr("href") || "";
    const vodId = extractVodId(href);
    if (!vodId || seen.has(vodId)) return;
    seen.add(vodId);
    const pic = a.find("img").first().attr("data-src") || a.find("img").first().attr("src") || "";
    list.push({
      vod_id: vodId,
      vod_name: normalizeText(box.find(".thumb-txt a").first().text()),
      vod_pic: absoluteUrl(pic),
      vod_remarks: normalizeText(a.find(".public-list-prb").first().text()),
    });
  });
  return list;
}

function parseDetail(htmlText, videoId) {
  const $ = cheerio.load(htmlText);
  const vodName = normalizeText($(".slide-info-title").first().text());
  const vodPic = absoluteUrl($(".detail-pic img").first().attr("data-src") || $(".detail-pic img").first().attr("src") || "");
  const vodContent = normalizeText($("#height_limit").first().text());

  const sourceNames = [];
  $(".anthology-tab a").each((_, el) => {
    const name = normalizeText($(el).text()).replace(/\s/g, "").replace(/\(\d+\)/g, "");
    if (name) sourceNames.push(name);
  });

  const playSources = [];
  $(".anthology-list-box").each((idx, el) => {
    const episodes = [];
    $(el).find("ul li a").each((__, a) => {
      const name = normalizeText($(a).text());
      const playId = extractPlayId($(a).attr("href") || "");
      if (!name || !playId) return;
      episodes.push({ name, playId });
    });
    episodes.reverse();
    if (episodes.length) {
      playSources.push({
        name: sourceNames[idx] || `线路${idx + 1}`,
        episodes,
      });
    }
  });

  if (!playSources.length) {
    const episodes = [];
    $(".anthology-list-play a").each((_, a) => {
      const name = normalizeText($(a).attr("title") || $(a).text());
      const playId = extractPlayId($(a).attr("href") || "");
      if (!name || !playId) return;
      episodes.push({ name, playId });
    });
    if (episodes.length) {
      playSources.push({ name: "播放列表", episodes });
    }
  }

  return {
    list: [{
      vod_id: String(videoId || ""),
      vod_name: vodName,
      vod_pic: vodPic,
      vod_content: vodContent,
      vod_play_sources: playSources,
    }],
  };
}

async function parsePlayPage(playUrl, html) {
  try {
    const playerMatch = html.match(/player_.*?=([^]*?)</);
    if (playerMatch?.[1]) {
      try {
        const config = JSON.parse(playerMatch[1]);
        const rawUrl = String(config.url || "");
        const from = String(config.from || "").toUpperCase();

        if (rawUrl.startsWith("http") && (rawUrl.includes(".m3u8") || rawUrl.includes(".mp4"))) {
          await OmniBox.log("info", `[枫叶][play] player config direct url=${rawUrl}`);
          return rawUrl;
        }

        if (from.includes("JD") || rawUrl.startsWith("JD-")) {
          const jxHost = "https://fgsrg.hzqingshan.com";
          const playPageUrl = `${jxHost}/player/?url=${encodeURIComponent(rawUrl)}`;
          const playPageHtml = await requestTextNative(playPageUrl, {
            headers: {
              Referer: playUrl,
              Origin: BASE_URL,
            },
          });
          const tokenMatch = playPageHtml.match(/data-te="([^"]+)"/);
          const token = tokenMatch?.[1] || "";
          if (token) {
            const params = new URLSearchParams();
            params.set("url", rawUrl);
            params.set("token", token);
            const apiRaw = await requestTextNative(`${jxHost}/player/mplayer.php`, {
              method: "POST",
              headers: {
                Accept: "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                Origin: jxHost,
                Referer: playPageUrl,
              },
              body: params.toString(),
            });
            const apiJson = JSON.parse(apiRaw || "{}");
            if (Number(apiJson.code) === 200 && apiJson.url) {
              await OmniBox.log("info", `[枫叶][play] JD parse success url=${apiJson.url}`);
              return String(apiJson.url);
            }
          }
        }
      } catch (e) {
        await OmniBox.log("warn", `[枫叶][play] parse player config failed: ${e.message}`);
      }
    }

    const m3u8Patterns = [
      /['"]((?:https?:)?\/\/[^'"]+\.m3u8[^'"]*)['"]/gi,
      /var\s+url\s*=\s*['"]([^'"]+)['"]/i,
      /url\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
    ];

    for (const pattern of m3u8Patterns) {
      const matches = html.match(pattern);
      if (!matches) continue;
      for (const match of matches) {
        const urlMatch = match.match(/['"]?(https?:\/\/[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]?/i);
        if (urlMatch?.[1]) {
          let realUrl = urlMatch[1];
          if (realUrl.startsWith("//")) realUrl = `https:${realUrl}`;
          await OmniBox.log("info", `[枫叶][play] regex found url=${realUrl}`);
          return realUrl;
        }
      }
    }
    return "";
  } catch (error) {
    await OmniBox.log("warn", `[枫叶][play] parse play page failed: ${error.message}`);
    return "";
  }
}

async function home() {
  try {
    const html = await getCachedText("fengye:home", LIST_CACHE_TTL, () => requestText(`${BASE_URL}/`));
    const list = parseHomeList(html).slice(0, 40);
    await OmniBox.log("info", `[枫叶][home] list=${list.length}`);
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[枫叶][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), list: [] };
  }
}

async function category(params = {}) {
  try {
    const categoryId = String(params.categoryId || params.type_id || params.id || "1");
    const page = Math.max(1, Number(params.page) || 1);
    const extend = params.extend || params.filters || {};
    const area = String(extend.area || "");
    const by = String(extend.by || "time");
    const clazz = String(extend.class || "");
    const year = String(extend.year || "");
    const lang = String(extend.lang || "");
    const letter = String(extend.letter || "");
    const url = `${BASE_URL}/cupfox-list/${categoryId}-${area}-${by}-${clazz}-${lang}-${letter}---${page}---${year}.html`;
    const html = await getCachedText(`fengye:category:${categoryId}:${page}:${area}:${by}:${clazz}:${year}:${lang}:${letter}`, LIST_CACHE_TTL, () => requestText(url));
    const list = parseHomeList(html);
    await OmniBox.log("info", `[枫叶][category] category=${categoryId} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length >= PAGE_LIMIT ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list: list.map((item) => ({ ...item, type_name: categoryNameById(categoryId) })),
    };
  } catch (e) {
    await OmniBox.log("error", `[枫叶][category] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function search(params = {}) {
  try {
    const wd = normalizeText(params.wd || params.keyword || params.key || "");
    const page = Math.max(1, Number(params.page) || 1);
    if (!wd) return { list: [] };
    const url = `${BASE_URL}/cupfox-search/${encodeURIComponent(wd)}----------${page}---.html`;
    const html = await getCachedText(`fengye:search:${wd}:${page}`, SEARCH_CACHE_TTL, () => requestText(url));
    const list = parseSearchList(html);
    await OmniBox.log("info", `[枫叶][search] wd=${wd} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length >= PAGE_LIMIT ? page + 1 : page,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("warn", `[枫叶][search] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "");
    if (!videoId) return { list: [] };
    const url = `${BASE_URL}/detail/${videoId}.html`;
    const html = await getCachedText(`fengye:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(url));
    const result = parseDetail(html, videoId);
    await OmniBox.log("info", `[枫叶][detail] id=${videoId} sources=${result.list?.[0]?.vod_play_sources?.length || 0}`);
    return result;
  } catch (e) {
    await OmniBox.log("error", `[枫叶][detail] ${e.message}`);
    return { list: [] };
  }
}

async function play(params = {}) {
  try {
    const playId = String(params.id || params.playId || "");
    if (!playId) return { parse: 1, url: "", urls: [], header: {}, flag: "fengye" };
    const playUrl = `${BASE_URL}/play/${playId}.html`;
    const html = await requestText(playUrl);
    const realVideoUrl = await parsePlayPage(playUrl, html);
    const finalHeaders = {
      "User-Agent": UA,
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
    };

    if (realVideoUrl) {
      await OmniBox.log("info", `[枫叶][play] direct success playId=${playId} url=${realVideoUrl}`);
      return {
        parse: 0,
        url: realVideoUrl,
        urls: [{ name: "播放", url: realVideoUrl }],
        header: finalHeaders,
        headers: finalHeaders,
        flag: "fengye",
      };
    }

    await OmniBox.log("warn", `[枫叶][play] fallback parse=1 playId=${playId}`);
    return {
      parse: 1,
      url: playUrl,
      urls: [{ name: "播放页", url: playUrl }],
      header: finalHeaders,
      headers: finalHeaders,
      flag: "fengye",
    };
  } catch (e) {
    await OmniBox.log("error", `[枫叶][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {}, flag: "fengye" };
  }
}
