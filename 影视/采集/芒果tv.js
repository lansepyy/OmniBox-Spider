// @name 芒果tv(MacCMS API)-增强版
// @author OpenClaw Bingbu + 梦
// @description 刮削：支持，弹幕：支持，嗅探：支持，观看记录：支持，广告：菠菜
// @dependencies: axios
// @version 1.2.0
// @downloadURL https://gh-proxy.org/https://github.com/lansepyy/OmniBox-Spider/raw/refs/heads/main/影视/采集/芒果tv.js

/**
 * ============================================================================
 * 芒果tv OmniBox 站源（增强版）
 * 站点: https://caiji.mgzyapi.com
 *
 * 更新日志：
 * - v1.2.0: 主分类固定为 电影/电视剧/动漫，分别对应原站 电影片/连续剧/动漫片；
 *           子分类按原站结构显式定义并按名称动态匹配真实 type_id；
 *           主分类“全部”优先直查主分类，修复电影只返回动作片的问题。
 * ============================================================================
 */

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://caiji.mgzyapi.com";
const API = `${HOST}/api.php/provide/vod`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// 主分类定义：key 为前端显示名，siteNames 为原站顶级分类名
const MAIN_DEFS = [
  {
    key: "电影",
    siteNames: ["电影片", "电影"],
    fallbackIds: ["7"],
    subNames: [
      "动作片", "喜剧片", "爱情片", "科幻片", "恐怖片", "剧情片",
      "战争片", "4K电影", "邵氏电影", "纪录片", "动画片", "Netflix电影"
    ]
  },
  {
    key: "电视剧",
    siteNames: ["连续剧", "电视剧"],
    fallbackIds: ["8"],
    subNames: [
      "国产剧", "香港剧", "韩国剧", "欧美剧", "台湾剧", "日本剧",
      "海外剧", "泰国剧", "Netflix自制剧"
    ]
  },
  {
    key: "动漫",
    siteNames: ["动漫片", "动漫"],
    fallbackIds: ["40"],
    subNames: [
      "国产动漫", "日韩动漫", "欧美动漫", "港台动漫", "海外动漫"
    ]
  }
];

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

// 展开可能的嵌套分类结构，同时兼容扁平 type_pid 结构
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

// 合并分类缓存，避免部分响应覆盖完整分类树
function updateClassCache(classList) {
  const classes = flattenClassList(classList);
  if (!classes.length) return;

  const byId = new Map();
  CLASS_CACHE.list.forEach((c) => byId.set(c.type_id, c));
  classes.forEach((c) => byId.set(c.type_id, c));

  const merged = Array.from(byId.values());
  const mapById = {};
  const childMap = {};

  merged.forEach((c) => {
    mapById[c.type_id] = c;
    const pid = c.type_pid || "0";
    if (!childMap[pid]) childMap[pid] = [];
    childMap[pid].push(c);
  });

  CLASS_CACHE.list = merged;
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

function isTopLevel(c) {
  return !c.type_pid || c.type_pid === "0" || c.type_pid === c.type_id;
}

// 根据源站分类名识别主分类
function classifyMainTypeName(typeName) {
  const n = text(typeName);
  if (!n) return "";

  if (/电影片|电影/.test(n)) return "电影";
  if (/连续剧|电视剧/.test(n)) return "电视剧";
  if (/动漫片|动漫/.test(n)) return "动漫";
  return "";
}

function findMainClass(def) {
  if (!def) return null;
  const topLevel = CLASS_CACHE.list.filter(isTopLevel);
  let hit = topLevel.find((c) => def.siteNames.includes(text(c.type_name)));
  if (!hit) hit = CLASS_CACHE.list.find((c) => def.siteNames.includes(text(c.type_name)));
  return hit || null;
}

function getMainTypeName(typeId) {
  const id = text(typeId);
  if (!id) return "";

  const cached = CLASS_CACHE.mapById?.[id];
  if (cached) {
    const n = classifyMainTypeName(cached.type_name);
    if (n) return n;
  }

  for (const def of MAIN_DEFS) {
    if (def.fallbackIds.includes(id)) return def.key;
  }
  return "";
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
    const pid = text(cur.type_pid);
    if (!pid || pid === "0" || pid === cur.type_id) return cur.type_id;
    cur = mapById[pid];
  }

  for (const def of MAIN_DEFS) {
    if (def.fallbackIds.includes(t)) return t;
  }
  return text(fallbackMain);
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

// 主分类列表：固定 电影 / 电视剧 / 动漫
function buildMainClasses() {
  return MAIN_DEFS.map((def) => {
    const hit = findMainClass(def);
    const type_id = hit ? hit.type_id : def.fallbackIds[0];
    safeLog("info", `[buildMainClasses] ${def.key} -> type_id=${type_id} (site=${hit ? hit.type_name : "fallback"})`);
    return { type_id, type_name: def.key };
  });
}

// 解析某个主分类下的子分类列表
function resolveSubClasses(mainTypeId, mainDef) {
  const map = new Map();
  const mid = text(mainTypeId);

  (CLASS_CACHE.childMap?.[mid] || []).forEach((c) => {
    if (c.type_id && c.type_id !== mid) map.set(c.type_id, { type_id: c.type_id, type_name: c.type_name });
  });

  CLASS_CACHE.list.forEach((c) => {
    if (text(c.type_pid) === mid && c.type_id !== mid) map.set(c.type_id, { type_id: c.type_id, type_name: c.type_name });
  });

  if (mainDef?.subNames) {
    mainDef.subNames.forEach((n) => {
      const existing = Array.from(map.values()).find((v) => v.type_name === n);
      if (!existing) {
        const c = CLASS_CACHE.list.find((x) => text(x.type_name) === n);
        if (c) map.set(c.type_id, { type_id: c.type_id, type_name: c.type_name });
        else map.set(n, { type_id: "", type_name: n });
      }
    });
  }

  return Array.from(map.values());
}

function buildFiltersForMain(mainTypeId, mainDef) {
  const subs = resolveSubClasses(mainTypeId, mainDef);
  if (!subs.length) return [];

  const value = [{ name: "全部", value: "" }];
  subs.forEach((s) => {
    value.push({ name: s.type_name, value: s.type_id || s.type_name });
  });

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

// 主分类“全部”加载
async function fetchMainAllByChildren(mainTypeId, page, mainDef) {
  const name = mainDef?.key || getMainTypeName(mainTypeId) || "";

  // 1. 优先直查主分类，保证“电影片/连续剧/动漫片”整体数据完整
  const direct = await fetchDirectByType(mainTypeId, mainTypeId, page);
  if (direct.list.length > 0) return direct;

  // 2. 聚合已知子分类
  const subs = resolveSubClasses(mainTypeId, mainDef);
  const subIds = subs.filter((s) => /^\d+$/.test(text(s.type_id))).map((s) => s.type_id);
  if (subIds.length > 0) {
    const agg = await aggregateByTypeIds(subIds, mainTypeId, page);
    if (agg.list.length > 0) return agg;
  }

  // 3. 原站可查 ID 兜底
  const fbIds = mainDef?.fallbackIds || [];
  if (fbIds.length > 0) {
    const fb = await aggregateByTypeIds(fbIds, mainTypeId, page);
    if (fb.list.length > 0) return fb;
  }

  // 4. 全站列表过滤兜底
  return await fetchGeneralFiltered(mainTypeId, name, page);
}

// 指定子分类加载
async function fetchSubtype(subtype, mainTypeId, page, mainDef) {
  const subClass = CLASS_CACHE.list.find((c) => text(c.type_id) === subtype || text(c.type_name) === subtype);
  const subtypeId = subClass ? subClass.type_id : (/^\d+$/.test(subtype) ? subtype : "");
  const subtypeName = subClass ? subClass.type_name : (/^\d+$/.test(subtype) ? "" : subtype);

  if (subtypeId) {
    const direct = await fetchDirectByType(subtypeId, mainTypeId, page);
    if (direct.list.length > 0) return direct;
  }

  // 主分类直查后按名称/ID 过滤
  const main = await fetchDirectByType(mainTypeId, mainTypeId, page);
  if (main.list.length > 0) {
    const filtered = main.list.filter((v) =>
      (subtypeId && text(v.type_id) === subtypeId) ||
      (subtypeName && text(v.type_name) === subtypeName)
    );
    if (filtered.length > 0) return { ...main, list: filtered, total: filtered.length };
  }

  // 全站列表兜底
  const data = await fetchApi({ ac: "list", pg: page });
  const raw = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  const filtered = raw.filter((it) =>
    (subtypeId && text(it.type_id) === subtypeId) ||
    (subtypeName && text(it.type_name) === subtypeName)
  );
  const list = await enrichVideosWithDetails(filtered, mainTypeId);
  return {
    list,
    page,
    pagecount: Number(data.pagecount || page || 1),
    total: Number(data.total || list.length || 0),
    limit: Number(data.limit || 20)
  };
}

async function home(params, context) {
  try {
    const data = await fetchApi({ ac: "list", pg: 1 });

    SAMPLE_ITEMS.length = 0;
    if (Array.isArray(data.list)) SAMPLE_ITEMS.push(...data.list);

    const classes = buildMainClasses();

    const rawList = (Array.isArray(data.list) ? data.list : []).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
    const list = await enrichVideosWithDetails(rawList, "");

    const filters = {};
    classes.forEach((m) => {
      const def = MAIN_DEFS.find((d) => d.key === m.type_name);
      const f = buildFiltersForMain(m.type_id, def);
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

    const mainDef = MAIN_DEFS.find((d) => d.key === getMainTypeName(mainTypeId));
    let result;

    if (!isAllSelection(subtype)) {
      result = await fetchSubtype(subtype, mainTypeId, page, mainDef);
    } else {
      result = await fetchMainAllByChildren(mainTypeId, page, mainDef);
    }

    if (page === 1) {
      const def = mainDef || MAIN_DEFS[0];
      const f = buildFiltersForMain(mainTypeId, def);
      if (f.length) result.filters = f;
    }
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
