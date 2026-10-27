// @name TMDB推荐
// @indexs 1
// @author lampon (modified for TMDB)
// @description TMDB 推荐爬虫脚本（修复18+分类过滤）
// @version 2.4.0

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

// ============ 配置区 ============
const TMDB_API_KEY = "YOUR_TMDB_API_KEY_HERE";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const TMDB_LANG = "zh-CN";

// true = 显示18+分类；false = 隐藏18+分类
const ENABLE_ADULT = true;

module.exports = { home, category };
runner.run(module.exports);

// ============ genre 中文映射 ============
const GENRE_MAP = {
  12: "冒险",
  14: "奇幻",
  16: "动画",
  18: "剧情",
  27: "恐怖",
  28: "动作",
  35: "喜剧",
  36: "历史",
  37: "西部",
  53: "惊悚",
  80: "犯罪",
  99: "纪录片",
  878: "科幻",
  9648: "悬疑",
  10402: "音乐",
  10749: "爱情",
  10751: "家庭",
  10752: "战争",
  10759: "动作冒险",
  10762: "儿童",
  10763: "新闻",
  10764: "真人秀",
  10765: "科幻奇幻",
  10766: "肥皂剧",
  10767: "脱口秀",
  10768: "战争政治",
};

function genreNames(ids) {
  return (ids || [])
    .map((id) => GENRE_MAP[id])
    .filter(Boolean)
    .join(" / ");
}

// ============ 工具函数 ============
function buildTmdbLink(vodId, mediaType) {
  const type = mediaType === "tv" ? "tv" : "movie";
  return `https://www.themoviedb.org/${type}/${vodId}`;
}

function assertApiKey() {
  if (
    !TMDB_API_KEY ||
    TMDB_API_KEY === "YOUR_TMDB_API_KEY_HERE"
  ) {
    throw new Error(
      "未配置 TMDB_API_KEY，请到 https://www.themoviedb.org/settings/api 申请后填入脚本顶部"
    );
  }
}

// 统一 TMDB 请求
async function tmdbRequest(
  path,
  extraParams = {},
  includeAdult = false
) {
  assertApiKey();

  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: TMDB_LANG,
    include_adult: String(includeAdult),
    ...extraParams,
  });

  const url = `${TMDB_API}${path}?${params.toString()}`;

  const resp = await OmniBox.request(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: "https://www.themoviedb.org",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (resp.statusCode === 401) {
    throw new Error("TMDB API Key 无效（401）");
  }

  if (resp.statusCode === 429) {
    throw new Error("TMDB 请求过于频繁（429），请稍后再试");
  }

  if (resp.statusCode !== 200 || !resp.body) {
    throw new Error(`TMDB 请求失败: ${resp.statusCode}`);
  }

  const bodyStr =
    typeof resp.body === "string"
      ? resp.body
      : String(resp.body);

  return JSON.parse(bodyStr);
}

function proxyImage(path, baseURL, size = "w500") {
  if (!path) return "";

  const raw = path.startsWith("http")
    ? path
    : `${TMDB_IMG}/${size}${path}`;

  const urlWithHeaders =
    `${raw}@Referer=https://www.themoviedb.org`;

  return baseURL
    ? `${baseURL}/api/proxy/image?url=${encodeURIComponent(urlWithHeaders)}`
    : raw;
}

function extractYear(item) {
  const date = item.release_date || item.first_air_date || "";
  return date ? date.slice(0, 4) : "";
}

// 统一转换为 OmniBox vod 结构
function toVod(item, opts) {
  const { isMovie, typeId, typeName, baseURL } = opts;

  const title = isMovie ? item.title : item.name;
  const original = isMovie
    ? item.original_title
    : item.original_name;

  const genres = genreNames(item.genre_ids);
  const score = item.vote_average
    ? item.vote_average.toFixed(1)
    : "";

  const remarks = [
    item.vote_average ? `⭐ ${score}` : "",
    genres
      ? genres.split(" / ").slice(0, 2).join(" ")
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    vod_id: String(item.id),
    link: buildTmdbLink(
      item.id,
      isMovie ? "movie" : "tv"
    ),
    vod_name: title || "",
    search: true,
    vod_pic: proxyImage(
      item.poster_path,
      baseURL,
      "w500"
    ),
    type_id: typeId,
    type_name: typeName,
    vod_remarks: remarks,
    vod_year: extractYear(item),
    vod_douban_score: score,
    vod_subtitle: original || "",
  };
}

// ============ 筛选器定义 ============
const MOVIE_GENRES = [
  { name: "全部", value: "" },
  { name: "动作", value: "28" },
  { name: "冒险", value: "12" },
  { name: "动画", value: "16" },
  { name: "喜剧", value: "35" },
  { name: "犯罪", value: "80" },
  { name: "纪录片", value: "99" },
  { name: "剧情", value: "18" },
  { name: "家庭", value: "10751" },
  { name: "奇幻", value: "14" },
  { name: "历史", value: "36" },
  { name: "恐怖", value: "27" },
  { name: "音乐", value: "10402" },
  { name: "悬疑", value: "9648" },
  { name: "爱情", value: "10749" },
  { name: "科幻", value: "878" },
  { name: "惊悚", value: "53" },
  { name: "战争", value: "10752" },
  { name: "西部", value: "37" },
];

const TV_GENRES = [
  { name: "全部", value: "" },
  { name: "动作冒险", value: "10759" },
  { name: "动画", value: "16" },
  { name: "喜剧", value: "35" },
  { name: "犯罪", value: "80" },
  { name: "纪录片", value: "99" },
  { name: "剧情", value: "18" },
  { name: "家庭", value: "10751" },
  { name: "悬疑", value: "9648" },
  { name: "新闻", value: "10763" },
  { name: "真人秀", value: "10764" },
  { name: "科幻奇幻", value: "10765" },
  { name: "肥皂剧", value: "10766" },
  { name: "脱口秀", value: "10767" },
  { name: "战争政治", value: "10768" },
  { name: "西部", value: "37" },
];

const REGIONS = [
  { name: "全部", value: "" },
  { name: "中国", value: "CN" },
  { name: "美国", value: "US" },
  { name: "日本", value: "JP" },
  { name: "韩国", value: "KR" },
  { name: "英国", value: "GB" },
  { name: "法国", value: "FR" },
  { name: "德国", value: "DE" },
  { name: "印度", value: "IN" },
  { name: "中国香港", value: "HK" },
  { name: "中国台湾", value: "TW" },
  { name: "泰国", value: "TH" },
];

const YEARS = [{ name: "全部", value: "" }];

for (let year = 2026; year >= 1960; year--) {
  YEARS.push({
    name: String(year),
    value: String(year),
  });
}

const SORTS = [
  { name: "热度", value: "popularity.desc" },
  { name: "评分", value: "vote_average.desc" },
  { name: "最新", value: "primary_release_date.desc" },
];

function buildFilters(isMovie) {
  return [
    {
      key: "genre",
      name: "类型",
      init: "",
      value: isMovie ? MOVIE_GENRES : TV_GENRES,
    },
    {
      key: "region",
      name: "地区",
      init: "",
      value: REGIONS,
    },
    {
      key: "year",
      name: "年代",
      init: "",
      value: YEARS,
    },
    {
      key: "sort",
      name: "排序",
      init: "popularity.desc",
      value: SORTS,
    },
  ];
}

// ============ 18+ 分类专用请求 ============
// 注意：include_adult=true 允许返回成人内容，
// 但结果中仍可能包含 adult=false 的普通电影。
// 所以必须对每条结果进行二次过滤。
async function fetchAdultCategory(page, filters) {
  const params = {
    page: String(page),
    sort_by: filters.sort || "popularity.desc",
    include_video: "false",
  };

  if (filters.genre) {
    params.with_genres = String(filters.genre);
  }

  if (filters.region) {
    params.with_origin_country = String(filters.region);
  }

  if (filters.year) {
    params.primary_release_year = String(filters.year);
  }

  const data = await tmdbRequest(
    "/discover/movie",
    params,
    true
  );

  // 核心修复：过滤掉所有未被 TMDB 明确标记为成人的影片。
  const adultResults = (data.results || []).filter(
    (item) => item && item.adult === true
  );

  return {
    ...data,
    results: adultResults,
    total_results: adultResults.length,
    total_pages: adultResults.length > 0 ? 1 : 0,
  };
}

// ============ 首页 ============
async function home(params, context) {
  const baseURL = context.baseURL || "";

  const classes = [
    { type_id: "movie", type_name: "电影" },
    { type_id: "tv", type_name: "剧集" },
    { type_id: "show", type_name: "综艺" },
  ];

  if (ENABLE_ADULT) {
    classes.push({
      type_id: "adult_movie",
      type_name: "18+ 电影",
    });
  }

  classes.push(
    { type_id: "movie_filter", type_name: "电影筛选" },
    { type_id: "tv_filter", type_name: "剧集筛选" },
    { type_id: "show_filter", type_name: "综艺筛选" }
  );

  // Banner
  let banner = [];

  try {
    const trend = await tmdbRequest(
      "/trending/all/week",
      {},
      false
    );

    banner = (trend.results || [])
      .slice(0, 5)
      .map((item) => {
        const mediaType =
          item.media_type === "tv" ? "tv" : "movie";

        return {
          title: item.title || item.name || "",
          subtitle:
            item.original_title ||
            item.original_name ||
            "",
          backgroundImage: proxyImage(
            item.backdrop_path,
            baseURL,
            "original"
          ),
          genre: genreNames(item.genre_ids),
          actors: "",
          description: item.overview || "",
          link: buildTmdbLink(item.id, mediaType),
        };
      });
  } catch (e) {
    await OmniBox.log(
      "warn",
      `Banner 失败: ${e.message}`
    );
  }

  // 首页列表：本周热门剧集
  let list = [];

  try {
    const data = await tmdbRequest(
      "/trending/tv/week",
      {},
      false
    );

    list = (data.results || []).map((item) =>
      toVod(item, {
        isMovie: false,
        typeId: "tv",
        typeName: "剧集",
        baseURL,
      })
    );
  } catch (e) {
    await OmniBox.log(
      "warn",
      `首页列表失败: ${e.message}`
    );
  }

  const filters = {
    movie: buildFilters(true),
    tv: buildFilters(false),
    show: buildFilters(false),
    movie_filter: buildFilters(true),
    tv_filter: buildFilters(false),
    show_filter: buildFilters(false),
  };

  if (ENABLE_ADULT) {
    filters.adult_movie = buildFilters(true);
  }

  return {
    class: classes,
    list,
    banner,
    filters,
  };
}

// ============ 分类 ============
async function category(params, context) {
  const baseURL = context.baseURL || "";
  const categoryId = params.categoryId || "movie";
  const page = Number(params.page) || 1;
  const filters = params.filters || {};
  const limit = 20;

  const categoryNames = {
    movie: "电影",
    tv: "剧集",
    show: "综艺",
    movie_filter: "电影筛选",
    tv_filter: "剧集筛选",
    show_filter: "综艺筛选",
    adult_movie: "18+ 电影",
  };

  const typeName =
    categoryNames[categoryId] || "未知";

  const isAdultCategory =
    categoryId === "adult_movie";

  const isMovie =
    categoryId.startsWith("movie") ||
    isAdultCategory;

  const isShow =
    categoryId.startsWith("show");

  const isFilter =
    categoryId.endsWith("_filter");

  if (isAdultCategory && !ENABLE_ADULT) {
    await OmniBox.log(
      "warn",
      "18+ 分类已关闭（ENABLE_ADULT=false）"
    );

    return {
      page,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }

  const hasFilter = Boolean(
    filters.genre ||
    filters.region ||
    filters.year ||
    (filters.sort &&
      filters.sort !== "popularity.desc")
  );

  let data = null;

  try {
    if (isAdultCategory) {
      // 18+ 分类：只保留 adult === true 的影片
      data = await fetchAdultCategory(
        page,
        filters
      );
    } else if (!isFilter && !hasFilter) {
      // 普通分类：热门电影或剧集
      const path = isMovie
        ? "/movie/popular"
        : "/tv/popular";

      data = await tmdbRequest(
        path,
        { page: String(page) },
        false
      );
    } else {
      // 普通筛选页
      const p = {
        page: String(page),
        sort_by:
          filters.sort || "popularity.desc",
      };

      if (isShow) {
        p.with_genres =
          filters.genre || "10764,10767";
      } else if (filters.genre) {
        p.with_genres = filters.genre;
      }

      if (filters.region) {
        p.with_origin_country = filters.region;
      }

      if (filters.year) {
        if (isMovie) {
          p.primary_release_year =
            filters.year;
        } else {
          p.first_air_date_year =
            filters.year;
        }
      }

      if (
        (filters.sort || "").includes(
          "vote_average"
        )
      ) {
        p["vote_count.gte"] = "200";
      }

      data = await tmdbRequest(
        isMovie
          ? "/discover/movie"
          : "/discover/tv",
        p,
        false
      );
    }
  } catch (e) {
    await OmniBox.log(
      "warn",
      `分类数据失败: ${e.message}`
    );

    return {
      page,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }

  // 最后再做一道安全过滤，确保18+分类不会混入普通电影。
  let results = data.results || [];

  if (isAdultCategory) {
    results = results.filter(
      (item) => item && item.adult === true
    );
  }

  const list = results.map((item) =>
    toVod(item, {
      isMovie,
      typeId: categoryId,
      typeName,
      baseURL,
    })
  );

  const total = Math.min(
    data.total_results || list.length,
    10000
  );

  const pagecount = Math.ceil(
    total / limit
  );

  return {
    page,
    pagecount,
    total,
    list,
  };
}
