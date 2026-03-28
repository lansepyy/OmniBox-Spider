// @downloadURL https://gh-proxy.org/https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/main/影视/采集/蜜桃臀.js

// @name 蜜桃影视
// @author ChatGPT
// @description OmniBox 蜜桃站最终稳定修复版（TVBox分页支持）
/* @dependencies: axios, cheerio */
// @version 1.5.0

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://mitaotunbbx.xyz";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ================= 日志 =================
function logInfo(msg, data = null) {
    const suffix = data ? `: ${JSON.stringify(data)}` : "";
    OmniBox.log("info", `[蜜桃] ${msg}${suffix}`);
}

function logError(msg, err = null) {
    const suffix = err ? `: ${err.message || err}` : "";
    OmniBox.log("error", `[蜜桃] ${msg}${suffix}`);
}

// ================= 工具 =================
function toAbsUrl(url) {
    if (!url) return "";

    url = String(url).trim();

    if (!url) return "";

    if (url.startsWith("http")) return url;

    if (url.startsWith("//")) return "https:" + url;

    if (url.startsWith("/")) return BASE_URL + url;

    return `${BASE_URL}/${url}`;
}

async function request(url, retryCount = 0) {
    try {
        logInfo("请求页面", { url });
        
        const res = await axios.get(url, {
            timeout: 15000,
            headers: {
                "User-Agent": UA,
                "Referer": BASE_URL,
                "Origin": BASE_URL,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
            responseType: "text",
            maxRedirects: 5,
        });

        return res.data || "";
    } catch (error) {
        if (retryCount < 2) {
            logInfo(`请求失败，重试 ${retryCount + 1}/2`, { url, error: error.message });
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return request(url, retryCount + 1);
        }
        throw error;
    }
}

// ================= 增强的封面图提取函数 =================
function extractHomePic(element, $) {
    let pic = "";
    
    const img = element.find("img");
    if (img.length > 0) {
        pic = img.attr("data-original") ||
              img.attr("data-src") ||
              img.attr("src") ||
              "";
    }
    
    if (!pic) {
        const style = element.attr("style") || "";
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch) pic = bgMatch[1];
    }
    
    if (pic) {
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

// ================= 播放地址解析核心函数 =================
async function parseIframeContent(iframeUrl, depth = 0) {
    if (depth > 3) {
        return null;
    }
    
    try {
        const html = await request(iframeUrl);
        
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.flv[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                return toAbsUrl(matches[0]);
            }
        }
        
        const redirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/location\.replace\(["']([^"']+)["']\)/i);
        
        if (redirectMatch) {
            let redirectUrl = redirectMatch[1];
            if (redirectUrl.startsWith('/')) {
                redirectUrl = BASE_URL + redirectUrl;
            } else if (!redirectUrl.startsWith('http')) {
                redirectUrl = BASE_URL + '/' + redirectUrl;
            }
            return parseIframeContent(redirectUrl, depth + 1);
        }
        
    } catch (e) {
        logError("解析 iframe 失败", e);
    }
    
    return null;
}

function parseVideoUrl(html) {
    let videoUrl = "";
    
    const iframeMatches = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi);
    if (iframeMatches) {
        for (let iframe of iframeMatches) {
            const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
            if (srcMatch) {
                let iframeUrl = srcMatch[1];
                if (iframeUrl.startsWith('/')) {
                    iframeUrl = BASE_URL + iframeUrl;
                } else if (!iframeUrl.startsWith('http')) {
                    iframeUrl = BASE_URL + '/' + iframeUrl;
                }
                return parseIframeContent(iframeUrl);
            }
        }
    }
    
    const playerConfigs = [
        /var\s+player_info\s*=\s*(\{[^;]+\})/i,
        /var\s+player_data\s*=\s*(\{[^;]+\})/i,
        /MacPlayer\s*=\s*(\{[^;]+\})/i,
    ];
    
    for (let pattern of playerConfigs) {
        const match = html.match(pattern);
        if (match) {
            try {
                let playerData = match[1];
                playerData = playerData.replace(/(\w+):/g, '"$1":');
                const data = JSON.parse(playerData);
                
                const possibleFields = ['url', 'video', 'src', 'playUrl', 'mp4', 'm3u8'];
                for (let field of possibleFields) {
                    if (data[field]) {
                        videoUrl = data[field];
                        break;
                    }
                }
                if (videoUrl) break;
            } catch (e) {}
        }
    }
    
    if (!videoUrl) {
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                videoUrl = matches[0];
                break;
            }
        }
    }
    
    return videoUrl || null;
}

// ================= 首页 =================
async function home() {
    try {
        const html = await request(BASE_URL);
        const $ = cheerio.load(html);

        const classes = [];
        const classCache = new Set();

        $("a[href*='/list/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const name = $(el).text().trim();

            if (!href || !name) return;
            if (name.length > 20) return;

            const id = toAbsUrl(href);

            if (classCache.has(id)) return;
            classCache.add(id);

            classes.push({
                type_id: id,
                type_name: name,
            });
        });

        const list = [];
        const cache = new Set();

        $("a[href*='/detail/']").each((_, el) => {
            const a = $(el);
            
            const href = a.attr("href") || "";
            if (!href) return;

            let title = a.attr("title") || 
                       a.find("img").attr("alt") || 
                       a.text().trim();
            
            if (!title) return;

            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);

            const vod_pic = extractHomePic(a, $);
            
            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: "",
            });
        });

        return {
            class: classes,
            list: list.slice(0, 30),
        };
    } catch (e) {
        logError("首页失败", e);
        return {
            class: [],
            list: [],
        };
    }
}

// ================= 分类（支持TVBox分页）=================
async function category(params) {
    try {
        let typeId = params.type_id || params.categoryId || "";
        let currentPage = parseInt(params.page) || 1;
        
        logInfo("分类请求", { typeId, currentPage });
        
        // 构建分页URL
        let pageUrl = typeId;
        
        // 移除末尾的斜杠
        pageUrl = pageUrl.replace(/\/$/, '');
        
        // 添加页码参数
        if (pageUrl.includes('?')) {
            pageUrl = `${pageUrl}&page=${currentPage}`;
        } else {
            pageUrl = `${pageUrl}?page=${currentPage}`;
        }
        
        logInfo("请求分类URL", { pageUrl });
        
        const html = await request(pageUrl);
        const $ = cheerio.load(html);
        
        const list = [];
        const cache = new Set();
        
        // 提取视频列表
        $("a[href*='/detail/']").each((_, el) => {
            const a = $(el);
            const href = a.attr("href") || "";
            if (!href) return;
            
            // 提取标题
            let title = a.attr("title") || 
                       a.find("img").attr("alt") || 
                       a.text().trim();
            
            if (!title || title.length < 1) return;
            
            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);
            
            // 提取图片
            let vod_pic = "";
            const img = a.find("img");
            if (img.length) {
                vod_pic = img.attr("data-original") || img.attr("data-src") || img.attr("src") || "";
            }
            vod_pic = toAbsUrl(vod_pic);
            
            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: "",
            });
        });
        
        // 判断是否有下一页
        let hasNextPage = false;
        
        // 检查下一页链接
        const nextLink = $('a:contains("下一页"), a:contains("下页"), a:contains("next"), .next, .pagination-next');
        if (nextLink.length && !nextLink.hasClass("disabled")) {
            hasNextPage = true;
        }
        
        // 如果当前页有20个以上的内容，假设有下一页
        if (list.length >= 20) {
            hasNextPage = true;
        }
        
        // 计算总页数
        let totalPages = currentPage;
        if (hasNextPage) {
            totalPages = currentPage + 1;
        } else {
            totalPages = currentPage;
        }
        
        logInfo("分类完成", { 
            currentPage, 
            totalPages, 
            listCount: list.length,
            hasNextPage
        });
        
        return {
            page: currentPage,
            pagecount: totalPages,
            total: list.length * totalPages,
            list: list,
        };
        
    } catch (e) {
        logError("分类失败", e);
        
        return {
            list: [],
            page: 1,
            pagecount: 1,
            total: 0,
        };
    }
}

// ================= 详情 =================
async function detail(params) {
    try {
        const url = params.videoId;

        const html = await request(url);
        const $ = cheerio.load(html);

        const title = $("h1").first().text().trim() || $("title").text().trim();

        let pic = "";
        
        const img = $(".detail img, .vod-detail img, .poster img, .cover img, img").first();
        if (img.length) {
            pic = img.attr("data-original") || img.attr("data-src") || img.attr("src") || "";
        }
        
        pic = toAbsUrl(pic);

        const playSources = [];

        $("a[href*='/vodplay/']").each((i, el) => {
            const href = $(el).attr("href") || "";
            const name = $(el).text().trim() || `播放地址${i + 1}`;

            if (!href) return;

            playSources.push({
                name: name,
                episodes: [
                    {
                        name: name,
                        playId: toAbsUrl(href),
                    },
                ],
            });
        });

        return {
            list: [
                {
                    vod_id: url,
                    vod_name: title,
                    vod_pic: pic || "https://via.placeholder.com/200x300?text=No+Image",
                    vod_play_sources: playSources,
                },
            ],
        };
    } catch (e) {
        logError("详情失败", e);
        return {
            list: [],
        };
    }
}

// ================= 播放 =================
async function play(params) {
    try {
        const playUrl = params.playId;

        logInfo("开始播放解析", { playUrl });

        const html = await request(playUrl);
        
        let videoUrl = parseVideoUrl(html);
        
        if (!videoUrl) {
            logError("未抓到播放地址");
            return {
                urls: [],
                parse: 1,
            };
        }
        
        videoUrl = toAbsUrl(videoUrl);
        
        logInfo("真实播放地址", { videoUrl });
        
        return {
            urls: [
                {
                    name: params.flag || "默认线路",
                    url: videoUrl,
                },
            ],
            parse: 0,
        };
    } catch (e) {
        logError("播放失败", e);
        
        return {
            urls: [],
            parse: 1,
        };
    }
}

module.exports = {
    home,
    category,
    detail,
    play,
};

runner.run(module.exports);
