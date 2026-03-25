// @name OpenList测试
const OmniBox = require("omnibox_sdk");
// @downloadURL https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/main/影视/网盘/openlist测试.js

// =========================================
// 必填配置
// ==========================================
const OPENLIST_URL = "http://192.168.2.31:5255";
const OPENLIST_TOKEN = "";

// ==========================================
// 自定义分类配置
// 在这里添加你需要的分类，每个分类可以独立配置路径
// 如果某个分类没有配置路径，则会使用根目录进行自动识别
// ==========================================
const CUSTOM_CATEGORIES = [
    // 电影分类
    {
        type_id: "fixed_movie",
        type_name: "🎬 电影",
        media_type: "movie",
        path: "",  // 配置专用路径，如 "/移动盘/电影"，为空则使用根目录自动识别
        hidden: false  // true=隐藏，false=显示
    },
    // 电视剧分类
    {
        type_id: "fixed_tv",
        type_name: "📺 电视剧",
        media_type: "tv",
        path: "",
        hidden: false  // true=隐藏，false=显示
    },
    // 动漫分类
    {
        type_id: "fixed_anime",
        type_name: "🎌 动漫",
        media_type: "tv",
        path: "",
        hidden: false  // true=隐藏，false=显示
    },
    // 短剧分类
    {
        type_id: "fixed_short",
        type_name: "📱 短剧",
        media_type: "tv",
        path: "",
        hidden: false  // true=隐藏，false=显示
    },
    // 综艺分类（新增示例）
    {
        type_id: "fixed_variety",
        type_name: "🎪 综艺",
        media_type: "tv",
        path: "",
        hidden: false  // true=隐藏，false=显示
    },
    // 全部文件分类（免刮削）
    {
        type_id: "fixed_raw",
        type_name: "📂 全部文件",
        media_type: "raw",
        path: "",
        hidden: false  // true=隐藏，false=显示
    }
];

// 内容根目录（当某个分类没有配置专用路径时，使用此根目录进行自动识别）
const CONTENT_ROOT = "/189分享/189share";

// ==========================================
// 必填配置 - TMDB API 密钥管理
// ==========================================
// 方式1: 直接配置（不推荐用于生产环境）
// 方式2: 通过环境变量（推荐）process.env.TMDB_API_KEY 或 process.env.TMDB_ACCESS_TOKEN
// TMDB API 密钥（短API） - 推荐使用
// 来源：https://www.themoviedb.org/settings/api
// 例如：const TMDB_API_KEY = "abc123xyz456";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";

// TMDB 访问令牌（长API） - 只读令牌
// 优先级：TMDB_API_KEY > 参数 > TMDB_ACCESS_TOKEN
// 两个都留空时，TMDB刮削功能不可用
// 例如：const TMDB_ACCESS_TOKEN = "eyJhbGc...";
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN || "";

const PAGE_SIZE = 20;

// =========================================
// 缓存系统 - 减少API调用，提升性能
// =========================================
let CATEGORY_CACHE = {};        // 目录扫描缓存
let FOLDER_MAPPINGS = null;     // 文件夹映射缓存
let TMDB_CACHE = {};            // TMDB 元数据缓存

// ===== 构建分类列表 =====
function getCategories() {
    return CUSTOM_CATEGORIES.filter(cat => !cat.hidden);
}

// =========================================
// 分类管理函数
// =========================================

// 获取当前请求的 TMDB API（优先用API密钥，其次用访问令牌）
function getTmdbConfig(params = {}) {
    // 优先级：TMDB_API_KEY > params.tmdb_api > TMDB_ACCESS_TOKEN > params.access_token
    
    // 1. 优先用配置的 API 密钥（短API）
    if (TMDB_API_KEY) {
        return { type: "api_key", value: TMDB_API_KEY };
    }
    
    // 2. 其次用参数传入的 API 密钥
    if (params.tmdb_api || params.tmdb_key) {
        return { type: "api_key", value: params.tmdb_api || params.tmdb_key };
    }
    
    // 3. 再用配置的访问令牌（长API）
    if (TMDB_ACCESS_TOKEN) {
        return { type: "access_token", value: TMDB_ACCESS_TOKEN };
    }
    
    // 4. 最后用参数传入的访问令牌
    const token = params.tmdb_token || params.access_token;
    if (token) {
        return { type: "access_token", value: token };
    }
    
    // 都没有就返回 null，TMDB刮削不可用
    return null;
}

// =========================================
// API 请求处理
// =========================================
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
        
        // HTTP 状态码检查
        if (res.statusCode && res.statusCode !== 200) {
            OmniBox.log("error", `API 请求失败 [${path}], 状态码=${res.statusCode}`);
            return null;
        }
        
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

// 并发任务执行器 - 限制最大并发数
async function executeConcurrent(tasks, maxConcurrent = 5) {
    const results = [];
    const executing = [];
    
    for (let i = 0; i < tasks.length; i++) {
        const promise = Promise.resolve(tasks[i]()).then(r => {
            executing.splice(executing.indexOf(promise), 1);
            return r;
        });
        results.push(promise);
        executing.push(promise);
        
        // 限制并发数量
        if (executing.length >= maxConcurrent) {
            await Promise.race(executing);
        }
    }
    
    return Promise.all(results);
}

function isDirectory(item) {
    return item.is_dir === true ||
        item.type === 1 ||
        item.type === "dir" ||
        item.mime_type === "inode/directory";
}

function extractTMDBId(name) {
    if (!name) return null;

    // 格式1: tmdbid=123456
    const match1 = name.match(/tmdbid=(\d+)/i);
    if (match1) return match1[1];

    // 格式2: [tmdb:123456] 或 [tmdb-123456] 或 {tmdb:123456} 或 {tmdb-123456}
    const match2 = name.match(/[\[\({]tmdb[-:]?(\d+)[\]\)}]/i);
    if (match2) return match2[1];

    // 格式3: {tmdb-123456} 的变体
    const match3 = name.match(/\{tmdb-(\d+)\}/i);
    if (match3) return match3[1];

    // 格式4: 独立的纯数字（5位以上）
    const match4 = name.match(/^(\d+)$/);
    if (match4 && match4[1].length >= 5) return match4[1];

    return null;
}

const VIDEO_EXTS = [
    // 常见视频格式
    ".strm", ".mp4", ".mkv", ".avi", ".rmvb", ".mov", ".flv", ".wmv", ".ts",
    // 其他视频格式
    ".webm", ".m4v", ".3gp", ".m3u8", ".mpg", ".mpeg", ".vob", ".asf", ".f4v", ".ogv",
    ".mts", ".m2ts", ".divx", ".dv", ".vob", ".qt", ".mxf", ".bik",
    // 音频格式（支持音乐播放）
    ".mp3", ".aac", ".flac", ".opus", ".wma", ".ac3", ".dts", ".wav", ".ogg", ".m4a", ".aiff",
    // 光盘镜像格式
    ".iso"
];

// ===== 辅助工具 =====
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
    return "fixed_movie";
}

// 获取某个分类的实际扫描路径
function getCategoryScanPath(category) {
    if (category.path && category.path.trim()) {
        OmniBox.log("info", `使用专用路径 [${category.type_name}]: ${category.path}`);
        return category.path;
    }
    OmniBox.log("info", `使用根目录自动识别 [${category.type_name}]: ${CONTENT_ROOT}`);
    return CONTENT_ROOT;
}

// 获取分类列表（构建映射关系）
async function getCategoriesAndMappings(forceRefresh = false) {
    if (!forceRefresh && FOLDER_MAPPINGS) {
        return { categories: getCategories(), mappings: FOLDER_MAPPINGS };
    }

    const categories = getCategories();
    const mappings = {
        fixed_movie: [],
        fixed_tv: [],
        fixed_anime: [],
        fixed_short: [],
        fixed_variety: [],
        fixed_raw: []
    };

    // 为每个分类确定扫描路径
    for (const category of categories) {
        const scanPath = getCategoryScanPath(category);

        if (category.media_type === "raw") {
            if (scanPath) {
                mappings[category.type_id] = [scanPath];
                OmniBox.log("info", `[${category.type_name}] 使用路径: ${scanPath}`);
            }
            continue;
        }

        if (category.path && category.path.trim()) {
            mappings[category.type_id] = [scanPath];
            OmniBox.log("info", `[${category.type_name}] 使用专用路径: ${scanPath}`);
            continue;
        }

        OmniBox.log("info", `扫描根目录自动识别 [${category.type_name}]: ${scanPath}`);
        const items = await listDir(scanPath);

        if (items && Array.isArray(items)) {
            items.filter(item => item && isDirectory(item)).forEach(item => {
                const name = item.name;
                const path = scanPath.replace(/\/$/, "") + "/" + name;
                const classId = detectFixedClass(name);

                // 防御：确保 mappings[classId] 存在且是数组
                if (!mappings[classId]) {
                    mappings[classId] = [];
                }

                if (classId === category.type_id) {
                    OmniBox.log("info", `  📁 自动映射: ${name} → ${category.type_name}`);
                    mappings[classId].push(path);
                }
            });
        }

        if (mappings[category.type_id] && mappings[category.type_id].length === 0) {
            OmniBox.log("info", `  ⚠️ ${category.type_name} 分类未匹配到任何目录`);
        }
    }

    FOLDER_MAPPINGS = mappings;
    return { categories, mappings };
}

// 辅助方法：通过绝对路径判断所处分类及其媒体类型
function detectTypeByPath(targetPath, mappings) {
    for (const [classId, paths] of Object.entries(mappings)) {
        for (const path of paths) {
            if (targetPath.startsWith(path)) {
                const cat = getCategories().find(c => c.type_id === classId);
                if (cat) {
                    return cat.media_type;
                }
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

// =========================================
// TMDB 数据获取 - 支持缓存和双认证方式
// =========================================
async function getTMDBInfo(id, type = "movie", tmdbConfig = null) {
    if (!tmdbConfig || !id) return null;
    
    // 缓存检查 - 避免重复 API 调用
    const cacheKey = `${type}_${id}`;
    if (TMDB_CACHE[cacheKey]) {
        OmniBox.log("info", `[缓存命中] TMDB ${type} id=${id}`);
        return TMDB_CACHE[cacheKey];
    }
    
    try {
        const endpoint = type === "tv" ? "tv" : "movie";
        let url = `https://api.themoviedb.org/3/${endpoint}/${id}?language=zh-CN&append_to_response=credits`;
        const headers = { "Content-Type": "application/json" };
        
        // 根据 API 类型使用不同的认证方式
        if (tmdbConfig.type === "api_key") {
            // API 密钥：放在查询参数里
            url += `&api_key=${tmdbConfig.value}`;
        } else if (tmdbConfig.type === "access_token") {
            // Access Token：放在请求头里（Bearer token）
            headers["Authorization"] = `Bearer ${tmdbConfig.value}`;
        }
        
        const res = await OmniBox.request(url, { 
            method: "GET",
            headers: headers,
            timeout: 8000 
        });
        
        // HTTP 状态码检查
        if (res.statusCode && res.statusCode !== 200) {
            OmniBox.log("error", `TMDB 请求失败: ${type} id=${id}, 状态码=${res.statusCode}`);
            return null;
        }
        
        const data = JSON.parse(res.body);

        let director = "";
        if (type === "tv" && data.created_by && data.created_by.length) {
            director = data.created_by.map(p => p.name).slice(0, 3).join(" / ");
        } else if (data.credits && data.credits.crew) {
            director = data.credits.crew
                .filter(p => p.job === "Director")
                .map(p => p.name).slice(0, 3).join(" / ");
        }

        const actor = (data.credits && data.credits.cast)
            ? data.credits.cast.slice(0, 6).map(p => p.name).join(" / ")
            : "";

        const result = {
            title: data.title || data.name || "",
            pic: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "",
            backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "",
            year: (data.release_date || data.first_air_date || "").substring(0, 4),
            desc: data.overview || "",
            director: director,
            actor: actor,
            score: data.vote_average || "",
            genre: data.genres ? data.genres.map(g => g.name).join(" / ") : "",
            area: type === "tv" ? (data.origin_country?.[0] || "") : (data.production_countries?.[0]?.iso_3166_1 || ""),
            lang: data.original_language || ""
        };
        
        // 存储至缓存
        TMDB_CACHE[cacheKey] = result;
        return result;
    } catch (e) {
        OmniBox.log("error", `TMDB 请求失败 id=${id}: ${e.message}`);
        return null;
    }
}

// =========================================
// 清理文件名用于 TMDB 搜索 - 智能处理复杂名称
// =========================================
function cleanSearchName(name) {
    if (!name) return "";
    let clean = name;
    clean = removeVideoExt(clean);

    // 方案1：如果以中文开头，优先提取连续的中文字符串
    const chineseStart = clean.match(/^([\u4e00-\u9fa5\s·—～\-\·]+)/);
    if (chineseStart) {
        let chineseTitle = chineseStart[1].trim();
        chineseTitle = chineseTitle.replace(/\s+/g, ' ').trim();
        if (chineseTitle && chineseTitle.length > 1) {
            return chineseTitle;
        }
    }

    // 方案2：如果以英文/数字开头，提取到第一个特殊标记（括号、年份、质量标记）
    const englishMatch = clean.match(/^([A-Za-z0-9\s\-&:'\.]+?)[\s\(【\{]/);
    if (englishMatch) {
        let englishTitle = englishMatch[1].trim();
        if (englishTitle && englishTitle.length > 1) {
            // 给英文标题增加年份信息以区分不同版本
            const yearInName = clean.match(/\((19|20)\d{2}\)/);
            if (yearInName) {
                return `${englishTitle} ${yearInName[0]}`;
            }
            return englishTitle;
        }
    }
    
    // 方案3：移除各种括号及其内容后重新处理
    let cleaned = clean.replace(/\[.*?\]/g, ' ').replace(/【.*?】/g, ' ').replace(/\{.*?\}/g, ' ');
    cleaned = cleaned.replace(/\(.*?\)/g, ' ').replace(/（.*?）/g, ' ');
    cleaned = cleaned.replace(/[\|｜_~—]/g, ' ');

    // 提取年份前的部分
    const yearMatch = cleaned.match(/[\. \-\s]((19|20)\d{2})([\. \-\s]|$)/);
    if (yearMatch) {
        cleaned = cleaned.substring(0, yearMatch.index);
    }

    // 移除质量标记和编码信息
    const qualityMatch = cleaned.match(/[\. \-\s]([Ss]\d+[Ee]?\d*|[SsEe]\d+|1080p|720p|2160p|4k|blu-?ray|web-?dl|hdrip|bdrip|x264|x265|hevc|dd5\.1|aac|ac3|国语|中字|双语|bd|ts|remux|webrip|dts|atmos|hdr|edr|三季|四季|五季|全|豆瓣)/i);
    if (qualityMatch) {
        cleaned = cleaned.substring(0, qualityMatch.index);
    }

    // 处理中文标题
    if (/[\u4e00-\u9fa5]/.test(cleaned)) {
        cleaned = cleaned.trim();
        return cleaned.replace(/\s+/g, ' ').trim();
    } else {
        // 英文标题处理
        cleaned = cleaned.replace(/[\._]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return cleaned.trim();
}

// =========================================
// TMDB 搜索 - 支持缓存和双认证方式
// =========================================
async function searchTMDBInfo(name, type = "movie", tmdbConfig = null) {
    if (!tmdbConfig || !name) return null;
    const cleanName = cleanSearchName(name);
    if (!cleanName) return null;
    
    // 搜索结果缓存检查
    const searchCacheKey = `search_${type}_${cleanName}`;
    if (TMDB_CACHE[searchCacheKey]) {
        OmniBox.log("info", `[缓存命中] TMDB 搜索 "${cleanName}"`);
        return TMDB_CACHE[searchCacheKey];
    }

    try {
        const endpoint = type === "tv" ? "tv" : "movie";
        let url = `https://api.themoviedb.org/3/search/${endpoint}?language=zh-CN&query=${encodeURIComponent(cleanName)}`;
        const headers = { "Content-Type": "application/json" };
        
        // 根据 API 类型使用不同的认证方式
        if (tmdbConfig.type === "api_key") {
            // API 密钥：放在查询参数里
            url += `&api_key=${tmdbConfig.value}`;
        } else if (tmdbConfig.type === "access_token") {
            // Access Token：放在请求头里（Bearer token）
            headers["Authorization"] = `Bearer ${tmdbConfig.value}`;
        }
        
        const res = await OmniBox.request(url, { 
            method: "GET",
            headers: headers,
            timeout: 8000 
        });
        
        // HTTP 状态码检查
        if (res.statusCode && res.statusCode !== 200) {
            OmniBox.log("error", `TMDB 搜索失败: "${cleanName}", 状态码=${res.statusCode}`);
            return null;
        }
        
        const data = JSON.parse(res.body);

        if (data.results && data.results.length > 0) {
            const result = await getTMDBInfo(data.results[0].id, type, tmdbConfig);
            // 储存搜索结果至缓存
            if (result) {
                TMDB_CACHE[searchCacheKey] = result;
            }
            return result;
        }
        return null;
    } catch (e) {
        OmniBox.log("error", `TMDB 搜索失败 name=${cleanName}: ${e.message}`);
        return null;
    }
}

// =========================================
// 针对电影文件名的智能提取
// =========================================
function getMovieSearchName(fileName, folderName) {
    const lower = (fileName || "").toLowerCase();
    const ignoreNames = ["1", "2", "3", "4", "5", "video", "main", "cd1", "cd2", "part1", "part2", "正片", "movie", "play"];
    if (ignoreNames.includes(lower) || /^\d{1,2}$/.test(lower)) {
        return folderName || fileName;
    }
    return fileName;
}
// =========================================
// 构建 VOD 列表 - 支持并发控制和缓存
// 控制并发数量避免频率限制（最多5个并发）
// =========================================
async function buildVodList(items, type = "movie", tmdbConfig) {
    // 防御：确保 items 是数组
    if (!Array.isArray(items) || items.length === 0) return [];

    if (type === "raw") {
        return items.map(media => ({
            vod_id: media.vod_id,
            vod_name: media.display_name,
            vod_pic: media.is_back ? "https://img.icons8.com/color/48/circled-left-2--v1.png" : (media.is_dir ? "https://img.icons8.com/color/48/folder-invoices--v1.png" : "https://img.icons8.com/color/48/video-file.png"),
            vod_tag: media.is_dir ? "folder" : "file",
            vod_year: "",
            vod_remarks: media.is_back ? "返回" : (media.is_dir ? "目录" : "视频")
        }));
    }

    // 构建任务列表
    const tasks = items.map(m => async () => {
        const itemType = m._type || type;

        if (m.tmdb_id) {
            return getTMDBInfo(m.tmdb_id, itemType, tmdbConfig);
        }
        let nameToSearch = m.vod_name;
        if (itemType === "movie") {
            nameToSearch = getMovieSearchName(m.vod_name, m._folder);
            
            // 电影：优先用文件夹名识别，失败则用原文件名
            const result = await searchTMDBInfo(nameToSearch, itemType, tmdbConfig);
            if (!result && m.vod_name && m.vod_name !== nameToSearch) {
                OmniBox.log("info", `[后备搜索] 文件夹名 "${nameToSearch}" 搜索失败，尝试文件名 "${m.vod_name}"`);
                return await searchTMDBInfo(m.vod_name, itemType, tmdbConfig);
            }
            return result;
        } else {
            // TV 剧：优先用视频文件名（样本集）识别，失败则用文件夹名
            nameToSearch = m.display_name || m.vod_name;
            
            const result = await searchTMDBInfo(nameToSearch, itemType, tmdbConfig);
            if (!result && m._sample_episode && m._sample_episode !== nameToSearch) {
                OmniBox.log("info", `[后备搜索] 文件夹名 "${nameToSearch}" 搜索失败，尝试视频文件名 "${m._sample_episode}"`);
                return await searchTMDBInfo(m._sample_episode, itemType, tmdbConfig);
            }
            return result;
        }
    });
    
    // 使用并发控制执行 TMDB 请求（最多5个并发）
    const tmdbResults = await executeConcurrent(tasks, 5);
    
    // 防御：确保 tmdbResults 是数组且长度匹配
    const results = Array.isArray(tmdbResults) ? tmdbResults : [];
    
    // 防御：遍历 items 并安全地从 results 中获取对应元素
    const resultList = [];
    for (let i = 0; i < items.length; i++) {
        const movie = items[i];
        
        // 防御：确保 movie 是有效对象
        if (!movie || typeof movie !== 'object' || !movie.vod_id) {
            resultList.push({
                vod_id: `unknown_${i}`,
                vod_name: "未知",
                vod_pic: "",
                vod_remarks: "错误"
            });
            continue;
        }
        
        const tmdb = results[i];
        if (tmdb && typeof tmdb === 'object' && tmdb.title) {
            resultList.push({
                vod_id: movie.vod_id,
                vod_name: tmdb.title || "",
                vod_pic: tmdb.pic || "",
                vod_year: tmdb.year || "",
                vod_remarks: (movie._folder && movie._folder !== movie.vod_name) ? movie._folder : (type === "movie" ? "电影" : "剧集")
            });
        } else {
            resultList.push({
                vod_id: movie.vod_id,
                vod_name: movie.display_name || movie.vod_name || "",
                vod_pic: "",
                vod_remarks: (movie._folder && movie._folder !== movie.vod_name) ? movie._folder : "视频"
            });
        }
    }
    
    return resultList;
}

// =========================================
// 递归扫描目录获取媒体文件
// =========================================
async function scanDirectoryForMedia(path, depth = 0, maxDepth = 10, parentType = null) {
    if (depth > maxDepth) return [];

    const items = await listDir(path);
    if (!items || items.length === 0) return [];

    const result = [];

    let hasEpisodeFiles = false;
    for (const item of items) {
        if (item && isVideoFile(item.name)) {
            const name = item.name;
            if (name.match(/[Ss]\d+[Ee]\d+/) || name.match(/第\s*\d+\s*[集期]/) || name.match(/EP?\s*\d+/i)) {
                hasEpisodeFiles = true;
                break;
            }
        }
    }

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

            let mediaType = "movie";

            if (parentType === "tv" || hasEpisodeFiles ||
                itemName.match(/[Ss]\d+[Ee]\d+/) ||
                itemName.match(/第\s*\d+\s*[集期]/) ||
                itemName.match(/EP?\s*\d+/i)) {
                mediaType = "tv";
            }

            result.push({
                vod_id: itemPath,
                vod_name: cleanName,
                display_name: cleanName,
                tmdb_id: tmdbId,
                _folder: folderName,
                _type: mediaType
            });
        } else if (isDir) {
            const subType = hasEpisodeFiles ? "tv" : (parentType || null);
            const sub = await scanDirectoryForMedia(itemPath, depth + 1, maxDepth, subType);
            result.push(...sub);
        }
    }
    return result;
}

// =========================================
// 扫描电视剧 - 识别剧集结构
// =========================================
async function scanTVShows(path, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];

    const items = await listDir(path);
    if (!items || items.length === 0) return [];

    let shows = [];
    let hasEpisodeFiles = false;
    let episodePatterns = [];

    for (const item of items) {
        if (!item) continue;
        const name = item.name || "";

        if (isVideoFile(name)) {
            if (name.match(/[Ss]\d+[Ee]\d+/) || name.match(/第\s*\d+\s*[集期]/) || name.match(/EP?\s*\d+/i) || name.match(/\d{1,2}x\d{2}/)) {
                hasEpisodeFiles = true;
                episodePatterns.push(name);
            }
        }
    }

    if (hasEpisodeFiles && depth > 0) {
        let folderPath = path;
        const parts = path.split('/');
        let folderName = parts[parts.length - 1];

        if (/^(season\s*\d+|s\d+|第.*?季)$/i.test(folderName.trim())) {
            if (parts.length >= 2) {
                folderName = parts[parts.length - 2];
                folderPath = parts.slice(0, -1).join('/');
            }
            OmniBox.log("info", `[TV扫描] 检测到季文件夹: ${folderName} → 实际剧名: ${folderName}`);
        }

        const tmdbId = extractTMDBId(folderName);
        const cleanName = folderName.replace(/\s*tmdbid=\d+/i, "").trim();
        
        // 保存样本视频文件名，作为备用搜索文本
        const sampleEpisode = episodePatterns[0] ? removeVideoExt(episodePatterns[0]) : cleanName;

        OmniBox.log("info", `[TV扫描] 发现剧集: ${cleanName} (${episodePatterns.length} 个剧集文件)`);

        return [{
            vod_id: folderPath,
            vod_name: cleanName,
            display_name: cleanName,
            tmdb_id: tmdbId,
            is_show: true,
            _type: "tv",
            episode_count: episodePatterns.length,
            _sample_episode: sampleEpisode
        }];
    }

    for (const item of items) {
        if (!item || !isDirectory(item)) continue;
        const itemName = item.name || "";
        const itemPath = path.replace(/\/$/, "") + "/" + itemName;
        const tmdbId = extractTMDBId(itemName);

        if (tmdbId) {
            const cleanName = itemName.replace(/\s*tmdbid=\d+/i, "").trim();
            OmniBox.log("info", `[TV扫描] 发现带TMDB标记的剧集: ${cleanName}`);
            shows.push({
                vod_id: itemPath,
                vod_name: cleanName,
                display_name: cleanName,
                tmdb_id: tmdbId,
                is_show: true,
                _type: "tv"
            });
        } else {
            const sub = await scanTVShows(itemPath, depth + 1, maxDepth);
            shows.push(...sub);
        }
    }

    if (shows.length > 0) {
        const unique = {};
        shows.forEach(s => { unique[s.vod_id] = s; });
        shows = Object.values(unique);
    }

    if (depth === 0) {
        OmniBox.log("info", `[TV扫描] 目录 [${path}] 共找到 ${shows.length} 部剧集`);
    }

    return shows;
}

// =========================================
// 扫描免刮削目录 - 返回原始文件列表
// =========================================
async function scanRawCategory(targetPath, addBackButton = false, backId = null) {
    OmniBox.log("info", `扫描免刮削目录: ${targetPath}`);
    const items = await listDir(targetPath);
    const results = [];

    if (addBackButton && backId) {
        results.push({
            vod_id: backId,
            vod_name: "🔙 返回上一层",
            display_name: "🔙 返回上一层",
            tmdb_id: null,
            is_dir: true,
            is_back: true
        });
    }

    if (!items || items.length === 0) return results;

    for (const item of items) {
        if (!item) continue;
        const itemName = item.name || "";
        const itemPath = targetPath.replace(/\/$/, "") + "/" + itemName;
        const isDir = isDirectory(item);

        if (isDir || isVideoFile(itemName)) {
            results.push({
                vod_id: isDir ? `rawdir#${itemPath}` : itemPath,
                vod_name: itemName,
                display_name: itemName,
                tmdb_id: null,
                is_dir: isDir
            });
        }
    }
    return results;
}

// =========================================
// 单目录独立扫描 - 支持缓存
// =========================================
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

            if (!items || items.length === 0) {
                OmniBox.log("info", `剧集扫描未找到结构化剧集，尝试通用扫描`);
                const allMedia = await scanDirectoryForMedia(path);
                items = allMedia.filter(item => {
                    return item._type === "tv" ||
                        item.vod_name.match(/[Ss]\d+[Ee]\d+/) ||
                        item.vod_name.match(/第\s*\d+\s*[集期]/);
                });
                const grouped = {};
                items.forEach(item => {
                    const folder = item._folder;
                    if (!grouped[folder]) {
                        grouped[folder] = {
                            vod_id: item.vod_id.split('/').slice(0, -1).join('/'),
                            vod_name: folder,
                            display_name: folder,
                            tmdb_id: extractTMDBId(folder),
                            _type: "tv",
                            episodes: []
                        };
                    }
                    grouped[folder].episodes = grouped[folder].episodes || [];
                    grouped[folder].episodes.push(item);
                });
                items = Object.values(grouped);
            }
        } else if (mediaType === "raw") {
            items = await scanRawCategory(path);
        } else {
            items = await scanDirectoryForMedia(path);
            items = items.filter(item => {
                return item._type === "movie" &&
                    !item.vod_name.match(/[Ss]\d+[Ee]\d+/) &&
                    !item.vod_name.match(/第\s*\d+\s*[集期]/);
            });
        }

        if (items) {
            items.forEach(item => {
                if (!item._type) {
                    item._type = mediaType;
                }
            });
        }

        OmniBox.log("info", `找到 ${items?.length || 0} 条数据，耗时 ${Date.now() - start}ms`);

        // 防御：确保返回值总是数组
        cache.movies = Array.isArray(items) ? items : [];
        cache.loaded = true;
        return cache.movies;
    } catch (e) {
        OmniBox.log("error", `扫描失败: ${e.message}`);
        // 防御：异常情况下也确保返回数组
        return Array.isArray(cache.movies) ? cache.movies : [];
    } finally {
        cache.scanning = false;
    }
}

// =========================================
// 分页获取列表 - 支持多路径聚合
// =========================================
async function getPagedList(categoryId, mediaType = "movie", page = 1, pageSize = PAGE_SIZE, forceRefresh = false) {
    let all = [];

    const { mappings } = await getCategoriesAndMappings(forceRefresh);
    const paths = mappings[categoryId] || [];

    const allLists = await Promise.all(
        paths.map(p => scanCategoryWithCache(p, mediaType, forceRefresh))
    );
    
    // 防御：确保每个元素都是数组
    allLists.forEach(list => { 
        if (Array.isArray(list) && list.length > 0) {
            all.push(...list);
        }
    });

    if (!all || all.length === 0) return { movies: [], total: 0, page, pagecount: 0 };

    const total = all.length;
    const pagecount = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;

    return { movies: all.slice(start, start + pageSize), total, page, pagecount };
}

// =========================================
// 随机取样 - 用于首页展示
// =========================================
function getRandomItems(arr, count = PAGE_SIZE) {
    // 防御：确保 arr 是数组
    if (!arr || !Array.isArray(arr) || arr.length === 0) return [];
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
}

// =========================================
// 首页 - 随机推荐多分类内容
// =========================================
async function home(params) {
    try {
        const forceRefresh = !!(params.force_refresh || params.refresh);
        const tmdbConfig = getTmdbConfig(params);
        
        OmniBox.log("info", "[home] 开始加载首页...");
        const result = await getCategoriesAndMappings(forceRefresh);
        const categories = result ? result.categories : [];
        const mappings = result ? result.mappings : {};
        
        OmniBox.log("info", `[home] 获取到 ${Array.isArray(categories) ? categories.length : 0} 个分类`);

        // 防御：确保 categories 是数组
        const safeCategories = Array.isArray(categories) ? categories : [];
        const allRecCategories = safeCategories.filter(cat => cat && cat.media_type !== "raw");
        const recCategories = Array.isArray(allRecCategories) ? allRecCategories : [];

        OmniBox.log("info", `[home] 推荐分类数: ${recCategories.length}`);

        // 防御：如果没有分类，返回空列表
        if (!Array.isArray(recCategories) || recCategories.length === 0) {
            OmniBox.log("info", "[home] 无推荐分类，返回空列表");
            return { class: safeCategories.map(c => (c && c.type_id && c.type_name) ? { type_id: c.type_id, type_name: c.type_name } : { type_id: "unknown", type_name: "未知" }), list: [] };
        }

        const allLists = await Promise.all(
            recCategories.map(async (cat, catIndex) => {
                try {
                    if (!cat || !cat.type_id) {
                        OmniBox.log("error", `[home] 分类 ${catIndex} 无效`);
                        return [];
                    }
                    
                    const paths = (mappings && mappings[cat.type_id] && Array.isArray(mappings[cat.type_id])) ? mappings[cat.type_id] : [];
                    OmniBox.log("info", `[home] 分类 ${cat.type_id} 有 ${paths.length} 个路径`);
                    
                    // 防御：确保 paths 是数组
                    if (!Array.isArray(paths) || paths.length === 0) return [];
                    
                    const lists = await Promise.all(paths.map(p => scanCategoryWithCache(p, cat.media_type, forceRefresh)));
                    let merged = [];
                    
                    // 防御：确保 lists 是数组
                    if (Array.isArray(lists)) {
                        for (let i = 0; i < lists.length; i++) {
                            const l = lists[i];
                            if (Array.isArray(l) && l.length > 0) {
                                merged.push(...l);
                            }
                        }
                    }
                    OmniBox.log("info", `[home] 分类 ${cat.type_id} 合并后有 ${merged.length} 项`);
                    return merged;
                } catch (e) {
                    OmniBox.log("error", `[home] 分类 ${cat.type_id} 扫描失败: ${e.message}`);
                    return [];
                }
            })
        );
        
        OmniBox.log("info", `[home] allLists 长度: ${Array.isArray(allLists) ? allLists.length : 'not array'}`);
        
        // 防御：确保 allLists 是数组
        const safeAllLists = Array.isArray(allLists) ? allLists : [];

        let combined = [];
        // 防御：确保 recCategories 和 safeAllLists 长度匹配，使用 for 循环逐个处理
        const categoriesCount = Array.isArray(recCategories) ? recCategories.length : 0;
        const listsCount = safeAllLists.length;
        
        OmniBox.log("info", `[home] 开始组合数据: 分类数=${categoriesCount}, 列表数=${listsCount}`);
        
        for (let i = 0; i < categoriesCount; i++) {
            try {
                const cat = recCategories[i];
                if (!cat || typeof cat !== 'object') {
                    OmniBox.log("error", `[home] recCategories[${i}] 无效`);
                    continue;
                }
                
                const itemList = (i < listsCount && Array.isArray(safeAllLists[i])) ? safeAllLists[i] : [];
                const sampleSize = Math.ceil(PAGE_SIZE / (categoriesCount > 0 ? categoriesCount : 1));
                const sampled = getRandomItems(itemList, sampleSize);
                
                if (Array.isArray(sampled) && sampled.length > 0) {
                    sampled.forEach(m => { if (m && typeof m === 'object') m._type = cat.media_type; });
                    combined.push(...sampled);
                }
                OmniBox.log("info", `[home] 分类 ${i} (${cat.type_name}) 采样 ${sampled.length} 项`);
            } catch (e) {
                OmniBox.log("error", `[home] 第 ${i} 个分类组合失败: ${e.message}`);
                continue;
            }
        }
        
        OmniBox.log("info", `[home] 组合后总数: ${combined.length}`);
        
        combined = getRandomItems(combined, PAGE_SIZE);
        OmniBox.log("info", `[home] 打乱后: ${combined.length}`);

        // 防御：确保 combined 是数组，并且安全地 filter
        const safeCombined = Array.isArray(combined) ? combined : [];
        const safeMovieItems = safeCombined.filter(m => m && m._type !== "tv");
        const safeTvItems = safeCombined.filter(m => m && m._type === "tv");
        
        OmniBox.log("info", `[home] 电影 ${safeMovieItems.length} 项, 电视${safeTvItems.length} 项`);

        const [movieList, tvList] = await Promise.all([
            buildVodList(safeMovieItems, "movie", tmdbConfig),
            buildVodList(safeTvItems, "tv", tmdbConfig)
        ]);

        // 防御：确保返回的都是数组
        const safeMovieList = Array.isArray(movieList) ? movieList : [];
        const safeTvList = Array.isArray(tvList) ? tvList : [];
        
        OmniBox.log("info", `[home] 构建后: 电影 ${safeMovieList.length} 项, 电视 ${safeTvList.length} 项`);

        const vodMap = {};
        // 防御：安全地构建vodMap
        if (Array.isArray(safeMovieList) && safeMovieList.length > 0) {
            safeMovieList.forEach(v => { if (v && v.vod_id) vodMap[v.vod_id] = v; });
        }
        if (Array.isArray(safeTvList) && safeTvList.length > 0) {
            safeTvList.forEach(v => { if (v && v.vod_id) vodMap[v.vod_id] = v; });
        }
        
        // 防御：确保 safeCombined 是数组，再 map
        let list = [];
        if (Array.isArray(safeCombined) && safeCombined.length > 0) {
            for (let i = 0; i < safeCombined.length; i++) {
                const m = safeCombined[i];
                if (m && m.vod_id && vodMap[m.vod_id]) {
                    list.push(vodMap[m.vod_id]);
                }
            }
        }
        
        OmniBox.log("info", `[home] 最终列表: ${list.length} 项`);

        const classData = safeCategories.map(c => {
            if (c && c.type_id && c.type_name) {
                return { type_id: c.type_id, type_name: c.type_name };
            }
            return { type_id: "unknown", type_name: "未知" };
        });
        
        return { class: classData, list };
    } catch (e) {
        OmniBox.log("error", `首页失败: ${e.message}, 堆栈: ${e.stack}`);
        return { class: [], list: [] };
    }
}

// =========================================
// 分类 - 获取指定分类的内容列表
// =========================================
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page = parseInt(params.page) || 1;
        const tmdbConfig = getTmdbConfig(params);
        const forceRefresh = !!(params.force_refresh || params.refresh);

        if (!categoryId) return { page: 1, pagecount: 0, total: 0, list: [] };

        if (categoryId.startsWith("rawdir#")) {
            const targetPath = categoryId.substring(7);
            const { mappings } = await getCategoriesAndMappings(forceRefresh);
            const rawRoots = mappings["fixed_raw"] || [];
            
            let parentPath = targetPath.substring(0, targetPath.lastIndexOf("/"));
            if (!parentPath) parentPath = "/";
            
            let isRoot = rawRoots.includes(targetPath) || rawRoots.includes(targetPath + "/");
            let backId = `rawdir#${parentPath}`;
            
            if (rawRoots.includes(parentPath) || rawRoots.includes(parentPath + "/")) {
                backId = "fixed_raw";
            }
            
            const addBack = !isRoot;
            
            const items = await scanRawCategory(targetPath, addBack, backId);
            const safeItems = Array.isArray(items) ? items : [];
            const list = await buildVodList(safeItems, "raw", tmdbConfig);
            return { page: 1, pagecount: 1, total: list.length || 0, list };
        }

        // 处理全部文件分类（fixed_raw），添加返回按钮
        if (categoryId === "fixed_raw") {
            const { mappings } = await getCategoriesAndMappings(forceRefresh);
            const rawRoots = mappings["fixed_raw"] || [];
            
            if (rawRoots.length === 0) {
                return { page: 1, pagecount: 0, total: 0, list: [] };
            }
            
            // 扫描根目录并添加返回按钮（返回至分类列表）
            const targetPath = rawRoots[0];
            const items = await scanRawCategory(targetPath, true, "fixed_raw");
            const safeItems = Array.isArray(items) ? items : [];
            const list = await buildVodList(safeItems, "raw", tmdbConfig);
            return { page: 1, pagecount: 1, total: list.length || 0, list };
        }

        const { categories } = await getCategoriesAndMappings(forceRefresh);
        const cat = categories.find(c => c.type_id === categoryId);

        if (!cat) {
            OmniBox.log("error", `未找到分类: ${categoryId}`);
            return { page: 1, pagecount: 0, total: 0, list: [] };
        }

        const result = await getPagedList(categoryId, cat.media_type, page, PAGE_SIZE, forceRefresh);
        
        // 防御：确保 result 是有效对象
        if (!result || typeof result !== 'object') {
            OmniBox.log("error", `分类列表查询返回无效结果: ${categoryId}`);
            return { page: 1, pagecount: 0, total: 0, list: [] };
        }
        
        const safeMovies = Array.isArray(result.movies) ? result.movies : [];
        const list = await buildVodList(safeMovies, cat.media_type, tmdbConfig);

        return { page: result.page || 1, pagecount: result.pagecount || 0, total: result.total || 0, list };
    } catch (e) {
        OmniBox.log("error", `分类失败: ${e.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

// =========================================
// 搜索 - 实时本地文件搜索
// =========================================
async function search(params) {
    try {
        const keyword = (params.keyword || "").trim();
        const tmdbConfig = getTmdbConfig(params);
        if (!keyword) return { list: [] };

        OmniBox.log("info", `实时搜索: "${keyword}"`);

        const searchResult = await request("/api/fs/search", {
            parent: CONTENT_ROOT,
            keywords: keyword,
            scope: 0,
            page: 1,
            per_page: 100
        }, 20000);

        if (!searchResult || !searchResult.content) {
            OmniBox.log("info", "搜索无结果");
            return { list: [] };
        }

        const mediaItems = searchResult.content.filter(item => {
            if (!item) return false;
            if (item.is_dir) return true;
            return isVideoFile(item.name);
        });

        if (mediaItems.length === 0) return { list: [] };

        const { mappings } = await getCategoriesAndMappings();

        const rawItems = mediaItems.map(item => {
            const parentPath = (item.parent || "").replace(/\/$/, "");
            const itemPath = parentPath + "/" + item.name;
            const tmdbId = extractTMDBId(item.name);
            const cleanName = item.is_dir ? item.name.replace(/\s*tmdbid=\d+/i, "").trim() : removeVideoExt(item.name);
            const parts = itemPath.split("/");
            const folderName = parts.length >= 2 ? parts[parts.length - 2] : cleanName;
            const type = detectTypeByPath(itemPath, mappings);

            return {
                vod_id: itemPath,
                vod_name: cleanName,
                display_name: cleanName,
                tmdb_id: tmdbId,
                _folder: folderName,
                _type: type,
                is_dir: item.is_dir
            };
        });

        const movieItems = rawItems.filter(m => m._type !== "tv");
        const tvItems = rawItems.filter(m => m._type === "tv");

        const [movieList, tvList] = await Promise.all([
            buildVodList(movieItems, "movie", tmdbConfig),
            buildVodList(tvItems, "tv", tmdbConfig)
        ]);

        // 防御：确保返回的都是数组
        const safeMovieList = Array.isArray(movieList) ? movieList : [];
        const safeTvList = Array.isArray(tvList) ? tvList : [];
        
        const list = [...safeMovieList, ...safeTvList];

        return {
            list,
            total: list.length || 0,
            page: 1,
            pagecount: 1
        };
    } catch (e) {
        OmniBox.log("error", `搜索失败: ${e.message}`);
        return { list: [] };
    }
}

// =========================================
// 详情 - 获取单个视频/剧集详细信息
// =========================================
async function detail(params) {
    try {
        const videoId = params.videoId;
        const tmdbConfig = getTmdbConfig(params);
        if (!videoId) return { list: [] };

        let actualId = videoId;
        if (videoId.startsWith("rawdir#")) {
            actualId = videoId.substring(7);
        }

        const { mappings } = await getCategoriesAndMappings();
        const type = detectTypeByPath(actualId, mappings);

        if (!isVideoFile(actualId)) {
            const folderName = actualId.split("/").pop();
            const tmdbId = extractTMDBId(folderName);
            const displayName = folderName.replace(/\s*tmdbid=\d+/i, "").trim();

            OmniBox.log("info", `扫描剧集集数/目录内容: ${displayName}`);
            const allEps = await scanDirectoryForMedia(actualId);
            OmniBox.log("info", `共 ${allEps.length} 集`);

            const seasonMap = {};
            for (const ep of allEps) {
                const parts = ep.vod_id.split("/");
                let season = parts.length >= 2 ? parts[parts.length - 2] : "全集";

                const matchSeason = season.match(/Season\s*(\d+)/i) ||
                    season.match(/^S(\d+)$/i) ||
                    season.match(/第\s*(\d+)\s*季/i);
                if (matchSeason) {
                    season = `第 ${parseInt(matchSeason[1])} 季`;
                }

                if (!seasonMap[season]) seasonMap[season] = [];

                let niceName = ep.vod_name;
                const matchE = ep.vod_name.match(/第\s*(\d+)\s*集/i);
                const matchS = ep.vod_name.match(/S\d+E(\d+)/i);
                const matchEp = ep.vod_name.match(/E(\d+)/i);

                if (matchE) {
                    niceName = `第 ${parseInt(matchE[1])} 集`;
                } else if (matchS) {
                    niceName = `第 ${parseInt(matchS[1])} 集`;
                } else if (matchEp) {
                    niceName = `第 ${parseInt(matchEp[1])} 集`;
                }

                seasonMap[season].push({
                    name: niceName,
                    playId: ep.vod_id
                });
            }

            const extractNum = (str) => {
                const match = str.match(/\d+/);
                return match ? parseInt(match[0], 10) : 9999;
            };

            const playSources = Object.entries(seasonMap)
                .sort(([seasonA], [seasonB]) => extractNum(seasonA) - extractNum(seasonB))
                .map(([season, eps]) => ({
                    name: season,
                    episodes: eps.sort((a, b) => extractNum(a.name) - extractNum(b.name))
                }));

            let vodInfo = {
                vod_id: videoId,
                vod_name: displayName,
                vod_pic: "",
                vod_play_sources: playSources
            };

            let tmdb = null;
            if (tmdbId) {
                tmdb = await getTMDBInfo(tmdbId, "tv", tmdbConfig);
            } else {
                tmdb = await searchTMDBInfo(displayName, "tv", tmdbConfig);
            }

            if (tmdb) {
                vodInfo.vod_name = tmdb.title;
                vodInfo.vod_pic = tmdb.pic;
                vodInfo.vod_blurb = tmdb.backdrop;
                vodInfo.vod_year = tmdb.year;
                vodInfo.vod_content = tmdb.desc;
                vodInfo.vod_director = tmdb.director;
                vodInfo.vod_actor = tmdb.actor;
                vodInfo.vod_score = tmdb.score;
                vodInfo.vod_class = tmdb.genre;
                vodInfo.vod_area = tmdb.area;
                vodInfo.vod_lang = tmdb.lang;
            }

            return { list: [vodInfo] };
        }

        const parts = videoId.split("/");
        const fileName = parts.pop();
        const folderName = parts.length >= 1 ? parts.pop() : "";
        const tmdbId = extractTMDBId(fileName);
        const displayName = removeVideoExt(fileName);

        let vodInfo = {
            vod_id: videoId,
            vod_name: displayName,
            vod_pic: "",
            vod_play_sources: [{
                name: "播放",
                episodes: [{ name: "正片", playId: videoId }]
            }]
        };

        let tmdb = null;
        if (tmdbId) {
            tmdb = await getTMDBInfo(tmdbId, type, tmdbConfig);
        } else {
            const nameToSearch = getMovieSearchName(displayName, folderName);
            tmdb = await searchTMDBInfo(nameToSearch, type, tmdbConfig);
        }

        if (tmdb) {
            vodInfo.vod_name = tmdb.title;
            vodInfo.vod_pic = tmdb.pic;
            vodInfo.vod_blurb = tmdb.backdrop;
            vodInfo.vod_year = tmdb.year;
            vodInfo.vod_content = tmdb.desc;
            vodInfo.vod_director = tmdb.director;
            vodInfo.vod_actor = tmdb.actor;
            vodInfo.vod_score = tmdb.score;
            vodInfo.vod_class = tmdb.genre;
            vodInfo.vod_area = tmdb.area;
            vodInfo.vod_lang = tmdb.lang;
        }

        return { list: [vodInfo] };
    } catch (e) {
        OmniBox.log("error", `详情失败: ${e.message}`);
        return { list: [] };
    }
}

// =========================================
// 播放 - 获取视频播放链接
// =========================================
async function play(params) {
    try {
        const playId = params.playId;
        if (!playId) return { urls: [], parse: 0 };

        const fileInfo = await getFileInfo(playId);
        if (!fileInfo || !fileInfo.raw_url) return { urls: [], parse: 0 };

        let url = fileInfo.raw_url;

        if (playId.endsWith(".strm")) {
            try {
                const res = await OmniBox.request(url, {
                    timeout: 10000,
                    headers: { "Authorization": OPENLIST_TOKEN }
                });
                
                // HTTP 状态码检查
                if (res.statusCode && res.statusCode !== 200) {
                    OmniBox.log("error", `解析 .strm 失败: 状态码=${res.statusCode}`);
                    return { urls: [], parse: 0 };
                }
                
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
