// @name OpenList影视库通用版 (支持自动分类与懒加载)
const OmniBox = require("omnibox_sdk");

// ==========================================
// 必填配置，地址和令牌，路径
// ==========================================
const OPENLIST_URL   = "http://192.168.2.31:5255";
const OPENLIST_TOKEN = "";
// 内容根目录（脚本会自动扫描此目录下的第一层子文件夹作为分类）
const CONTENT_ROOT   = "/cloud-strm";

// ==========================================
// 选填配置，没图必填
// ==========================================
// 如果在这里填写了 TMDB_API，则优先使用填写的！
// 如果为空，则自动尝试使用前端传递的参数（如 params.tmdb_api）
const TMDB_API = "";

const PAGE_SIZE = 20;

// ===== 缓存 =====
let CATEGORIES     = null;
let CATEGORY_CACHE = {};

// 获取当前请求的 TMDB API Key（优先使用手动填写的，没填则使用前端下发的）
function getTmdbKey(params = {}) {
    return TMDB_API || params.tmdb_api || params.tmdb_key;
}

// ===== API 请求 =====
async function request(path, body, timeout = 15000) {
    try {
        const res = await OmniBox.request(`${OPENLIST_URL}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": OPENLIST_TOKEN
            },
            body: JSON.stringify(body),
            timeout
        });
        try { return JSON.parse(res.body).data; } catch { return null; }
    } catch (e) {
        OmniBox.log("error", `请求失败: ${e.message}`);
        return null;
    }
}

async function listDir(path) {
    if (!path) return [];
    const data = await request("/api/fs/list", { path });
    if (!data || !data.content) return [];
    return data.content;
}

async function getFileInfo(path) {
    return await request("/api/fs/get", { path });
}

// ===== 工具函数 =====
function isDirectory(item) {
    return item.is_dir === true ||
        item.type === 1 ||
        item.type === "dir" ||
        item.mime_type === "inode/directory";
}

function extractTMDBId(name) {
    const match = name.match(/tmdbid=(\d+)/i);
    return match ? match[1] : null;
}

// 根据文件夹名自动识别 TMDB 类型
function detectType(folderName) {
    const tvKeywords = ["电视剧", "剧集", "连续剧", "日剧", "韩剧", "美剧", "综艺", "动漫", "动画", "tv", "series"];
    const lower = folderName.toLowerCase();
    return tvKeywords.some(k => lower.includes(k)) ? "tv" : "movie";
}

// 视频文件支持后缀
const VIDEO_EXTS = [".strm", ".mp4", ".mkv", ".avi", ".rmvb", ".mov", ".flv", ".wmv", ".ts"];

function isVideoFile(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return VIDEO_EXTS.some(ext => lower.endsWith(ext));
}

function removeVideoExt(name) {
    if (!name) return "";
    for (const ext of VIDEO_EXTS) {
        if (name.toLowerCase().endsWith(ext)) {
            return name.slice(0, -ext.length);
        }
    }
    return name;
}

// ===== 获取分类列表（自动扫描根目录第一层子文件夹）=====
async function getCategories(forceRefresh = false) {
    if (!forceRefresh && CATEGORIES) return CATEGORIES;

    OmniBox.log("info", `扫描根目录获取分类: ${CONTENT_ROOT}`);
    const items = await listDir(CONTENT_ROOT);

    CATEGORIES = items
        .filter(item => item && isDirectory(item))
        .map(item => {
            const name = item.name;
            const path = CONTENT_ROOT.replace(/\/$/, "") + "/" + name;
            const type = detectType(name);
            OmniBox.log("info", `  📁 分类: ${name} → ${type}`);
            return { type_id: path, type_name: name, media_type: type };
        });

    CATEGORIES.push({
        type_id: "openlist_raw_root",
        type_name: "📂 全部文件",
        media_type: "raw"
    });

    OmniBox.log("info", `共识别 ${CATEGORIES.length} 个分类 (包含免刮削分类)`);
    return CATEGORIES;
}

// 获取或初始化某个分类的缓存
function getCacheFor(path) {
    if (!CATEGORY_CACHE[path]) {
        CATEGORY_CACHE[path] = { movies: [], loaded: false, scanning: false };
    }
    return CATEGORY_CACHE[path];
}

// ===== TMDB 刮削（支持 movie / tv，含 credits）=====
async function getTMDBInfo(id, type = "movie", tmdbKey = TMDB_API) {
    if (!tmdbKey || !id) return null;
    try {
        const endpoint = type === "tv" ? "tv" : "movie";
        // append_to_response=credits 一次请求同时获取演职员信息
        const res = await OmniBox.request(
            `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${tmdbKey}&language=zh-CN&append_to_response=credits`,
            { timeout: 8000 }
        );
        const data = JSON.parse(res.body);

        // 导演（电影）/ 主创（电视剧）
        let director = "";
        if (type === "tv" && data.created_by && data.created_by.length) {
            director = data.created_by.map(p => p.name).slice(0, 3).join(" / ");
        } else if (data.credits && data.credits.crew) {
            director = data.credits.crew
                .filter(p => p.job === "Director")
                .map(p => p.name).slice(0, 3).join(" / ");
        }

        // 主要演员（取前6位）
        const actor = (data.credits && data.credits.cast)
            ? data.credits.cast.slice(0, 6).map(p => p.name).join(" / ")
            : "";

        return {
            title:    data.title || data.name || "",
            pic:      data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "",
            backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "",
            year:     (data.release_date || data.first_air_date || "").substring(0, 4),
            desc:     data.overview || "",
            director: director,
            actor:    actor
        };
    } catch (e) {
        OmniBox.log("error", `TMDB 请求失败 id=${id}: ${e.message}`);
        return null;
    }
}

// ===== 并行构建 VOD 列表 =====
async function buildVodList(items, type = "movie", tmdbKey) {
    if (!items || items.length === 0) return [];

    // 免刮削分类，直接返回原始数据，不走 TMDB
    if (type === "raw") {
        return items.map(media => ({
            vod_id:      media.vod_id,
            vod_name:    media.display_name,
            vod_pic:     media.is_dir ? "https://img.icons8.com/color/48/folder-invoices--v1.png" : "https://img.icons8.com/color/48/video-file.png",
            vod_tag:     media.is_dir ? "folder" : "file",
            vod_year:    "",
            vod_remarks: media.is_dir ? "目录" : "视频"
        }));
    }

    const tmdbResults = await Promise.all(
        items.map(m => m.tmdb_id ? getTMDBInfo(m.tmdb_id, type) : Promise.resolve(null))
    );
    return items.map((movie, i) => {
        const tmdb = tmdbResults[i];
        if (tmdb) {
            return {
                vod_id:      movie.vod_id,
                vod_name:    tmdb.title,
                vod_pic:     tmdb.pic,
                vod_year:    tmdb.year,
                vod_remarks: movie.display_name
            };
        }
        return { vod_id: movie.vod_id, vod_name: movie.display_name, vod_pic: "" };
    });
}

// ===== 递归扫描目录（用于电影 / 电视剧集数）=====
async function scanDirectoryForMedia(path, depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return [];

    const items = await listDir(path);
    if (!items || items.length === 0) return [];

    const result = [];
    for (const item of items) {
        if (!item) continue;
        const itemName = item.name || "";
        const isDir = isDirectory(item);
        const itemPath = path.replace(/\/$/, "") + "/" + itemName;

        if (isVideoFile(itemName)) {
            const tmdbId = extractTMDBId(itemName);
            const cleanName = removeVideoExt(itemName);
            const parts = itemPath.split("/");
            const folderName = parts.length >= 2 ? parts[parts.length - 2] : cleanName;

            result.push({
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: folderName,
                tmdb_id:      tmdbId,
                _folder:      folderName   // 所属文件夹名（用于分季）
            });
        } else if (isDir) {
            const sub = await scanDirectoryForMedia(itemPath, depth + 1, maxDepth);
            result.push(...sub);
        }
    }
    return result;
}

// ===== 扫描电视剧分类：递归寻找真正的剧名文件夹 =====
// 判断依据：文件夹名包含 tmdbid → 是剧；没有 tmdbid → 是中间分类，继续递归
async function scanTVShows(path, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];

    const items = await listDir(path);
    if (!items || items.length === 0) return [];

    const shows = [];
    for (const item of items) {
        if (!item || !isDirectory(item)) continue;
        const itemName = item.name || "";
        const itemPath = path.replace(/\/$/, "") + "/" + itemName;
        const tmdbId   = extractTMDBId(itemName);

        if (tmdbId) {
            // 有 tmdbid → 这是真正的剧名文件夹，直接收录
            const cleanName = itemName.replace(/\s*tmdbid=\d+/i, "").trim();
            shows.push({
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: cleanName,
                tmdb_id:      tmdbId,
                is_show:      true
            });
        } else {
            // 没有 tmdbid → 可能是中间分类文件夹（如"华语"、"欧美"），继续递归
            OmniBox.log("info", `  递归进入子分类: ${itemName}`);
            const sub = await scanTVShows(itemPath, depth + 1, maxDepth);
            shows.push(...sub);
        }
    }

    if (depth === 0) OmniBox.log("info", `TV 分类共找到 ${shows.length} 部剧`);
    return shows;
}

// ===== 扫描免刮削根目录 =====
async function scanRawCategory(targetPath = CONTENT_ROOT) {
    OmniBox.log("info", `扫描免刮削目录: ${targetPath}`);
    const items = await listDir(targetPath);
    if (!items || items.length === 0) return [];

    const results = [];
    for (const item of items) {
        if (!item) continue;
        const itemName = item.name || "";
        const itemPath = targetPath.replace(/\/$/, "") + "/" + itemName;
        const isDir = isDirectory(item);
        
        if (isDir || isVideoFile(itemName)) {
            results.push({
                // 给目录类型拼上前缀，触发前端通过 category 方法重新拉取
                vod_id:       isDir ? `rawdir#${itemPath}` : itemPath,
                vod_name:     itemName,
                display_name: itemName,
                tmdb_id:      null,
                is_dir:       isDir
            });
        }
    }
    return results;
}

// ===== 扫描分类目录（带缓存，根据 mediaType 选策略）=====
async function scanCategoryWithCache(path, mediaType = "movie", forceRefresh = false) {
    const cache = getCacheFor(path);

    if (forceRefresh) {
        cache.loaded = false;
        cache.movies = [];
    }

    if (cache.loaded && cache.movies.length > 0) return cache.movies;

    if (cache.scanning) {
        await new Promise(r => setTimeout(r, 1000));
        return cache.movies;
    }

    cache.scanning = true;
    try {
        OmniBox.log("info", `===== 扫描分类: ${path} [${mediaType}] =====`);
        const start = Date.now();

        // 电视剧只扫第一层；免刮削直接读根目录直落一层；电影深度递归找视频文件
        let items;
        if (mediaType === "tv") {
            items = await scanTVShows(path);
        } else if (mediaType === "raw") {
            const actualPath = path.startsWith("rawdir#") ? path.substring(7) : (path === "openlist_raw_root" ? CONTENT_ROOT : path);
            items = await scanRawCategory(actualPath);
        } else {
            items = await scanDirectoryForMedia(path);
        }

        OmniBox.log("info", `找到 ${items.length} 条，耗时 ${Date.now() - start}ms`);

        cache.movies = items;
        cache.loaded = true;
        return items;
    } catch (e) {
        OmniBox.log("error", `扫描失败: ${e.message}`);
        return cache.movies;
    } finally {
        cache.scanning = false;
    }
}

// ===== 分页获取 =====
async function getPagedList(categoryPath, mediaType = "movie", page = 1, pageSize = PAGE_SIZE, forceRefresh = false) {
    const all = await scanCategoryWithCache(categoryPath, mediaType, forceRefresh);
    if (!all || all.length === 0) return { movies: [], total: 0, page, pagecount: 0 };

    const total     = all.length;
    const pagecount = Math.ceil(total / pageSize);
    const start     = (page - 1) * pageSize;

    return { movies: all.slice(start, start + pageSize), total, page, pagecount };
}

// ===== 随机取样 =====
function getRandomItems(arr, count = PAGE_SIZE) {
    if (!arr || arr.length === 0) return [];
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
}

// ===== 首页：所有分类各随机取样，合并后展示20条 =====
async function home(params) {
    try {
        const forceRefresh = !!(params.force_refresh || params.refresh);
        const tmdbKey      = getTmdbKey(params);
        const categories   = await getCategories(forceRefresh);

        // 首页推荐排除免刮削目录
        const recCategories = categories.filter(cat => cat.media_type !== "raw");

        // 并行扫描所有推荐分类
        const allLists = await Promise.all(
            recCategories.map(cat => scanCategoryWithCache(cat.type_id, cat.media_type, forceRefresh))
        );

        // 每个推荐分类随机取样，合并打散，取前 PAGE_SIZE 条
        let combined = [];
        recCategories.forEach((cat, i) => {
            const sampled = getRandomItems(allLists[i], Math.ceil(PAGE_SIZE / recCategories.length));
            sampled.forEach(m => { m._type = cat.media_type; });
            combined.push(...sampled);
        });
        combined = getRandomItems(combined, PAGE_SIZE);

        // 按分类并行请求 TMDB
        const movieItems = combined.filter(m => m._type !== "tv");
        const tvItems    = combined.filter(m => m._type === "tv");

        const [movieList, tvList] = await Promise.all([
            buildVodList(movieItems, "movie", tmdbKey),
            buildVodList(tvItems, "tv", tmdbKey)
        ]);

        // 还原原始顺序
        const vodMap = {};
        [...movieList, ...tvList].forEach(v => { vodMap[v.vod_id] = v; });
        const list = combined.map(m => vodMap[m.vod_id]).filter(Boolean);

        return { class: categories.map(c => ({ type_id: c.type_id, type_name: c.type_name })), list };
    } catch (e) {
        OmniBox.log("error", `首页失败: ${e.message}`);
        return { class: [], list: [] };
    }
}

// ===== 分类：下滑分页，每页20条 =====
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page       = parseInt(params.page) || 1;
        const tmdbKey    = getTmdbKey(params);
        const forceRefresh = !!(params.force_refresh || params.refresh);

        if (!categoryId) return { page: 1, pagecount: 0, total: 0, list: [] };

        let type = "movie";
        if (categoryId === "openlist_raw_root" || categoryId.startsWith("rawdir#")) {
            // 用户点击免刮削目录，触发子目录请求
            type = "raw";
        } else {
            // 从分类列表找到对应的 media_type
            const categories = await getCategories(forceRefresh);
            const cat = categories.find(c => c.type_id === categoryId);
            if (cat) type = cat.media_type;
        }

        const result = await getPagedList(categoryId, type, page, PAGE_SIZE, forceRefresh);
        const list   = await buildVodList(result.movies, type, tmdbKey);

        return { page: result.page, pagecount: result.pagecount, total: result.total, list };
    } catch (e) {
        OmniBox.log("error", `分类失败: ${e.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

// ===== 搜索：调用 OpenList 服务端接口实时搜索，不依赖缓存 =====
async function search(params) {
    try {
        const keyword = (params.keyword || "").trim();
        const tmdbKey = getTmdbKey(params);
        if (!keyword) return { list: [] };

        OmniBox.log("info", `实时搜索: "${keyword}"`);

        // 调用 OpenList 搜索 API（需在 OpenList 管理面板开启搜索索引）
        const searchResult = await request("/api/fs/search", {
            parent:   CONTENT_ROOT,   // 限定在内容根目录下搜索
            keywords: keyword,
            scope:    2,              // 0=全部 1=仅目录 2=仅文件
            page:     1,
            per_page: 100
        }, 20000);

        if (!searchResult || !searchResult.content) {
            OmniBox.log("info", "搜索无结果（可能未开启 OpenList 搜索索引）");
            return { list: [] };
        }

        // 只保留视频文件
        const mediaFiles = searchResult.content.filter(
            item => !item.is_dir && item.name && isVideoFile(item.name)
        );
        OmniBox.log("info", `命中 ${mediaFiles.length} 个视频文件`);

        if (mediaFiles.length === 0) return { list: [] };

        // 获取分类列表（用于判断 movie/tv）
        const categories = await getCategories();

        // 构建原始数据（OpenList search 返回的 item 含 parent + name 字段）
        const rawItems = mediaFiles.map(item => {
            const parentPath = (item.parent || "").replace(/\/$/, "");
            const itemPath   = parentPath + "/" + item.name;
            const tmdbId     = extractTMDBId(item.name);
            const cleanName  = removeVideoExt(item.name);
            const parts      = itemPath.split("/");
            const folderName = parts.length >= 2 ? parts[parts.length - 2] : cleanName;

            const cat  = categories.find(c => itemPath.startsWith(c.type_id));
            const type = cat ? cat.media_type : "movie";

            return {
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: folderName,
                tmdb_id:      tmdbId,
                _type:        type
            };
        });

        // 按类型分组并行请求 TMDB
        const movieItems = rawItems.filter(m => m._type !== "tv");
        const tvItems    = rawItems.filter(m => m._type === "tv");

        const [movieList, tvList] = await Promise.all([
            buildVodList(movieItems, "movie", tmdbKey),
            buildVodList(tvItems, "tv", tmdbKey)
        ]);

        const list = [...movieList, ...tvList];

        // 诊断日志：打印最终返回结果
        OmniBox.log("info", `搜索最终返回 ${list.length} 条结果`);
        if (list.length > 0) {
            OmniBox.log("info", `第一条: vod_id=${list[0].vod_id}, vod_name=${list[0].vod_name}`);
        }

        return {
            list,
            total:     list.length,
            page:      1,
            pagecount: 1
        };
    } catch (e) {
        OmniBox.log("error", `搜索失败: ${e.message}`);
        return { list: [] };
    }
}

// ===== 详情 =====
// 电影：videoId 是 .strm 文件路径，展示单集
// 电视剧：videoId 是剧名文件夹路径，扫集数并按季分组
async function detail(params) {
    try {
        const videoId = params.videoId;
        const tmdbKey = getTmdbKey(params);
        if (!videoId) return { list: [] };

        const categories = await getCategories();
        const cat  = categories.find(c => videoId.startsWith(c.type_id));
        const type = cat ? cat.media_type : "movie";

        // ===== 文件夹（包含剧名文件夹或 raw 模式下的普通文件夹）=====
        if (!isVideoFile(videoId)) {
            const folderName  = videoId.split("/").pop();
            const tmdbId      = extractTMDBId(folderName);
            const displayName = folderName.replace(/\s*tmdbid=\d+/i, "").trim();

            // 递归扫描该剧下所有视频文件（集数）
            OmniBox.log("info", `扫描剧集集数: ${displayName}`);
            const allEps = await scanDirectoryForMedia(videoId);
            OmniBox.log("info", `共 ${allEps.length} 集`);

            // 按父文件夹分季（例如 Season 1、Season 2）
            const seasonMap = {};
            for (const ep of allEps) {
                const parts  = ep.vod_id.split("/");
                let season = parts.length >= 2 ? parts[parts.length - 2] : "全集";
                
                // 将 "Season 1" / "S1" / "第1季" 统一美化为 "第 1 季"
                const matchSeason = season.match(/Season\s*(\d+)/i) || 
                                    season.match(/^S(\d+)$/i) || 
                                    season.match(/第\s*(\d+)\s*季/i);
                if (matchSeason) {
                    season = `第 ${parseInt(matchSeason[1])} 季`;
                }

                if (!seasonMap[season]) seasonMap[season] = [];

                // 提取集数名称："第 x 集"、"Exx"、或只保留纯数字
                let niceName = ep.vod_name;
                const matchE = ep.vod_name.match(/第\s*(\d+)\s*集/i); // 优先找原生 "第x集"
                const matchS = ep.vod_name.match(/S\d+E(\d+)/i);      // 其次找 SxxEyy
                const matchEp = ep.vod_name.match(/E(\d+)/i);        // 最后找 Exx
                
                if (matchE) {
                    niceName = `第 ${parseInt(matchE[1])} 集`;
                } else if (matchS) {
                    niceName = `第 ${parseInt(matchS[1])} 集`;
                } else if (matchEp) {
                    niceName = `第 ${parseInt(matchEp[1])} 集`;
                }

                seasonMap[season].push({
                    name:   niceName,
                    playId: ep.vod_id
                });
            }

            // 排序辅助函数：提取字符串中的第一个数字（用于自然排序，避免 1, 10, 2）
            const extractNum = (str) => {
                const match = str.match(/\d+/);
                return match ? parseInt(match[0], 10) : 9999; // 没数字的排最后
            };

            // 每个季按集名数字智能排序；季本身也按数字分组排序
            const playSources = Object.entries(seasonMap)
                .sort(([seasonA], [seasonB]) => extractNum(seasonA) - extractNum(seasonB))
                .map(([season, eps]) => ({
                    name:     season,
                    episodes: eps.sort((a, b) => extractNum(a.name) - extractNum(b.name))
                }));

            let vodInfo = {
                vod_id:   videoId,
                vod_name: displayName,
                vod_pic:  "",
                vod_play_sources: playSources
            };

            if (tmdbId) {
                const tmdb = await getTMDBInfo(tmdbId, "tv", tmdbKey);
                if (tmdb) {
                    vodInfo.vod_name     = tmdb.title;
                    vodInfo.vod_pic      = tmdb.pic;
                    vodInfo.vod_blurb    = tmdb.backdrop;
                    vodInfo.vod_year     = tmdb.year;
                    vodInfo.vod_content  = tmdb.desc;
                    vodInfo.vod_director = tmdb.director;
                    vodInfo.vod_actor    = tmdb.actor;
                    vodInfo.vod_score    = tmdb.score;
                    vodInfo.vod_class    = tmdb.genre;
                    vodInfo.vod_area     = tmdb.area;
                    vodInfo.vod_lang     = tmdb.lang;
                }
            }

            return { list: [vodInfo] };
        }

        // ===== 电影（视频文件）=====
        const fileName    = videoId.split("/").pop();
        const tmdbId      = extractTMDBId(fileName);
        const displayName = removeVideoExt(fileName);

        let vodInfo = {
            vod_id:   videoId,
            vod_name: displayName,
            vod_pic:  "",
            vod_play_sources: [{
                name:     "播放",
                episodes: [{ name: "正片", playId: videoId }]
            }]
        };

        if (tmdbId) {
            const tmdb = await getTMDBInfo(tmdbId, type, tmdbKey);
            if (tmdb) {
                vodInfo.vod_name     = tmdb.title;
                vodInfo.vod_pic      = tmdb.pic;
                vodInfo.vod_blurb    = tmdb.backdrop;
                vodInfo.vod_year     = tmdb.year;
                vodInfo.vod_content  = tmdb.desc;
                vodInfo.vod_director = tmdb.director;
                vodInfo.vod_actor    = tmdb.actor;
                vodInfo.vod_score    = tmdb.score;
                vodInfo.vod_class    = tmdb.genre;
                vodInfo.vod_area     = tmdb.area;
                vodInfo.vod_lang     = tmdb.lang;
            }
        }

        return { list: [vodInfo] };
    } catch (e) {
        OmniBox.log("error", `详情失败: ${e.message}`);
        return { list: [] };
    }
}

// ===== 播放 =====
async function play(params) {
    try {
        const playId = params.playId;
        if (!playId) return { urls: [], parse: 0 };

        const fileInfo = await getFileInfo(playId);
        if (!fileInfo || !fileInfo.raw_url) return { urls: [], parse: 0 };

        let url = fileInfo.raw_url;

        if (playId.endsWith(".strm")) {
            try {
                // 携带 Token 下载 strm 文件内容（私有路径需认证）
                const res = await OmniBox.request(url, {
                    timeout: 10000,
                    headers: { "Authorization": OPENLIST_TOKEN }
                });
                const content = res.body.trim();
                if (content.startsWith("http://") || content.startsWith("https://") || content.startsWith("magnet:")) {
                    url = content;
                } else {
                    OmniBox.log("error", `strm 内容不是有效 URL: ${content.substring(0, 100)}`);
                    return { urls: [], parse: 0 };
                }
            } catch (e) {
                OmniBox.log("error", `解析 .strm 失败: ${e.message}`);
                return { urls: [], parse: 0 };
            }
        }

        return { urls: [{ name: "播放", url }], parse: 0 };
    } catch (e) {
        OmniBox.log("error", `播放失败: ${e.message}`);
        return { urls: [], parse: 0 };
    }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);