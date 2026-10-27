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

// 18+ 开关：true = 显示成人分类
// false = 隐藏成人分类
const ENABLE_ADULT = true;

module.exports = { home, category };
runner.run(module.exports);

// ============ genre 中文映射 ============
const GENRE_MAP = {
  12: "冒险", 14: "奇幻", 16: "动画", 18: "剧情", 27: "恐怖",
  28: "动作", 35: "喜剧", 36: "历史", 37: "西部", 53: "惊悚",
  80: "犯罪", 99: "纪录片", 878: "科幻", 9648: "悬疑",
  10402: "音乐", 10749: "爱情", 10751: "家庭", 10752: "战争",
  10759: "动作冒险", 10762: "儿童", 10763: "新闻", 10764: "真人秀",
  10765: "科幻奇幻", 10766: "肥皂剧", 10767: "脱口秀", 10768: "战争政治",
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
  if (!TMDB_API_KEY || TMDB_API_KEY === "YOUR_TMDB_API_KEY_HERE") {
    throw new Error(
      "未配置 TMDB_API_KEY，请到 https://www.themoviedb.org/settings/api 申请后填入脚本顶部"
    );
  }
}

/**
 * 统一 TMDB 请求
 */
async function tmdbRequest(path, extraParams = {}, includeAdult = false) {
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
      "Accept": "application/json",
      "Referer": "https://www.themoviedb.org",
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

  const urlWithHeaders = `${raw}@Referer=https://www.themoviedb.org`;

  return baseURL
    ? `${baseURL}/api/proxy/image?url=${encodeURIComponent(urlWithHeaders)}`
    : raw;
}

function extractYear(item) {
  const d = item.release_date || item.first_air_date || "";
  return d ? d.slice(0, 4) : "";
}

// ==================================================
// 18+ 分类识别：仅使用 TMDB 数据
// ==================================================

// 常见番号格式：
// SSIS-123
// IPX-123
// ABC-1234
// FC2-PPV-1234567
// HEYZO-1234
// 1PONDO-123456-789

const ADULT_CODE_RE =
  /(?:^|[^A-Z0-9])(?:FC2[-_ ]?PPV[-_ ]?\d{5,10}|HEYZO[-_ ]?\d{3,6}|1PONDO[-_ ]?\d{4,8}[-_ ]?\d{2,5}|[A-Z]{2,10}[-_ ]\d{2,6})(?=$|[^A-Z0-9])/i;

// 明确的成人关键词。
// 不把普通爱情、恐怖、R级电影自动判定为成人影片。
const ADULT_KEYWORD_RE =
  /^(adult(?: film| movie| video| entertainment)?|adult only|porn(?:ography|ographic)?|xxx|erotic film|sexploitation|softcore pornography|hardcore pornography|成人电影|成人影片|成人内容|色情电影|情色电影)$/i;

// 判断标题或原始标题是否包含番号
function hasAdultCode(item) {
  const title = [
    item.title,
    item.original_title,
    item.name,
    item.original_name,
  ]
    .filter(Boolean)
    .join(" ");

  return ADULT_CODE_RE.test(title);
}

// 判断 TMDB 关键词是否包含明确成人标签
function hasAdultKeyword(keywords) {
  return (keywords || []).some((keyword) => {
    const name =
      typeof keyword === "string"
        ? keyword
        : (keyword && keyword.name) || "";

    return ADULT_KEYWORD_RE.test(name.trim());
  });
}

// 通过 TMDB 详情关键词接口识别成人作品
async function isAdultMovie(item) {
  // 1. 标题包含番号
  if (hasAdultCode(item)) {
    return true;
  }

  // 2. TMDB 明确标记为成人内容
  if (item.adult === true) {
    return true;
  }

  // 3. 查询 TMDB 自身的作品关键词
  try {
    const result = await tmdbRequest(
      `/movie/${item.id}/keywords`,
      {},
      true
    );

    return hasAdultKeyword(
      result.keywords || result.results || []
    );
  } catch (e) {
    await OmniBox.log(
      "warn",
      `TMDB 成人关键词查询失败（${item.id}）：${e.message}`
    );

    // 无法确认时不放入18+分类
    return false;
  }
}

// 获取18+分类数据
// 每个导航页最多扫描3页TMDB候选数据，尽量补足20条。
// 不使用任何外部成人影片数据库。
async function getAdultPage(filters, page) {
  const limit = 20;
  const candidatePagesPerPage = 3;

  // 每个导航页对应不同的候选页范围
  const firstCandidatePage =
    (page - 1) * candidatePagesPerPage + 1;

  const accepted = [];
  let candidateTotal = 0;

  for (
    let offset = 0;
    offset < candidatePagesPerPage && accepted.length < limit;
    offset++
  ) {
    const candidatePage = firstCandidatePage + offset;

    const p = {
      page: String(candidatePage),
      sort_by: filters.sort || "popularity.desc",
      "vote_count.gte": "0",
    };

    if (filters.genre) {
      p.with_genres = filters.genre;
    }

    if (filters.region) {
      p.with_origin_country = filters.region;
    }

    if (filters.year) {
      p.primary_release_year = filters.year;
    }

    const data = await tmdbRequest(
      "/discover/movie",
      p,
      true
    );

    candidateTotal =
      Number(data.total_results) || candidateTotal;

    const candidates = data.results || [];

    // 每批最多5个并发关键词请求，降低请求过快的概率
    for (
      let i = 0;
      i < candidates.length && accepted.length < limit;
      i += 5
    ) {
      const batch = candidates.slice(i, i + 5);

      const checked = await Promise.all(
        batch.map(async (item) =>
          (await isAdultMovie(item)) ? item : null
        )
      );

      accepted.push(...checked.filter(Boolean));
    }
  }

  return {
    results: accepted.slice(0, limit),
    total_results: candidateTotal
      ? Math.min(candidateTotal, 10000)
      : accepted.length,
    total_pages: candidateTotal
      ? Math.ceil(candidateTotal / limit)
      : 1,
  };
}

// ============ 统一 VOD 数据转换 ============
function toVod(item, opts) {
  const {
    isMovie,
    typeId,
    typeName,
    baseURL,
  } = opts;

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

// ============ 首页 ============
async function home(params, context) {
  const baseURL = context.baseURL || "";

  const classes = [
    { type_id: "movie", type_name: "电影" },
    { type_id: "tv", type_name: "剧集" },
    { type_id: "show", type_name: "综艺" },
  ];

  // 只有开关打开时才显示成人分类
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

  // ---- Banner ----
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
        const mt =
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
          link: buildTmdbLink(item.id, mt),
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

  // 成人分类在开关关闭时直接拒绝
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
      // 仅使用 TMDB 数据进行成人识别
      data = await getAdultPage(filters, page);
    } else if (!isFilter && !hasFilter) {
      // 综合推荐：popular
      const path = isMovie
        ? "/movie/popular"
        : "/tv/popular";

      data = await tmdbRequest(
        path,
        { page: String(page) },
        false
      );
    } else {
      // 筛选页 / 带筛选：discover
      const p = {
        page: String(page),
        include_adult: "false",
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
          p.primary_release_year = filters.year;
        } else {
          p.first_air_date_year = filters.year;
        }
      }

      if (
        (filters.sort || "").includes("vote_average")
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

  const results = data.results || [];

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

  const pagecount = Math.ceil(total / limit);

  return {
    page,
    pagecount,
    total,
    list,
  };
}
