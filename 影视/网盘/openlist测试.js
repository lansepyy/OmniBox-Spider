// @name OpenList测试
const OmniBox = require("omnibox_sdk");
// @downloadURL https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/main/影视/网盘/openlist测试.js

// =========================================
// 必填配置
// ==========================================
const OPENLIST_URL   = "http://192.168.2.31:5255";
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
        path: ""  // 配置专用路径，如 "/移动盘/电影"，为空则使用根目录自动识别
    },
    // 电视剧分类
    {
        type_id: "fixed_tv",
        type_name: "📺 电视剧",
        media_type: "tv",
        path: ""
    },
    // 动漫分类
    {
        type_id: "fixed_anime",
        type_name: "🎌 动漫",
        media_type: "tv",
        path: ""
    },
    // 短剧分类
    {
        type_id: "fixed_short",
        type_name: "📱 短剧",
        media_type: "tv",
        path: ""
    },
    // 综艺分类（新增示例）
    {
        type_id: "fixed_variety",
        type_name: "🎪 综艺",
        media_type: "tv",
        path: ""
    },
    // 全部文件分类（免刮削）
    {
        type_id: "fixed_raw",
        type_name: "📂 全部文件",
        media_type: "raw",
        path: ""
    }
];

// 内容根目录（当某个分类没有配置专用路径时，使用此根目录进行自动识别）
const CONTENT_ROOT = "/189分享/189share";

// ==========================================
// 选填配置
// ==========================================
const TMDB_API = "";

const PAGE_SIZE = 20;

// ===== 缓存 =====
let CATEGORY_CACHE = {};
let FOLDER_MAPPINGS = null;

// ===== 构建分类列表 =====
function getCategories() {
    return CUSTOM_CATEGORIES;
}

// 获取当前请求的 TMDB API Key
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
    if (!name) return null;
    
    const match = name.match(/tmdbid=(\d+)/i);
    if (match) return match[1];
    
    const match2 = name.match(/[\[\({]tmdb[:\-]?(\d+)[\]\)}]/i);
    if (match2) return match2[1];
    
    const match3 = name.match(/^(\d+)$/);
    if (match3 && match3[1].length >= 5) return match3[1];
    
    return null;
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
        
        if (items) {
            items.filter(item => item && isDirectory(item)).forEach(item => {
                const name = item.name;
                const path = scanPath.replace(/\/$/, "") + "/" + name;
                const classId = detectFixedClass(name);
                
                if (classId === category.type_id) {
                    OmniBox.log("info", `  📁 自动映射: ${name} → ${category.type_name}`);
                    mappings[classId].push(path);
                }
            });
        }
        
        if (mappings[category.type_id].length === 0) {
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

// ===== TMDB 刮削 =====
async function getTMDBInfo(id, type = "movie", tmdbKey = TMDB_API) {
    if (!tmdbKey || !id) return null;
    try {
        const endpoint = type === "tv" ? "tv" : "movie";
        const res = await OmniBox.request(
            `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${tmdbKey}&language=zh-CN&append_to_response=credits`,
            { timeout: 8000 }
        );
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
    
    clean = clean.replace(/\[.*?\]/g, ' ').replace(/【.*?】/g, ' ');
    clean = clean.replace(/[\|｜_~—]/g, '.');
    
    const yearMatch = clean.match(/[\. \-\(]((19|20)\d{2})([\. \-\)]|$)/);
    if (yearMatch) {
        clean = clean.substring(0, yearMatch.index);
    }
    
    const junkMatch = clean.match(/[\. \-\(](1080p|720p|2160p|4k|blu-?ray|web-?dl|hdrip|bdrip|x264|x265|hevc|dd5\.1|aac|ac3|国语|中字|双语|bd1080p|bd|ts|tc)/i);
    if (junkMatch) {
        clean = clean.substring(0, junkMatch.index);
    }
    
    if (/[\u4e00-\u9fa5]/.test(clean)) {
        if (clean.includes('.')) {
            const parts = clean.split('.');
            const chinesePart = parts.find(p => /[\u4e00-\u9fa5]/.test(p));
            if (chinesePart) return chinesePart.trim();
        } else if (clean.includes(' ')) {
            const parts = clean.split(' ');
            const chinesePart = parts.find(p => /[\u4e00-\u9fa5]/.test(p));
            if (chinesePart) return chinesePart.trim();
        }
        clean = clean.replace(/_/g, ' ');
    } else {
        clean = clean.replace(/[\._]/g, ' ');
    }
    
    return clean.trim();
}

// ===== TMDB 根据名称搜索 =====
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
            return await getTMDBInfo(data.results[0].id, type, tmdbKey);
        }
        return null;
    } catch (e) {
        OmniBox.log("error", `TMDB 搜索失败 name=${cleanName}: ${e.message}`);
        return null;
    }
}

// 针对电影文件名的智能提取
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
            const itemType = m._type || type;
            
            if (m.tmdb_id) {
                return getTMDBInfo(m.tmdb_id, itemType, tmdbKey);
            }
            let nameToSearch = m.vod_name;
            if (itemType === "movie") {
                nameToSearch = getMovieSearchName(m.vod_name, m._folder);
            } else {
                nameToSearch = m.display_name || m.vod_name;
            }
            return searchTMDBInfo(nameToSearch, itemType, tmdbKey);
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

// ===== 递归扫描目录 =====
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
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: cleanName,
                tmdb_id:      tmdbId,
                _folder:      folderName,
                _type:        mediaType
            });
        } else if (isDir) {
            const subType = hasEpisodeFiles ? "tv" : (parentType || null);
            const sub = await scanDirectoryForMedia(itemPath, depth + 1, maxDepth, subType);
            result.push(...sub);
        }
    }
    return result;
}

// ===== 扫描电视剧 =====
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
        
        OmniBox.log("info", `[TV扫描] 发现剧集: ${cleanName} (${episodePatterns.length} 个剧集文件)`);
        
        return [{
            vod_id:       folderPath,
            vod_name:     cleanName,
            display_name: cleanName,
            tmdb_id:      tmdbId,
            is_show:      true,
            _type:        "tv",
            episode_count: episodePatterns.length
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
                vod_id:       itemPath,
                vod_name:     cleanName,
                display_name: cleanName,
                tmdb_id:      tmdbId,
                is_show:      true,
                _type:        "tv"
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

// ===== 扫描免刮削目录 =====
async function scanRawCategory(targetPath) {
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

// ===== 单目录独立扫描 =====
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

        cache.movies = items || [];
        cache.loaded = true;
        return cache.movies;
    } catch (e) {
        OmniBox.log("error", `扫描失败: ${e.message}`);
        return cache.movies;
    } finally {
        cache.scanning = false;
    }
}

// ===== 分页获取列表 =====
async function getPagedList(categoryId, mediaType = "movie", page = 1, pageSize = PAGE_SIZE, forceRefresh = false) {
    let all = [];

    const { mappings } = await getCategoriesAndMappings(forceRefresh);
    const paths = mappings[categoryId] || [];
    
    const allLists = await Promise.all(
        paths.map(p => scanCategoryWithCache(p, mediaType, forceRefresh))
    );
    allLists.forEach(list => { if(list) all.push(...list) });
    
    if (!all || all.length === 0) return { movies: [], total: 0, page, pagecount: 0 };

    const total = all.length;
    const pagecount = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;

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

// ===== 首页 =====
async function home(params) {
    try {
        const forceRefresh = !!(params.force_refresh || params.refresh);
        const tmdbKey = getTmdbKey(params);
        const { categories, mappings } = await getCategoriesAndMappings(forceRefresh);
        
        const recCategories = categories.filter(cat => cat.media_type !== "raw");

        const allLists = await Promise.all(
            recCategories.map(async cat => {
                const paths = mappings[cat.type_id] || [];
                const lists = await Promise.all(paths.map(p => scanCategoryWithCache(p, cat.media_type, forceRefresh)));
                let merged = [];
                lists.forEach(l => { if (l) merged.push(...l); });
                return merged;
            })
        );

        let combined = [];
        recCategories.forEach((cat, i) => {
            const sampled = getRandomItems(allLists[i], Math.ceil(PAGE_SIZE / recCategories.length));
            sampled.forEach(m => { m._type = cat.media_type; });
            combined.push(...sampled);
        });
        combined = getRandomItems(combined, PAGE_SIZE);

        const movieItems = combined.filter(m => m._type !== "tv");
        const tvItems = combined.filter(m => m._type === "tv");

        const [movieList, tvList] = await Promise.all([
            buildVodList(movieItems, "movie", tmdbKey),
            buildVodList(tvItems, "tv", tmdbKey)
        ]);

        const vodMap = {};
        [...movieList, ...tvList].forEach(v => { vodMap[v.vod_id] = v; });
        const list = combined.map(m => vodMap[m.vod_id]).filter(Boolean);

        return { class: categories.map(c => ({ type_id: c.type_id, type_name: c.type_name })), list };
    } catch (e) {
        OmniBox.log("error", `首页失败: ${e.message}`);
        return { class: [], list: [] };
    }
}

// ===== 分类 =====
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page = parseInt(params.page) || 1;
        const tmdbKey = getTmdbKey(params);
        const forceRefresh = !!(params.force_refresh || params.refresh);

        if (!categoryId) return { page: 1, pagecount: 0, total: 0, list: [] };

        const { categories } = await getCategoriesAndMappings(forceRefresh);
        const cat = categories.find(c => c.type_id === categoryId);
        
        if (!cat) {
            OmniBox.log("error", `未找到分类: ${categoryId}`);
            return { page: 1, pagecount: 0, total: 0, list: [] };
        }

        const result = await getPagedList(categoryId, cat.media_type, page, PAGE_SIZE, forceRefresh);
        const list = await buildVodList(result.movies, cat.media_type, tmdbKey);

        return { page: result.page, pagecount: result.pagecount, total: result.total, list };
    } catch (e) {
        OmniBox.log("error", `分类失败: ${e.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

// ===== 搜索 =====
async function search(params) {
    try {
        const keyword = (params.keyword || "").trim();
        const tmdbKey = getTmdbKey(params);
        if (!keyword) return { list: [] };

        OmniBox.log("info", `实时搜索: "${keyword}"`);

        const searchResult = await request("/api/fs/search", {
            parent:   CONTENT_ROOT,
            keywords: keyword,
            scope:    0,
            page:     1,
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
            buildVodList(movieItems, "movie", tmdbKey),
            buildVodList(tvItems, "tv", tmdbKey)
        ]);

        const list = [...movieList, ...tvList];

        return {
            list,
            total: list.length,
            page: 1,
            pagecount: 1
        };
    } catch (e) {
        OmniBox.log("error", `搜索失败: ${e.message}`);
        return { list: [] };
    }
}

// ===== 详情 =====
async function detail(params) {
    try {
        const videoId = params.videoId;
        const tmdbKey = getTmdbKey(params);
        if (!videoId) return { list: [] };

        const { mappings } = await getCategoriesAndMappings();
        const type = detectTypeByPath(videoId, mappings);

        if (!isVideoFile(videoId)) {
            const folderName = videoId.split("/").pop();
            const tmdbId = extractTMDBId(folderName);
            const displayName = folderName.replace(/\s*tmdbid=\d+/i, "").trim();

            OmniBox.log("info", `扫描剧集集数: ${displayName}`);
            const allEps = await scanDirectoryForMedia(videoId);
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
                tmdb = await getTMDBInfo(tmdbId, "tv", tmdbKey);
            } else {
                tmdb = await searchTMDBInfo(displayName, "tv", tmdbKey);
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
            tmdb = await getTMDBInfo(tmdbId, type, tmdbKey);
        } else {
            const nameToSearch = getMovieSearchName(displayName, folderName);
            tmdb = await searchTMDBInfo(nameToSearch, type, tmdbKey);
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
