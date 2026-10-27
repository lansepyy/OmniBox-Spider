/**
 * OmniBox TMDB.js
 * TMDB 首页导航：电影 / 电视剧 / 综艺 / 18+电影
 *
 * 说明：
 * 1. 仅使用 TMDB API。
 * 2. 18+ 分类使用多个关键词搜索并严格筛选 adult=true。
 * 3. TMDB 的 include_adult=true 仅允许返回成人内容，不代表结果全部为成人内容。
 * 4. 请填写自己的 TMDB API Key。
 */

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const TMDB_API_KEY = "YOUR_TMDB_API_KEY_HERE";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const TMDB_LANG = "zh-CN";
const ENABLE_ADULT = true;
const PAGE_SIZE = 20;

// 成人影片搜索关键词。仅用于搜索 TMDB 中的条目，不代表完整数据库。
const ADULT_KEYWORDS = [
  "ABP", "IPX", "SSIS", "FSDSS", "MIDE",
  "JUQ", "DASS", "SONE", "PPPE", "STARS",
  "MIDV", "ADN", "WANZ", "JUL", "MIAA",
  "RBD", "START", "MIMK", "HMN", "MIRD",
  "番号", "Japanese adult"
];

const MOVIE_GENRES = {
  "28": "动作",
  "12": "冒险",
  "16": "动画",
  "35": "喜剧",
  "80": "犯罪",
  "99": "纪录片",
  "18": "剧情",
  "10751": "家庭",
  "14": "奇幻",
  "36": "历史",
  "27": "恐怖",
  "10402": "音乐",
  "9648": "悬疑",
  "10749": "爱情",
  "878": "科幻",
  "10770": "电视电影",
  "53": "惊悚",
  "10752": "战争",
  "37": "西部"
};

const TV_GENRES = {
  "10759": "动作冒险",
  "16": "动画",
  "35": "喜剧",
  "80": "犯罪",
  "99": "纪录片",
  "18": "剧情",
  "10751": "家庭",
  "10762": "儿童",
  "9648": "悬疑",
  "10763": "新闻",
  "10764": "真人秀",
  "10765": "科幻奇幻",
  "10766": "肥皂剧",
  "10767": "脱口秀",
  "10768": "战争政治",
  "37": "西部"
};

function makeUrl(path, params = {}, includeAdult = false) {
  const query = new URLSearchParams();

  query.set("api_key", TMDB_API_KEY);
  query.set("language", TMDB_LANG);
  query.set("include_adult", String(includeAdult));

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  return `${TMDB_API}${path}?${query.toString()}`;
}

async function tmdbRequest(path, params = {}, includeAdult = false) {
  if (
    !TMDB_API_KEY ||
    TMDB_API_KEY === "YOUR_TMDB_API_KEY_HERE"
  ) {
    throw new Error("请先在 TMDB.js 中填写 TMDB_API_KEY");
  }

  const url = makeUrl(path, params, includeAdult);
  const response = await OmniBox.request(url);

  let body = response;

  if (response && response.data !== undefined) {
    body = response.data;
  } else if (response && response.body !== undefined) {
    body = response.body;
  } else if (response && response.content !== undefined) {
    body = response.content;
  }

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      throw new Error("TMDB 返回的内容不是有效 JSON：" + error.message);
    }
  }

  if (!body || typeof body !== "object") {
    throw new Error("TMDB 返回数据为空或格式异常");
  }

  if (body.success === false) {
    throw new Error(
      `TMDB API 错误：${body.status_message || "未知错误"}`
    );
  }

  return body;
}

function imageUrl(path, size = "w500") {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${TMDB_IMG}/${size}${path}`;
}

function getYear(item, type) {
  const date = type === "tv"
    ? item.first_air_date
    : item.release_date;

  return date ? String(date).slice(0, 4) : "";
}

function toVod(item, type = "movie") {
  const title = type === "tv"
    ? (item.name || item.original_name || "")
    : (item.title || item.original_title || "");

  const date = type === "tv"
    ? item.first_air_date
    : item.release_date;

  const year = getYear(item, type);
  const genreNames = (item.genre_ids || [])
    .map(id => {
      const map = type === "tv" ? TV_GENRES : MOVIE_GENRES;
      return map[String(id)] || "";
    })
    .filter(Boolean);

  return {
    vod_id: String(item.id),
    vod_name: title,
    vod_pic: imageUrl(item.poster_path),
    vod_pic_thumb: imageUrl(item.poster_path, "w342"),
    vod_remarks: [
      year,
      item.vote_average ? `评分 ${Number(item.vote_average).toFixed(1)}` : "",
      item.adult === true ? "18+" : ""
    ].filter(Boolean).join(" · "),
    vod_content: item.overview || "",
    vod_year: year,
    vod_area: (item.origin_country || []).join(","),
    vod_lang: item.original_language || "",
    vod_score: item.vote_average || 0,
    vod_class: genreNames.join(","),
    vod_actor: "",
    vod_director: "",
    vod_type: type,
    vod_play_from: "",
    vod_play_url: ""
  };
}

function normalizePage(page) {
  const value = parseInt(page, 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, 500);
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object") return {};

  return {
    sort: filters.sort || filters.sort_by || "popularity.desc",
    genre: filters.genre || filters.with_genres || "",
    region: filters.region || filters.with_origin_country || "",
    year: filters.year || filters.primary_release_year || "",
    language: filters.language || ""
  };
}

function buildDiscoverParams(page, filters, type) {
  const f = normalizeFilters(filters);

  const params = {
    page: String(page),
    sort_by: f.sort || "popularity.desc",
    include_video: "false"
  };

  if (f.genre) params.with_genres = String(f.genre);

  if (f.region) {
    if (type === "tv") {
      params.with_origin_country = String(f.region);
    } else {
      params.with_origin_country = String(f.region);
    }
  }

  if (f.year) {
    params[type === "tv" ? "first_air_date_year" : "primary_release_year"] =
      String(f.year);
  }

  if (f.language) {
    params.with_original_language = String(f.language);
  }

  return params;
}

async function fetchStandardCategory(type, page, filters = {}) {
  const path = type === "tv"
    ? "/discover/tv"
    : "/discover/movie";

  const data = await tmdbRequest(
    path,
    buildDiscoverParams(page, filters, type),
    false
  );

  const results = Array.isArray(data.results) ? data.results : [];

  return {
    page: data.page || page,
    pagecount: data.total_pages || 0,
    total: data.total_results || results.length,
    list: results.map(item => toVod(item, type))
  };
}

/**
 * 18+ 分类：
 * 搜索多个关键词，严格保留 adult === true 的电影。
 *
 * 重要限制：
 * - 搜索关键词覆盖范围有限，不能等同于 TMDB 全量成人电影目录。
 * - TMDB 搜索结果有页数上限。
 * - 这里不会把普通电影混进 18+ 列表。
 */
async function fetchAdultCategory(page, filters = {}) {
  if (!ENABLE_ADULT) {
    return {
      page,
      pagecount: 0,
      total: 0,
      list: []
    };
  }

  const f = normalizeFilters(filters);
  const unique = new Map();

  // 为避免单次分类请求发出过多请求，限制每个关键词抓取页数。
  const pagesPerKeyword = 2;

  for (const keyword of ADULT_KEYWORDS) {
    for (let p = 1; p <= pagesPerKeyword; p++) {
      try {
        const params = {
          query: keyword,
          page: String(p),
          include_adult: "true"
        };

        if (f.year) {
          params.primary_release_year = String(f.year);
        }

        if (f.region) {
          params.region = String(f.region);
        }

        const data = await tmdbRequest(
          "/search/movie",
          params,
          true
        );

        const results = Array.isArray(data.results)
          ? data.results
          : [];

        for (const item of results) {
          if (!item || item.adult !== true || !item.id) continue;

          // 只保留真正被 TMDB 标记为成人内容的影片。
          unique.set(String(item.id), item);
        }

        if (!data.total_pages || p >= data.total_pages) {
          break;
        }
      } catch (error) {
        await OmniBox.log(
          "warn",
          `[18+分类] 关键词「${keyword}」第 ${p} 页失败：${error.message}`
        );
        break;
      }
    }
  }

  let results = Array.from(unique.values());

  // 根据筛选器进一步过滤，避免成人分类忽略年份、地区和类型条件。
  if (f.year) {
    results = results.filter(item =>
      String(item.release_date || "").startsWith(String(f.year))
    );
  }

  if (f.region) {
    results = results.filter(item =>
      Array.isArray(item.origin_country) &&
      item.origin_country.includes(String(f.region))
    );
  }

  if (f.genre) {
    const wanted = String(f.genre).split(",").map(x => x.trim());
    results = results.filter(item =>
      Array.isArray(item.genre_ids) &&
      wanted.some(id => item.genre_ids.map(String).includes(id))
    );
  }

  // 按热度排序；低热度影片可能不在有限关键词搜索结果内。
  results.sort((a, b) =>
    Number(b.popularity || 0) - Number(a.popularity || 0)
  );

  const total = results.length;
  const start = (page - 1) * PAGE_SIZE;
  const list = results
    .slice(start, start + PAGE_SIZE)
    .map(item => toVod(item, "movie"));

  await OmniBox.log(
    "warn",
    `[18+分类] 搜索去重后=${total}，当前页=${page}，当前页数量=${list.length}`
  );

  return {
    page,
    pagecount: Math.ceil(total / PAGE_SIZE),
    total,
    list
  };
}

async function home() {
  const classes = [
    { type_id: "movie", type_name: "电影" },
    { type_id: "tv", type_name: "电视剧" },
    { type_id: "variety", type_name: "综艺" }
  ];

  if (ENABLE_ADULT) {
    classes.push({
      type_id: "adult",
      type_name: "18+ 电影"
    });
  }

  const filters = {
    movie: [
      {
        key: "sort",
        name: "排序",
        value: [
          { n: "热门", v: "popularity.desc" },
          { n: "评分", v: "vote_average.desc" },
          { n: "最新", v: "primary_release_date.desc" }
        ]
      },
      {
        key: "genre",
        name: "类型",
        value: Object.entries(MOVIE_GENRES).map(([v, n]) => ({ n, v }))
      },
      {
        key: "region",
        name: "地区",
        value: [
          { n: "美国", v: "US" },
          { n: "日本", v: "JP" },
          { n: "韩国", v: "KR" },
          { n: "中国", v: "CN" },
          { n: "英国", v: "GB" }
        ]
      },
      {
        key: "year",
        name: "年份",
        value: Array.from({ length: 30 }, (_, i) => {
          const year = String(new Date().getFullYear() - i);
          return { n: year, v: year };
        })
      }
    ],
    tv: [
      {
        key: "sort",
        name: "排序",
        value: [
          { n: "热门", v: "popularity.desc" },
          { n: "评分", v: "vote_average.desc" },
          { n: "最新", v: "first_air_date.desc" }
        ]
      },
      {
        key: "genre",
        name: "类型",
        value: Object.entries(TV_GENRES).map(([v, n]) => ({ n, v }))
      },
      {
        key: "region",
        name: "地区",
        value: [
          { n: "美国", v: "US" },
          { n: "日本", v: "JP" },
          { n: "韩国", v: "KR" },
          { n: "中国", v: "CN" },
          { n: "英国", v: "GB" }
        ]
      }
    ],
    adult: [
      {
        key: "sort",
        name: "排序",
        value: [
          { n: "热门", v: "popularity.desc" },
          { n: "评分", v: "vote_average.desc" },
          { n: "最新", v: "primary_release_date.desc" }
        ]
      }
    ]
  };

  let list = [];

  try {
    const trending = await tmdbRequest(
      "/trending/movie/week",
      { page: "1" },
      false
    );

    list = (trending.results || [])
      .filter(item => item && item.adult !== true)
      .slice(0, 20)
      .map(item => toVod(item, "movie"));
  } catch (error) {
    await OmniBox.log(
      "warn",
      "[TMDB首页] 热门电影加载失败：" + error.message
    );
  }

  return {
    class: classes,
    filters,
    list
  };
}

async function category(params = {}) {
  const typeId = String(
    params.id ||
    params.type_id ||
    params.t ||
    "movie"
  );

  const page = normalizePage(params.page || 1);
  const filters = params.filters || {};

  try {
    if (typeId === "adult") {
      return await fetchAdultCategory(page, filters);
    }

    if (typeId === "tv") {
      return await fetchStandardCategory("tv", page, filters);
    }

    if (typeId === "variety") {
      const data = await tmdbRequest(
        "/discover/tv",
        {
          ...buildDiscoverParams(page, filters, "tv"),
          with_genres: "10764"
        },
        false
      );

      const results = Array.isArray(data.results) ? data.results : [];

      return {
        page: data.page || page,
        pagecount: data.total_pages || 0,
        total: data.total_results || results.length,
        list: results.map(item => toVod(item, "tv"))
      };
    }

    return await fetchStandardCategory("movie", page, filters);
  } catch (error) {
    await OmniBox.log(
      "warn",
      `[TMDB分类] type=${typeId}，page=${page}，错误=${error.message}`
    );

    return {
      page,
      pagecount: 0,
      total: 0,
      list: []
    };
  }
}

module.exports = {
  home,
  category
};

runner.run(module.exports);
