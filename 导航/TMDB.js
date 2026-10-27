// @name TMDB推荐
// @indexs 1
// @author lampon (modified for TMDB)
// @description TMDB 推荐爬虫脚本（含 18+ 开关）
// @version 2.3.0

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

// ============ 配置区 ============
// TMDB API Key（v3 auth key）
// 申请地址: https://www.themoviedb.org/settings/api
const TMDB_API_KEY = "YOUR_TMDB_API_KEY_HERE";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const TMDB_LANG = "zh-CN";

// 18+ 开关：true = 显示18+分类并允许请求成人内容
// false = 隐藏18+分类，其他分类不包含成人内容
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

/**
 * 统一 TMDB 请求
 *
 * includeAdult:
 * true  = include_adult=true
 * false = include_adult=false
 *
 * 最终开关由此参数决定，防止额外参数覆盖。
 */
async function tmdbRequest(
  path,
  extraParams = {},
  includeAdult = false
) {
  assertApiKey();

  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: TMDB_LANG,
    ...extraParams,
  });

  // 强制设置最终成人开关
  params.set(
    "include_adult",
    String(Boolean(includeAdult))
  );

  const url =
    `${TMDB_API}${path}?${params.toString()}`;

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
    throw new Error(
      "TMDB 请求过于频繁（429），请稍后再试"
    );
  }

  if (resp.statusCode !== 200 || !resp.body) {
    throw new Error(
      `TMDB 请求失败: ${resp.statusCode}`
    );
  }

  const bodyStr =
    typeof resp.body === "string"
      ? resp.body
      : String(resp.body);

  return JSON.parse(bodyStr);
}

function proxyImage(
  path,
  baseURL,
  size = "w500"
) {
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
  const d =
    item.release_date ||
    item.first_air_date ||
    "";

  return d ? d.slice(0, 4) : "";
}

// ============ 统一 VOD 结构 ============

function toVod(item, opts) {
  const {
    isMovie,
    typeId,
    typeName,
    baseURL,
  } = opts;

  const title = isMovie
    ? item.title
    : item.name;

  const original = isMovie
    ? item.original_title
    : item.original_name;

  const genres = genreNames(item.genre_ids);

  const score = item.vote_average
    ? Number(item.vote_average).toFixed(1)
    : "";

  const remarks = [
    item.vote_average
      ? `⭐ ${score}`
      : "",
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

const YEARS = [
  { name: "全部", value: "" },
];

for (let y = 2026; y >= 1960; y--) {
  YEARS.push({
    name: String(y),
    value: String(y),
  });
}

const SORTS = [
  {
    name: "热度",
    value: "popularity.desc",
  },
  {
    name: "评分",
    value: "vote_average.desc",
  },
  {
    name: "最新",
    value: "primary_release_date.desc",
  },
];

function buildFilters(isMovie) {
  return [
    {
      key: "genre",
      name: "类型",
      init: "",
      value: isMovie
        ? MOVIE_GENRES
        : TV_GENRES,
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

// ============ 成人关键词补充查询 ============

// 通过 TMDB 自身的关键词搜索接口获取 ID。
// 不把 erotic、sexy、nudity 单独当作成人分类条件，
// 避免大量普通电影混进 18+ 分类。
const ADULT_KEYWORD_QUERIES = [
  "pornography",
  "porn industry",
  "adult animation",
  "erotic movie",
  "softcore",
  "japanese adult video",
];

let adultKeywordIdsPromise = null;

async function getAdultKeywordIds() {
  if (!adultKeywordIdsPromise) {
    adultKeywordIdsPromise = (async () => {
      const ids = new Set();

      for (const query of ADULT_KEYWORD_QUERIES) {
        try {
          const data = await tmdbRequest(
            "/search/keyword",
            {
              query,
              page: "1",
            },
            true
          );

          const wanted =
            query.toLowerCase().trim();

          for (const item of (
            data.results || []
          )) {
            const name = String(
              item.name || ""
            )
              .toLowerCase()
              .trim();

            if (
              item.id &&
              (
                name === wanted ||
                name.includes(wanted)
              )
            ) {
              ids.add(String(item.id));
            }
          }
        } catch (e) {
          await OmniBox.log(
            "warn",
            `成人关键词查询失败 (${query}): ${e.message}`
          );
        }
      }

      // 已知 TMDB 关键词 ID
      ids.add("445");    // pornography
      ids.add("18321");  // porn industry

      return Array.from(ids);
    })();
  }

  return adultKeywordIdsPromise;
}

// ============ 成人分类筛选辅助函数 ============

function applyMovieFilters(p, filters) {
  if (filters.genre) {
    p.with_genres = String(filters.genre);
  }

  if (filters.region) {
    p.with_origin_country =
      String(filters.region);
  }

  if (filters.year) {
    p.primary_release_year =
      String(filters.year);
  }

  return p;
}

async function fetchAdultCategory(
  page,
  filters
) {
  const sortBy =
    filters.sort || "popularity.desc";

  const baseParams = applyMovieFilters(
    {
      page: String(page),
      sort_by: sortBy,
      include_video: "true",
    },
    filters
  );

  // 第一来源：
  // TMDB 自身 adult 标记。
  //
  // 不设置 vote_count.gte，避免低投票量影片被排除。
  const primary = await tmdbRequest(
    "/discover/movie",
    baseParams,
    true
  );

  // 第二来源：
  // 使用 TMDB 成人关键词补充。
  //
  // with_keywords 使用 | 表示 OR，
  // 不使用逗号 AND，避免影片必须同时匹配所有关键词。
  try {
    const ids = await getAdultKeywordIds();

    if (ids.length > 0) {
      const keywordParams = {
        ...baseParams,
        with_keywords: ids.join("|"),
      };

      const tagged = await tmdbRequest(
        "/discover/movie",
        keywordParams,
        true
      );

      // 合并并去重
      const merged = new Map();

      for (const item of [
        ...(primary.results || []),
        ...(tagged.results || []),
      ]) {
        if (
          item &&
          item.id != null
        ) {
          merged.set(
            String(item.id),
            item
          );
        }
      }

      const all = Array.from(
        merged.values()
      );

      // 重新排序合并后的数据
      if (sortBy === "vote_average.desc") {
        all.sort((a, b) => {
          const scoreDiff =
            Number(b.vote_average || 0) -
            Number(a.vote_average || 0);

          if (scoreDiff !== 0) {
            return scoreDiff;
          }

          return (
            Number(b.vote_count || 0) -
            Number(a.vote_count || 0)
          );
        });
      } else if (
        sortBy === "primary_release_date.desc"
      ) {
        all.sort((a, b) => {
          return String(
            b.release_date || ""
          ).localeCompare(
            String(a.release_date || "")
          );
        });
      } else {
        all.sort((a, b) => {
          return (
            Number(b.popularity || 0) -
            Number(a.popularity || 0)
          );
        });
      }

      return {
        ...primary,
        results: all.slice(0, 20),

        // 两个结果集存在交集，不能直接相加。
        total_results: Math.max(
          Number(primary.total_results || 0),
          Number(tagged.total_results || 0)
        ),

        total_pages: Math.max(
          Number(primary.total_pages || 0),
          Number(tagged.total_pages || 0)
        ),
      };
    }
  } catch (e) {
    await OmniBox.log(
      "warn",
      `成人关键词补充失败，继续使用 TMDB adult 标记结果: ${e.message}`
    );
  }

  return primary;
}

// ============ 首页 home ============

async function home(params, context) {
  const baseURL = context.baseURL || "";

  const classes = [
    {
      type_id: "movie",
      type_name: "电影",
    },
    {
      type_id: "tv",
      type_name: "剧集",
    },
    {
      type_id: "show",
      type_name: "综艺",
    },
  ];

  // 成人开关打开时显示 18+ 分类
  if (ENABLE_ADULT) {
    classes.push({
      type_id: "adult_movie",
      type_name: "18+ 电影",
    });
  }

  classes.push(
    {
      type_id: "movie_filter",
      type_name: "电影筛选",
    },
    {
      type_id: "tv_filter",
      type_name: "剧集筛选",
    },
    {
      type_id: "show_filter",
      type_name: "综艺筛选",
    }
  );

  // ---- Banner ----
  let banner = [];

  try {
    const trend = await tmdbRequest(
      "/trending/all/week",
      {},
      false
    );

    banner = (
      trend.results || []
    )
      .slice(0, 5)
      .map((item) => {
        const mt =
          item.media_type === "tv"
            ? "tv"
            : "movie";

        return {
          title:
            item.title ||
            item.name ||
            "",

          subtitle:
            item.original_title ||
            item.original_name ||
            "",

          backgroundImage: proxyImage(
            item.backdrop_path,
            baseURL,
            "original"
          ),

          genre: genreNames(
            item.genre_ids
          ),

          actors: "",

          description:
            item.overview || "",

          link: buildTmdbLink(
            item.id,
            mt
          ),
        };
      });
  } catch (e) {
    await OmniBox.log(
      "warn",
      `Banner 失败: ${e.message}`
    );
  }

  // ---- 首页列表：本周热门剧集 ----
  let list = [];

  try {
    const data = await tmdbRequest(
      "/trending/tv/week",
      {},
      false
    );

    list = (
      data.results || []
    ).map((item) =>
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
    filters.adult_movie =
      buildFilters(true);
  }

  return {
    class: classes,
    list,
    banner,
    filters,
  };
}

// ============ 分类 category ============

async function category(params, context) {
  const baseURL = context.baseURL || "";

  const categoryId =
    params.categoryId || "movie";

  const page =
    Number(params.page) || 1;

  const filters =
    params.filters || {};

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

  // 成人分类开关关闭时拒绝访问
  if (
    isAdultCategory &&
    !ENABLE_ADULT
  ) {
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
    (
      filters.sort &&
      filters.sort !== "popularity.desc"
    )
  );

  let data = null;

  try {
    if (isAdultCategory) {
      // 成人分类：
      // TMDB adult 标记 + 成人关键词补充。
      // 不设置最低投票数限制。
      data = await fetchAdultCategory(
        page,
        filters
      );
    } else if (
      !isFilter &&
      !hasFilter
    ) {
      // 综合推荐：popular
      const path = isMovie
        ? "/movie/popular"
        : "/tv/popular";

      data = await tmdbRequest(
        path,
        {
          page: String(page),
        },
        false
      );
    } else {
      // 普通筛选页
      const p = {
        page: String(page),
        sort_by:
          filters.sort ||
          "popularity.desc",
      };

      if (isShow) {
        p.with_genres =
          filters.genre ||
          "10764,10767";
      } else if (filters.genre) {
        p.with_genres =
          filters.genre;
      }

      if (filters.region) {
        p.with_origin_country =
          filters.region;
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
        (filters.sort || "")
          .includes("vote_average")
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

  const results =
    data.results || [];

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
