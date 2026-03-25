// @name OpenList影视库优化版 
const OmniBox = require("omnibox_sdk");
// @downloadURL https://gh-proxy.org/https://github.com/lansepyy/OmniBox-Spider/edit/main/影视/网盘/openlist优化版.js

// ==========================================
// 必填配置
// ==========================================
const OPENLIST_URL   = "http://192.168.2.31:5255";
const OPENLIST_TOKEN = "";
// 内容根目录（脚本会自动扫描此目录下的第一层子文件夹作为分类归属的判断）
const CONTENT_ROOT   = "/189分享/189share";

// ==========================================
// 选填配置
// ==========================================
// 如果在这里填写了 TMDB_API，则优先使用填写的！
// 如果为空，则自动尝试使用前端传递的参数（如 params.tmdb_api）
const TMDB_API = "";

const PAGE_SIZE = 20;

// ===== 缓存 =====
let CATEGORY_CACHE = {};
let FOLDER_MAPPINGS = null; // 缓存 目录路径 -> 对应大类 的映射关系

// ===== 核心配置：固定的四大分类 =====
const FIXED_CLASSES = [
    { type_id: "fixed_movie", type_name: "🎬 电影", media_type: "movie" },
    { type_id: "fixed_tv",    type_name: "📺 电视剧", media_type: "tv" },
    { type_id: "fixed_anime", type_name: "🎌 动漫", media_type: "tv" },
    { type_id: "fixed_short", type_name: "📱 短剧", media_type: "tv" },
    { type_id: "openlist_raw_root", type_name: "📂 全部文件", media_type: "raw" }
];

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

// 根据文件夹名，将其自动识别到固定的四大分类之一
function detectFixedClass(folderName) {
    const lower = folderName.toLowerCase();
    if (["动漫", "动画", "anime", "cartoon", "番剧"].some(k => lower.includes(k))) return "fixed_anime";
    if (["短剧", "short"].some(k => lower.includes(k))) return "fixed_short";
    if (["电视剧", "剧集", "连续剧", "日剧", "韩剧", "美剧", "泰剧", "综艺", "tv", "series"].some(k => lower.includes(k))) return "fixed_tv";
    return "fixed_movie"; // 未命中默认分配给电影
}

// 获取分类列表（扫描并更新映射关系缓存）
async function getCategoriesAndMappings(forceRefresh = false) {
    if (!forceRefresh && FOLDER_MAPPINGS) {
        return { categories: FIXED_CLASSES, mappings: FOLDER_MAPPINGS };
    }

    OmniBox.log("info", `扫描根目录获取分类并进行自动映射: ${CONTENT_ROOT}`);
    const items = await listDir(CONTENT_ROOT);

    // 初始化映射表
    const mappings = {
        fixed_movie: [],
        fixed_tv: [],
        fixed_anime: [],
        fixed_short: []
    };

    if (items) {
        items.filter(item => item && isDirectory(item)).forEach(item => {
            const name = item.name;
            const path = CONTENT_ROOT.replace(/\/$/, "") + "/" + name;
            const classId = detectFixedClass(name);
            OmniBox.log("info", `  📁 自动映射目录: ${name} → 分类归属[${classId}]`);
            mappings[classId].push(path);
        });
    }

    FOLDER_MAPPINGS = mappings;
    return { categories: FIXED_CLASSES, mappings: FOLDER_MAPPINGS };
}

// 辅助方法：通过绝对路径判断所处分类及其媒体类型
function detectTypeByPath(targetPath, mappings) {
    for (const [classId, paths] of Object.entries(mappings)) {
        for (const path of paths) {
            // 如果某资源路径是由该大类下的某个映射目录作为前缀，则它属于该大类
            if (targetPath.startsWith(path)) {
                const cat = FIXED_CLASSES.find(c => c.type_id === classId);
                return cat ? cat.media_type : "movie";
            }
        }
    }
    return "movie";
}

// 获取或初始化某个目录的缓存
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

// 清理文件名用于 TMDB 搜索
function cleanSearchName(name) {
    if (!name) return "";
    let clean = name;
    clean = removeVideoExt(clean);
    
    // 1. 去除两端的方括号/特殊符号里的网址或字幕组等干扰信息
    clean = clean.replace(/\[.*?\]/g, ' ').replace(/【.*?】/g, ' ');
    
    // 1.5 把常见的竖线、下划线替换成点，方便统一用点分割（如 `NO.03｜遗传厄运` 会变成 `NO.03.遗传厄运`）
    clean = clean.replace(/[\|｜_~—]/g, '.');
    
    // 2. 截断在年份之前 (比如 .1999.)
    const yearMatch = clean.match(/[\. \-\(]((19|20)\d{2})([\. \-\)]|$)/);
    if (yearMatch) {
        clean = clean.substring(0, yearMatch.index);
    }
    
    // 3. 去掉常见的分辨率、压制组、语言等关键字及其后续内容
    const junkMatch = clean.match(/[\. \-\(](1080p|720p|2160p|4k|blu-?ray|web-?dl|hdrip|bdrip|x264|x265|hevc|dd5\.1|aac|ac3|国语|中字|双语|bd1080p|bd|ts|tc)/i);
    if (junkMatch) {
        clean = clean.substring(0, junkMatch.index);
    }
    
    // 4. 判断是否包含中文字符，智能提取
    if (/[\u4e00-\u9fa5]/.test(clean)) {
        // 如果包含点号，且带有中文，很大几率是由点分割的 (例如 1988.天堂电影院)
        if (clean.includes('.')) {
            const parts = clean.split('.');
            // 找到第一个包含中文的片段
            const chinesePart = parts.find(p => /[\u4e00-\u9fa5]/.test(p));
            if (chinesePart) return chinesePart.trim();
        } else if (clean.includes(' ')) {
            // 如 "1988 天堂电影院"
            const parts = clean.split(' ');
            const chinesePart = parts.find(p => /[\u4e00-\u9fa5]/.test(p));
            if (chinesePart) return chinesePart.trim();
        }
        // 如果没有分隔符，但又包含中文，直接原样返回把乱七八糟的清理下即可
        clean = clean.replace(/_/g, ' ');
    } else {
        // 纯英文/数字名称，把点号和下划线替换为空格
        clean = clean.replace(/[\._]/g, ' ');
    }
    
    return clean.trim();
}

// ===== TMDB 根据名称搜索验证获取详情 =====
async function searchTMDBInfo(name, type = "movie", tmdbKey = TMDB_API) {
    if (!tmdbKey || !name) return null;
    const cleanName = cleanSearchName(name);
    if (!cleanName) return null;
    
    try {
        const endpoint = type === "tv" ? "tv" : "movie";
        const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${tmdbKey}&language=zh-CN&query=${encodeURIComponent(cleanName)}`;
        const res = await OmniBox.request(url, { timeout: 8000 });
        const data = JSON.parse(res.body);
        
        if (data.results && data.results.length > 0) {
            // 拿到第一条命中的结果 id，去请求详细信息（包含演职员等）
            return await getTMDBInfo(data.results[0].id, type, tmdbKey);
        }
        return null;
    } catch (e) {
        OmniBox.log("error", `TMDB 搜索失败 name=${cleanName}: ${e.message}`);
        return null;
    }
}

// 针对电影文件名的智能提取（避免 1.mp4 这种无意义名称被拿去搜 TMDB）
function getMovieSearchName(fileName, folderName) {
    const lower = (fileName || "").toLowerCase();
    const ignoreNames = ["1", "2", "3", "4", "5", "video", "main", "cd1", "cd2", "part1", "part2", "正片", "movie", "play"];
    if (ignoreNames.includes(lower) || /^\d{1,2}$/.test(lower)) {
        return folderName || fileName;
    }
    return fileName;
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
        items.map(m => {
            if (m.tmdb_id) return getTMDBInfo(m.tmdb_id, type, tmdbKey);
            // 对于没有 tmdb_id 的，尝试通过名称搜索刮削
            let nameToSearch = m.vod_name;
            if (type === "movie") {
                nameToSearch = getMovieSearchName(m.vod_name, m._folder);
            } else {
                nameToSearch = m.display_name || m.vod_name;
            }
            return searchTMDBInfo(nameToSearch, type, tmdbKey);
        })
    );
    return items.map((movie, i) => {
        const tmdb = tmdbResults[i];
        if (tmdb) {
            return {
                vod_id:      movie.vod_id,
                vod_name:    tmdb.title,
                vod_pic:     tmdb.pic,
                vod_year:    tmdb.year,
                vod_remarks: movie._folder && movie._folder !== movie.vod_name ? movie._folder : (type === "movie" ? "电影" : "剧集")
            };
        }
        return { 
            vod_id: movie.vod_id, 
            vod_name: movie.display_name, 
            vod_pic: "", 
            vod_remarks: movie._folder && movie._folder !== movie.vod_name ? movie._folder : "视频" 
        };
    });
}

// ===== 递归扫描目录（用于电影）=====
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
                display_name: cleanName,
                tmdb_id:      tmdbId,
                _folder:      folderName   // 所属文件夹名
            });
        } else if (isDir) {
            const sub = await scanDirectoryForMedia(itemPath, depth + 1, maxDepth);
            result.push(...sub);
        }
    }
    return result;
}

// ===== 扫描电视剧/短剧/动漫分类：递归寻找真正的剧名文件夹 =====
async function scanTVShows(path, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];

    const items = await listDir(path);
    if (!items || items.length === 0) return [];

    let shows = [];
    let hasVideoFiles = false;

    // 检查此目录是否有直接视频文件
    for (const item of items) {
        if (!item) continue;
        if (isVideoFile(item.name)) {
            hasVideoFiles = true;
            break;
        }
    }

    // 如果此分类目录已有视频文件，说明该文件夹就是一部剧的集合（极大增强了容错，避免很多用户文件夹没取tmdbid而被漏掉）
    if (hasVideoFiles && depth > 0) {
        let folderPath = path;
        const parts = path.split('/');
        let folderName = parts[parts.length - 1];

        // 如果当前直接包含视频的文件夹名字也是纯季数标志如 "Season 1", "S01", "第1季"
        // 那么真正的剧名其实是它的上一级文件夹
        if (/^(season\s*\d+|s\d+|第.*?季)$/i.test(folderName.trim())) {
            if (parts.length >= 2) {
                folderName = parts[parts.length - 2];
                folderPath = parts.slice(0, -1).join('/');
            }
        }

        const tmdbId   = extractTMDBId(folderName);
        const cleanName = folderName.replace(/\s*tmdbid=\d+/i, "").trim();
        return [{
            vod_id:       folderPath,
            vod_name:     cleanName,
            display_name: cleanName,
            tmdb_id:      tmdbId,
            is_show:      true
        }];
    }

    for (const item of items) {
        if (!item || !isDirectory(item)) continue;
        const itemName = item.name || "";
        const itemPath = path.replace(/\/$/, "") + "/" + itemName;
        const tmdbId   = extractTMDBId(itemName);

        if (tmdbId) {
            // 有 tmdbid → 这是真正的剧名文件夹，直接收录，不再深究
            const cleanName = itemName.replace(/\s*tmdbid=\d+/i, "").trim();
            shows.push({
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: cleanName,
                tmdb_id:      tmdbId,
                is_show:      true
            });
        } else {
            // 没有 tmdbid → 可能是中间分类文件夹（如"华语"、"短剧合集"等），继续递归
            // 如果是个普通带视频的文件夹，深一层的时候就会从上方的 `hasVideoFiles` 判断抛上来！
            const sub = await scanTVShows(itemPath, depth + 1, maxDepth);
            shows.push(...sub);
        }
    }

    // 在每一层组装时去重，避免因识别 Season 1、Season 2 抛出了重复的父级剧目录
    if (shows.length > 0) {
        const unique = {};
        shows.forEach(s => { unique[s.vod_id] = s; });
        shows = Object.values(unique);
    }

    if (depth === 0) OmniBox.log("info", `TV/动漫类目录 [${path}] 共找到 ${shows.length} 部剧`);
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

// ===== 单目录独立扫描与防重入机制（带缓存，根据 mediaType 选策略）=====
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
        OmniBox.log("info", `===== 开始扫描物理目录: ${path} [类型: ${mediaType}] =====`);
        const start = Date.now();

        let items;
        if (mediaType === "tv") {
            items = await scanTVShows(path);
        } else if (mediaType === "raw") {
            const actualPath = path.startsWith("rawdir#") ? path.substring(7) : (path === "openlist_raw_root" ? CONTENT_ROOT : path);
            items = await scanRawCategory(actualPath);
        } else {
            items = await scanDirectoryForMedia(path);
        }

        OmniBox.log("info", `找到 ${items.length} 条数据，耗时 ${Date.now() - start}ms`);

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

// ===== 分页获取大类列表（由于固定四大分类通常跨越多个物理目录，做聚合扫描）=====
async function getPagedList(categoryId, mediaType = "movie", page = 1, pageSize = PAGE_SIZE, forceRefresh = false) {
    let all = [];

    // 固定四大类，聚合里面包含的多个物理目录的结果
    if (categoryId.startsWith("fixed_")) {
        const { mappings } = await getCategoriesAndMappings(forceRefresh);
        const paths = mappings[categoryId] || [];
        
        // 并行扫描同大类下的多个文件夹
        const allLists = await Promise.all(
            paths.map(p => scanCategoryWithCache(p, mediaType, forceRefresh))
        );
        allLists.forEach(list => { if(list) all.push(...list) });
    } else {
        // 请求的是具体免刮削的子目录，直接对应扫描即可
        all = await scanCategoryWithCache(categoryId, mediaType, forceRefresh);
    }
    
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

// ===== 首页：固定四大分类各随机取样，合并打散后展示20条 =====
async function home(params) {
    try {
        const forceRefresh = !!(params.force_refresh || params.refresh);
        const tmdbKey      = getTmdbKey(params);
        const { categories, mappings } = await getCategoriesAndMappings(forceRefresh);

        // 首页推荐排除免刮削目录
        const recCategories = categories.filter(cat => cat.media_type !== "raw");

        // 并行扫描所有推荐分类包含的路径清单
        const allLists = await Promise.all(
            recCategories.map(async cat => {
                const paths = mappings[cat.type_id] || [];
                // cat 内再对底下子映射关系并发并发扫描
                const lists = await Promise.all(paths.map(p => scanCategoryWithCache(p, cat.media_type, forceRefresh)));
                let merged = [];
                lists.forEach(l => { if (l) merged.push(...l); });
                return merged;
            })
        );

        // 每个推荐大类随机抽取若干个合并在一起
        let combined = [];
        recCategories.forEach((cat, i) => {
            const sampled = getRandomItems(allLists[i], Math.ceil(PAGE_SIZE / recCategories.length));
            sampled.forEach(m => { m._type = cat.media_type; });
            combined.push(...sampled);
        });
        combined = getRandomItems(combined, PAGE_SIZE);

        // 按分类刮削需要用的媒体类型分组
        const movieItems = combined.filter(m => m._type !== "tv");
        const tvItems    = combined.filter(m => m._type === "tv");

        const [movieList, tvList] = await Promise.all([
            buildVodList(movieItems, "movie", tmdbKey),
            buildVodList(tvItems, "tv", tmdbKey)
        ]);

        // 还原原始的顺序
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
            // 从设定查找属于哪个固定类型
            const { categories } = await getCategoriesAndMappings(forceRefresh);
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
            scope:    0,              // 0=全部（支持搜索目录内容），不再局限于仅文件
            page:     1,
            per_page: 100
        }, 20000);

        if (!searchResult || !searchResult.content) {
            OmniBox.log("info", "搜索无结果（可能未开启 OpenList 搜索索引）");
            return { list: [] };
        }

        // 保留目录以及视频文件
        const mediaItems = searchResult.content.filter(
            item => {
                if (!item) return false;
                if (item.is_dir) return true;
                return isVideoFile(item.name);
            }
        );
        OmniBox.log("info", `命中 ${mediaItems.length} 个结果 (包含目录和视频)`);

        if (mediaItems.length === 0) return { list: [] };

        // 引入分类映射缓存，辅助定夺当前这个视频属于谁的类型下的
        const { mappings } = await getCategoriesAndMappings();

        // 构建原始数据（OpenList search 返回的 item 含 parent + name 字段）
        const rawItems = mediaItems.map(item => {
            const parentPath = (item.parent || "").replace(/\/$/, "");
            const itemPath   = parentPath + "/" + item.name;
            const tmdbId     = extractTMDBId(item.name);
            const cleanName  = item.is_dir ? item.name.replace(/\s*tmdbid=\d+/i, "").trim() : removeVideoExt(item.name);
            const parts      = itemPath.split("/");
            const folderName = parts.length >= 2 ? parts[parts.length - 2] : cleanName;

            // 根据从哪个物理目录出来，决定怎么给它上刮削规则
            const type = detectTypeByPath(itemPath, mappings);

            return {
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: cleanName,
                tmdb_id:      tmdbId,
                _folder:      folderName,
                _type:        type,
                is_dir:       item.is_dir
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

        OmniBox.log("info", `搜索最终返回 ${list.length} 条结果`);

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
// 电视剧/极速短剧：videoId 是剧名文件夹路径，扫集数并按季分组
async function detail(params) {
    try {
        const videoId = params.videoId;
        const tmdbKey = getTmdbKey(params);
        if (!videoId) return { list: [] };

        const { mappings } = await getCategoriesAndMappings();
        const type = detectTypeByPath(videoId, mappings);

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

            let tmdb = null;
            if (tmdbId) {
                tmdb = await getTMDBInfo(tmdbId, "tv", tmdbKey);
            } else {
                tmdb = await searchTMDBInfo(displayName, "tv", tmdbKey);
            }

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

            return { list: [vodInfo] };
        }

        // ===== 电影（视频文件）=====
        const parts       = videoId.split("/");
        const fileName    = parts.pop();
        const folderName  = parts.length >= 1 ? parts.pop() : "";
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

        let tmdb = null;
        if (tmdbId) {
            tmdb = await getTMDBInfo(tmdbId, type, tmdbKey);
        } else {
            const nameToSearch = getMovieSearchName(displayName, folderName);
            tmdb = await searchTMDBInfo(nameToSearch, type, tmdbKey);
        }

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
                // 携带 Token 下载 strm 文件内容
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
