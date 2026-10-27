// @name 芒果tv(MacCMS API)-增强版
// @author OpenClaw Bingbu + 梦
// @description 刮削：支持，弹幕：支持，嗅探：支持，观看记录：支持，广告：菠菜
// @dependencies: axios
// @version 1.1.9
// @downloadURL https://gh-proxy.org/https://github.com/lansepyy/OmniBox-Spider/raw/refs/heads/main/影视/采集/爱芒果tv.js

/**
 * ============================================================================
 * 芒果tv OmniBox 站源（增强版）
 * 站点: https://caiji.mgzyapi.com
 *
 * 更新日志：
 * - v1.1.9: 主分类固定为 电影/电视剧/动漫；
 *           分类接口查不到数据时，自动降级为全站列表按主分类名过滤；
 *           子分类支持从嵌套分类树和首页数据中自动生成。
 * ============================================================================
 */

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://caiji.mgzyapi.com";
const API = `${HOST}/api.php/provide/vod`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// 仅作为分类树完全不可用时的最终兜底
const MAIN_CATEGORIES = [
  { type_id: "7", type_name: "电影" },
  { type_id: "8", type_name: "电视剧" },
  { type_id: "40", type_name: "动漫" }
];

// 原站可查询主分类 ID 兜底
const FALLBACK_MAIN_QUERY_IDS = {
  "电影": ["7"],
  "电视剧": ["8"],
  "动漫": ["40"]
};

const DEFAULT_BLOCKED_MAIN = ["39"];

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Referer": `${HOST}/`
  },
  validateStatus: () => true
});

const CLASS_CACHE = {
  list: [],
  mapById: {},
  childMap: {}
};

// 首页最新数据缓存，用于子分类兜底
const SAMPLE_ITEMS = [];

function safeJson(input, fallback = {}) {
  if (!input) return fallback;
  if (typeof input === "object") return input;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function safeLog(level, message) {
  try {
    const r = OmniBox.log(level, message);
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {}
}

function fixUrl(url) {
  const u = text(url);
  if (!u || u === "<nil>") return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("/")) return `${HOST}${u}`;
  return `${HOST}/${u}`;
}

function b64Encode(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
}

function b64Decode(str) {
  try {
    return JSON.parse(Buffer.from(String(str || ""), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function getBlockedMainSet() {
  const env = text(process.env.IQIYIZY_BLOCKED_MAIN);
  const raw = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_BLOCKED_MAIN;
  return new Set(raw);
}

// 展开嵌套分类树，同时兼容扁平的 type_pid 结构
function flattenClassList(classList) {
  const out = [];
  const visited = new Set();

  function walk(list, parentPid) {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      const id = text(c.type_id);
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const name = text(c.type_name);
      if (!name) continue;

      const pid = text(c.type_pid) || text(parentPid || "0");
      out.push({ type_id: id, type_pid: pid, type_name: name });

      if (Array.isArray(c.children) && c.children.length) walk(c.children, id);
    }
  }

  walk(classList, "0");
  return out;
}

function updateClassCache(classList) {
  const classes = flattenClassList(classList);
  if (!classes.length) return;

  const mapById = {};
  const childMap = {};

  classes.forEach((c) => {
    mapById[c.type_id] = c;
    const pid = c.type_pid || "0";
    if (!childMap[pid]) childMap[pid] = [];
    childMap[pid].push(c);
  });

  CLASS_CACHE.list = classes;
  CLASS_CACHE.mapById = mapById;
  CLASS_CACHE.childMap = childMap;
}

async function fetchApi(params = {}) {
  try {
    const res = await http.get(API, { params });
    const data = safeJson(res.data, {});
    if (Array.isArray(data.class)) updateClassCache(data.class);
    return data;
  } catch (error) {
    safeLog("warn", `fetchApi 失败: ${error.message}`);
    return {};
  }
}

async function ensureClassCache() {
  if (Array.isArray(CLASS_CACHE.list) && CLASS_CACHE.list.length > 0) return;
  await fetchApi({ ac: "list", pg: 1 });
}

// 根据分类名识别主分类
function classifyMainTypeName(typeName) {
  const n = text(typeName);
  if (!n) return "";

  if (/电影|动作片|喜剧片|爱情片|科幻片|恐怖片|惊悚片|战争片|剧情片|犯罪片|冒险片|悬疑片|武侠片/.test(n)) return "电影";
  if (/动漫|动画/.test(n)) return "动漫";
  if (/电视|连续剧|国产剧|港台剧|港剧|台剧|日韩剧|日剧|韩剧|欧美剧|美剧|英剧|泰剧|海外剧|网剧/.test(n)) return "电视剧";
  if (/剧/.test(n) && !/短剧|解说|预告|片花|花絮|资讯/.test(n)) return "电视剧";
  return "";
}

function getMainTypeName(typeId) {
  const id = text(typeId);
  if (!id) return "";

  const cached = CLASS_CACHE.mapById?.[id];
  if (cached) {
    const normalized = classifyMainTypeName(cached.type_name);
    if (normalized) return normalized;
  }

  const fallback = MAIN_CATEGORIES.find((m) => m.type_id === id);
  return fallback ? fallback.type_name : "";
}

// 动态解析某个分类所属的主分类 ID
function resolveMainTypeId(typeId, fallbackMain = "") {
  const t = text(typeId);
  if (!t) return text(fallbackMain);

  const mapById = CLASS_CACHE.mapById || {};
  let cur = mapById[t];
  let guard = 0;

  while (cur && guard < 10) {
    guard += 1;
    if (!cur.type_pid || cur.type_pid === "0" || cur.type_pid === cur.type_id) {
      return cur.type_id;
    }
    if (MAIN_CATEGORIES.some((m) => m.type_id === cur.type_id)) {
      return cur.type_id;
    }
    cur = mapById[cur.type_pid];
  }

  if (MAIN_CATEGORIES.some((m) => m.type_id === t)) return t;
  return text(fallbackMain);
}

// 判断一条视频属于哪个主分类
function classifyVodMainType(item) {
  const typeId = text(item.type_id || "");
  const typeName = text(item.type_name || "");

  if (typeId) {
    const resolved = resolveMainTypeId(typeId, "");
    const viaTree = getMainTypeName(resolved);
    if (viaTree) return viaTree;
  }

  const viaName = classifyMainTypeName(typeName);
  if (viaName) return viaName;

  const typeId1 = text(item.type_id_1 || "");
  if (typeId1) {
    const viaId1 = getMainTypeName(typeId1);
    if (viaId1) return viaId1;
  }

  return "";
}

function isMainBlocked(mainTypeId) {
  return getBlockedMainSet().has(text(mainTypeId));
}

// 识别并剔除混入电影的剧集
function isTvShowName(vodName, typeName) {
  const name = text(vodName);
  const tname = text(typeName);

  if (/剧|动漫|综艺|纪录|动画/i.test(tname)) return false;

  const tvKeywords = [
    /第\s*[\d一二三四五六七八九十百]+\s*[集话期回]/,
    /全\s*[\d一二三四五六七八九十百]+\s*[集话期回]/,
    /更新至\s*\d+\s*[集话期回]/,
    /共\s*\d+\s*[集话期回]/,
    /\bEP?\d+\b/i,
    /\bS\d{1,2}E\d{1,2}\b/i,
    /电视剧|连续剧|网剧/
  ];

  return tvKeywords.some((regex) => regex.test(name));
}

// 主分类列表：固定为 电影 / 电视剧 / 动漫
function buildMainClasses() {
  const desired = [
    { name: "电影", id: "7" },
    { name: "电视剧", id: "8" },
    { name: "动漫", id: "40" }
  ];

  const topLevel = CLASS_CACHE.list.filter(
    (c) => !c.type_pid || c.type_pid === "0" || c.type_pid === c.type_id
  );

  if (topLevel.length > 0) {
    const result = desired.map((d) => {
      const hit = topLevel.find((c) => classifyMainTypeName(c.type_name) === d.name);
      return hit ? { type_id: hit.type_id, type_name: d.name } : { type_id: d.id, type_name: d.name };
    });
    safeLog("info", `[buildMainClasses] 主分类: ${JSON.stringify(result)}`);
    return result;
  }

  return desired.map((d) => ({ type_id: d.id, type_name: d.name }));
}

// 获取某分类下的子分类
function getClassChildren(mainTypeId) {
  const key = text(mainTypeId);
  const map = new Map();

  (CLASS_CACHE.childMap?.[key] || []).forEach((c) => {
    if (c.type_id && c.type_id !== key) map.set(c.type_id, c);
  });

  CLASS_CACHE.list.forEach((c) => {
    if (c.type_id && c.type_id !== key && text(c.type_pid) === key) map.set(c.type_id, c);
  });

  return Array.from(map.values());
}

function getChildTypeIds(mainTypeId) {
  return getClassChildren(mainTypeId).map((c) => c.type_id);
}

function buildFiltersForMain(mainTypeId, mainTypeName) {
  const key = text(mainTypeId);
  const map = new Map();

  getClassChildren(key).forEach((c) => {
    if (c.type_id && c.type_id !== key && !map.has(c.type_id)) {
      map.set(c.type_id, c.type_name);
    }
  });

  // 分类树里没有子分类时，用首页数据中的分类补充
  SAMPLE_ITEMS.forEach((it) => {
    const tid = text(it.type_id || "");
    const tname = text(it.type_name || "");
    if (!tid || !tname || map.has(tid)) return;
    if (classifyVodMainType(it) === mainTypeName) map.set(tid, tname);
  });

  if (!map.size) return [];

  const value = [{ name: "全部", value: "" }];
  map.forEach((type_name, type_id) => value.push({ name: type_name, value: type_id }));

  return [{
    key: "subtype",
    name: "子分类",
    init: "",
    value
  }];
}

async function enrichVideosWithDetails(rawList, mainTypeId = "") {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  const videos = rawList.map((item) => {
    const typeId = text(item.type_id || "");
    const resolvedMainType = resolveMainTypeId(typeId, item.type_id_1 || "");
    return {
      vod_id: text(item.vod_id),
      vod_name: text(item.vod_name),
      vod_pic: fixUrl(item.vod_pic),
      vod_remarks: text(item.vod_remarks || item.type_name || ""),
      type_id: typeId,
      type_name: text(item.type_name || ""),
      main_type_id: resolvedMainType,
      vod_year: text(item.vod_year || ""),
      vod_douban_score: text(item.vod_douban_score || ""),
      _needDetail: !item.vod_pic || item.vod_pic === "<nil>" || item.vod_pic === ""
    };
  });

  // 电影主分类下，干掉明显的剧集
  const isMovieContext = getMainTypeName(mainTypeId) === "电影";
  const filteredVideos = videos.filter((v) => {
    if (isMovieContext && isTvShowName(v.vod_name, v.type_name)) return false;
    return true;
  });

  const needDetailVideos = filteredVideos.filter((v) => v._needDetail);
  if (needDetailVideos.length > 0) {
    const batchSize = 20;
    for (let i = 0; i < needDetailVideos.length; i += batchSize) {
      const batch = needDetailVideos.slice(i, i + batchSize);
      const ids = batch.map((v) => v.vod_id).join(",");
      try {
        const detailData = await fetchApi({ ac: "detail", ids });
        if (Array.isArray(detailData.list)) {
          detailData.list.forEach((detailItem) => {
            const vid = text(detailItem.vod_id);
            const target = filteredVideos.find((v) => v.vod_id === vid);
            if (target) {
              const pic = fixUrl(detailItem.vod_pic);
              if (pic) target.vod_pic = pic;
            }
          });
        }
      } catch (error) {}
    }
  }

  const finalList = await Promise.all(filteredVideos.map(async (v) => {
    delete v._needDetail;
    if (!v.vod_pic && v.vod_id) {
      try {
        const metadata = await OmniBox.getScrapeMetadata(v.vod_id);
        if (metadata?.scrapeData) {
          const sd = metadata.scrapeData;
          const posterPath = sd.posterPath || sd.poster_path;
          if (posterPath) v.vod_pic = `https://wsrv.nl/?url=image.tmdb.org/t/p/w300${posterPath}`;
        }
      } catch (e) {}
    }
    return v;
  }));

  return finalList;
}

function buildResourceId(vodId) { return text(vodId); }
function buildEpisodeFileId(vodId, flag, epName, idx) { return `${text(vodId)}#${text(flag)}#${idx}`; }

function parsePlaySources(vodPlayFrom, vodPlayUrl, vodId, vodName = "") {
  const fromArr = text(vodPlayFrom).split("$$$").map((s) => s.trim()).filter(Boolean);
  const urlArr = text(vodPlayUrl).split("$$$").map((s) => s.trim()).filter(Boolean);
  const sourceCount = Math.max(fromArr.length, urlArr.length);
  const sources = [];
  const videoFiles = [];
  const cleanVodName = text(vodName).replace(/[\s\.]+/g, '.');

  for (let i = 0; i < sourceCount; i += 1) {
    const flag = fromArr[i] || `线路${i + 1}`;
    const group = urlArr[i] || "";
    const episodesRaw = group.split("#").map((s) => s.trim()).filter(Boolean);

    const episodes = episodesRaw.map((item, idx) => {
      let epName = `第${idx + 1}集`;
      let epUrl = item;
      const cut = item.indexOf("$");
      if (cut > -1) {
        epName = text(item.slice(0, cut)) || epName;
        epUrl = text(item.slice(cut + 1));
      }

      const fileId = buildEpisodeFileId(vodId, flag, epName, idx + 1);
      videoFiles.push({
        fid: fileId,
        file_id: fileId,
        file_name: `${cleanVodName}.S01E${String(idx + 1).padStart(2, '0')}`,
        name: epName,
        format_type: "video"
      });

      const playId = b64Encode({
        resourceId: buildResourceId(vodId),
        vodId: text(vodId),
        name: vodName,
        flag,
        epName,
        episodeIndex: idx + 1,
        fileId,
        url: epUrl
      });

      return { name: epName, playId, _fileId: fileId };
    });

    if (episodes.length > 0) {
      sources.push({ name: flag, episodes });
    }
  }
  return { sources, videoFiles };
}

async function enrichPlaySourcesWithMetadata(playSources, resourceId) {
  try {
    const metadata = await OmniBox.getScrapeMetadata(resourceId);
    const scrapeData = metadata?.scrapeData || null;
    const videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];

    if (!playSources.length || !videoMappings.length) return { playSources, scrapeData, metadata };

    const mappingMap = new Map();
    for (const m of videoMappings) {
      if (m?.fileId) mappingMap.set(String(m.fileId), m);
    }

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const lookupKey = String(ep._fileId || "");
        const mapping = mappingMap.get(lookupKey);
        if (!mapping) continue;
        if (mapping.episodeName) ep.episodeName = mapping.episodeName;
        if (mapping.seasonNumber != null) ep._seasonNumber = mapping.seasonNumber;
        if (mapping.episodeNumber != null) ep._episodeNumber = mapping.episodeNumber;
      }

      const hasOrdering = (source.episodes || []).some((ep) => ep._episodeNumber != null);
      if (hasOrdering) {
        source.episodes.sort((a, b) => {
          const sa = Number(a._seasonNumber || 0);
          const sb = Number(b._seasonNumber || 0);
          if (sa !== sb) return sa - sb;
          return Number(a._episodeNumber || 0) - Number(b._episodeNumber || 0);
        });
      }

      for (const ep of source.episodes || []) {
        delete ep._seasonNumber;
        delete ep._episodeNumber;
        delete ep._fileId;
      }
    }
    return { playSources, scrapeData, metadata };
  } catch (error) {
    for (const source of playSources) {
      for (const ep of source.episodes || []) delete ep._fileId;
    }
    return { playSources, scrapeData: null, metadata: null };
  }
}

function getFilterSubtype(params) {
  return text(params?.filters?.subtype || params?.filter?.subtype || params?.extend?.subtype || params?.ext?.subtype || "");
}

function isAllSelection(value) {
  const v = text(value).toLowerCase();
  return !v || v === "0" || v === "-1" || v === "all" || v === "全部";
}

function inferTypeName(mainTypeId, rawTypeName) {
  return getMainTypeName(mainTypeId) || text(rawTypeName || "");
}

function buildScrapeKeyword(item) { return text(item.vod_name); }

function buildDanmakuFileName(scrapeData, mapping, fallbackTitle, fallbackEpName) {
  if (!scrapeData) return `${fallbackTitle || ""} ${fallbackEpName || ""}`.trim();
  const title = text(scrapeData.title || fallbackTitle || "");
  const scrapeType = text(scrapeData.scrapeType || scrapeData.type || "").toLowerCase();
  const seasonAirYear = text(scrapeData.seasonAirYear || scrapeData.releaseDate || "").slice(0, 4);
  if (mapping && (mapping.episodeNumber != null || mapping.seasonNumber != null || scrapeType === "tv")) {
    const season = Number(mapping?.seasonNumber || 1);
    const episode = Number(mapping?.episodeNumber || 1);
    const yearPart = seasonAirYear ? `.${seasonAirYear}` : "";
    return `${title}${yearPart}.S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  }
  return title || `${fallbackTitle || ""} ${fallbackEpName || ""}`.trim();
}

// 直查某个分类 ID
async function fetchDirectByType(typeId, mainTypeId, page) {
  const data = await fetchApi({ ac: "list", t: text(typeId), pg: page });
  const rawList = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  const list = await enrichVideosWithDetails(rawList, mainTypeId);
  return {
    list,
    page: Number(data.page || page || 1),
    pagecount: Number(data.pagecount || page || 1),
    total: Number(data.total || list.length || 0),
    limit: Number(data.limit || 20)
  };
}

// 聚合多个分类 ID 的数据
async function aggregateByTypeIds(typeIds, mainTypeId, page) {
  const ids = typeIds.filter(Boolean);
  if (ids.length === 0) return { list: [], page, pagecount: page, total: 0, limit: 20 };

  const results = await Promise.all(ids.map((tid) => fetchApi({ ac: "list", t: tid, pg: page })));
  const mergedRaw = [];
  let total = 0, pagecount = 0, limit = 20;

  results.forEach((data) => {
    const arr = Array.isArray(data.list) ? data.list : [];
    mergedRaw.push(...arr);
    total += Number(data.total || 0);
    pagecount = Math.max(pagecount, Number(data.pagecount || 0));
    if (Number(data.limit || 0) > 0) limit = Number(data.limit);
  });

  const seen = new Set();
  const uniqueRaw = mergedRaw.filter((it) => {
    if (!it.vod_id || seen.has(it.vod_id)) return false;
    seen.add(it.vod_id);
    return true;
  });

  const list = await enrichVideosWithDetails(uniqueRaw, mainTypeId);
  list.sort((a, b) => Number(b.vod_id || 0) - Number(a.vod_id || 0));
  return { list, page, pagecount: pagecount || page, total: total || list.length, limit };
}

// 全站列表按主分类名过滤兜底
async function fetchGeneralFiltered(mainTypeId, mainTypeName, page) {
  const data = await fetchApi({ ac: "list", pg: page });
  const raw = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  const filtered = raw.filter((it) => classifyVodMainType(it) === mainTypeName);
  const list = await enrichVideosWithDetails(filtered, mainTypeId);
  return {
    list,
    page: Number(data.page || page || 1),
    pagecount: Number(data.pagecount || page || 1),
    total: Number(data.total || list.length || 0),
    limit: Number(data.limit || 20)
  };
}

// 全站列表按子分类 ID/名称过滤兜底
async function fetchSubtypeFiltered(subtype, mainTypeId, page) {
  const data = await fetchApi({ ac: "list", pg: page });
  const raw = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  const subtypeName = text(CLASS_CACHE.mapById?.[subtype]?.type_name || "");
  const filtered = raw.filter((it) => text(it.type_id) === subtype || (subtypeName && text(it.type_name) === subtypeName));
  const list = await enrichVideosWithDetails(filtered, mainTypeId);
  return {
    list,
    page: Number(data.page || page || 1),
    pagecount: Number(data.pagecount || page || 1),
    total: Number(data.total || list.length || 0),
    limit: Number(data.limit || 20)
  };
}

// 主分类“全部”加载
async function fetchMainAllByChildren(mainTypeId, mainTypeName, page) {
  const childTypeIds = getChildTypeIds(mainTypeId);

  // 1. 有子分类就聚合子分类
  if (childTypeIds.length > 0) {
    const agg = await aggregateByTypeIds(childTypeIds, mainTypeId, page);
    if (agg.list.length > 0) return agg;
  }

  // 2. 直查主分类
  const direct = await fetchDirectByType(mainTypeId, mainTypeId, page);
  if (direct.list.length > 0) return direct;

  // 3. 尝试原站可查询 ID
  const fallbackIds = FALLBACK_MAIN_QUERY_IDS[mainTypeName] || [];
  if (fallbackIds.length > 0) {
    const fb = await aggregateByTypeIds(fallbackIds, mainTypeId, page);
    if (fb.list.length > 0) return fb;
  }

  // 4. 全站列表过滤兜底，保证有数据
  return await fetchGeneralFiltered(mainTypeId, mainTypeName, page);
}

async function home(params, context) {
  try {
    const data = await fetchApi({ ac: "list", pg: 1 });

    // 缓存首页数据，用于子分类兜底
    SAMPLE_ITEMS.length = 0;
    if (Array.isArray(data.list)) SAMPLE_ITEMS.push(...data.list);

    const classes = buildMainClasses();

    const rawList = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
    const list = await enrichVideosWithDetails(rawList, "");

    const filters = {};
    classes.forEach((m) => {
      const f = buildFiltersForMain(m.type_id, m.type_name);
      if (f.length) filters[m.type_id] = f;
    });

    return { class: classes, filters, list };
  } catch (error) {
    safeLog("error", `home 失败: ${error.message}`);
    return { class: [], filters: {}, list: [] };
  }
}

async function category(params, context) {
  try {
    const page = parseInt(params?.page || "1", 10) || 1;
    const mainTypeId = text(params?.categoryId || params?.type_id || "");
    const subtype = getFilterSubtype(params);
    await ensureClassCache();

    if (isMainBlocked(mainTypeId)) return { list: [], page, pagecount: 0, total: 0, limit: 20 };

    const mainTypeName = getMainTypeName(mainTypeId);
    let result;

    if (!isAllSelection(subtype)) {
      // 指定子分类：先直查，查不到再按全站列表过滤
      result = await fetchDirectByType(subtype, mainTypeId, page);
      if (result.list.length === 0) result = await fetchSubtypeFiltered(subtype, mainTypeId, page);
    } else {
      // “全部”
      result = await fetchMainAllByChildren(mainTypeId, mainTypeName, page);
    }

    const f = buildFiltersForMain(mainTypeId, mainTypeName);
    if (f.length && page === 1) result.filters = f;
    return result;
  } catch (error) {
    safeLog("error", `category 失败: ${error.message}`);
    return { list: [], page: parseInt(params?.page || "1", 10) || 1, pagecount: 0, total: 0, limit: 20 };
  }
}

async function search(params, context) {
  try {
    const keyword = text(params?.keyword || params?.wd || "");
    const page = parseInt(params?.page || "1", 10) || 1;
    if (!keyword) return { list: [], page: 1, pagecount: 0, total: 0 };

    const data = await fetchApi({ ac: "list", wd: keyword, pg: page });
    const rawList = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
    const list = await enrichVideosWithDetails(rawList, "");

    return {
      list,
      page: Number(data.page || page || 1),
      pagecount: Number(data.pagecount || page || 1),
      total: Number(data.total || list.length || 0),
      limit: Number(data.limit || 20)
    };
  } catch (error) {
    safeLog("error", `search 失败: ${error.message}`);
    return { list: [], page: parseInt(params?.page || "1", 10) || 1, pagecount: 0, total: 0 };
  }
}

async function detail(params, context) {
  try {
    const videoId = text(params?.videoId || "");
    if (!videoId) return { list: [] };

    const data = await fetchApi({ ac: "detail", ids: videoId });
    const item = Array.isArray(data.list) && data.list.length ? data.list[0] : null;
    if (!item) return { list: [] };

    const mainTypeId = resolveMainTypeId(item.type_id, item.type_id_1 || "");
    if (isMainBlocked(mainTypeId)) return { list: [] };

    const resourceId = buildResourceId(videoId);
    const { sources, videoFiles } = parsePlaySources(item.vod_play_from, item.vod_play_url, videoId, item.vod_name);

    let scrapeData = null;
    if (videoFiles.length > 0) {
      try {
        await OmniBox.processScraping(resourceId, buildScrapeKeyword(item), text(item.vod_name), videoFiles);
      } catch (error) {
        safeLog("warn", `[detail] processScraping 失败: ${error.message}`);
      }
    }

    const enriched = await enrichPlaySourcesWithMetadata(sources, resourceId);
    const playSources = enriched.playSources;
    scrapeData = enriched.scrapeData;

    const posterPath = scrapeData?.posterPath || scrapeData?.poster_path || scrapeData?.poster;
    const originalPic = fixUrl(item.vod_pic);
    const finalPic = originalPic || (posterPath ? `https://wsrv.nl/?url=image.tmdb.org/t/p/w500${posterPath}` : "");

    const vod = {
      vod_id: text(item.vod_id),
      vod_name: text(scrapeData?.title || item.vod_name),
      vod_pic: finalPic,
      vod_remarks: text(item.vod_remarks),
      vod_year: text((scrapeData?.releaseDate || item.vod_year || "").slice?.(0, 4) || item.vod_year || ""),
      vod_area: text(item.vod_area),
      vod_lang: text(item.vod_lang),
      vod_director: text(item.vod_director || scrapeData?.credits?.crew?.filter?.((x) => x.job === "Director").map?.((x) => x.name).join(",") || ""),
      vod_actor: text(item.vod_actor || scrapeData?.credits?.cast?.slice?.(0, 8).map?.((x) => x.name).join(",") || ""),
      vod_class: text(item.vod_class || inferTypeName(mainTypeId, item.type_name || "")),
      vod_content: text(scrapeData?.overview || item.vod_content).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      vod_play_sources: playSources,
      vod_douban_score: text(scrapeData?.voteAverage != null ? Number(scrapeData.voteAverage).toFixed(1) : (item.vod_douban_score || ""))
    };

    return { list: [vod] };
  } catch (error) {
    safeLog("error", `detail 失败: ${error.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = text(params?.playId || "");
    const meta = b64Decode(playId);
    const url = fixUrl(meta.url || "");
    const resourceId = text(meta.resourceId || "");
    const fileId = text(meta.fileId || "");
    const vodId = text(meta.vodId || "");
    const title = text(meta.name || params?.title || "");
    const epName = text(meta.epName || "");

    if (!url) {
      return { urls: [], parse: 1, header: { "User-Agent": UA, "Referer": `${HOST}/` }, danmaku: [] };
    }

    let danmaku = [];
    let scrapeData = null;
    let mapping = null;

    if (resourceId && fileId) {
      try {
        const metadata = await OmniBox.getScrapeMetadata(resourceId);
        scrapeData = metadata?.scrapeData || null;
        const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
        mapping = mappings.find((m) => String(m?.fileId || "") === fileId) || null;

        const fileName = buildDanmakuFileName(scrapeData, mapping, title, epName);
        if (fileName) {
          danmaku = await OmniBox.getDanmakuByFileName(fileName);
        }
      } catch (error) {
        safeLog("warn", `[play] 弹幕匹配失败: ${error.message}`);
      }
    }

    const parse = /\.(m3u8|mp4|flv|webm)(\?|$)/i.test(url) ? 0 : 1;
    const header = { "User-Agent": UA, "Referer": `${HOST}/` };

    try {
      const historyPayload = {
        vodId: vodId || resourceId || title,
        title: title || vodId,
        episode: playId,
        episodeName: mapping?.episodeName || epName || undefined,
        episodeNumber: mapping?.episodeNumber != null ? mapping.episodeNumber : undefined,
        pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : undefined,
        playUrl: url,
        playHeader: header
      };
      await OmniBox.addPlayHistory(historyPayload);
    } catch (error) {
      safeLog("warn", `[play] 添加观看记录失败: ${error.message}`);
    }

    return { urls: [{ name: epName || meta.flag || "播放", url }], parse, header, danmaku: Array.isArray(danmaku) ? danmaku : [] };
  } catch (error) {
    safeLog("error", `play 失败: ${error.message}`);
    return { urls: [], parse: 1, header: { "User-Agent": UA, "Referer": `${HOST}/` }, danmaku: [] };
  }
}

module.exports = { home, category, search, detail, play };
runner.run(module.exports);
