// @name 蜜桃影视
// @author ChatGPT
// @description OmniBox 蜜桃站最终稳定修复版（封面+播放地址+分页支持）
/* @dependencies: axios, cheerio */
// @version 1.4.0
// @downloadURL https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/5dc8db4f61161a9b329dccb26cabdbfe8fe1ed21/影视/采集/蜜桃臀.js


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
function extractPic(element, $) {
    let pic = "";
    
    const img = element.find("img");
    
    if (img.length > 0) {
        pic = img.attr("data-original") ||
              img.attr("data-src") ||
              img.attr("src") ||
              img.attr("data-lazy-src") ||
              img.attr("data-srcset") ||
              "";
        
        if (!pic) {
            const style = img.attr("style") || "";
            const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
            if (bgMatch) pic = bgMatch[1];
        }
    }
    
    if (!pic) {
        const parentImg = element.closest("a").find("img");
        if (parentImg.length > 0) {
            pic = parentImg.attr("data-original") ||
                  parentImg.attr("data-src") ||
                  parentImg.attr("src") ||
                  "";
        }
    }
    
    if (!pic) {
        const style = element.attr("style") || "";
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch) pic = bgMatch[1];
    }
    
    if (pic) {
        pic = pic.replace(/-\w+\.(jpg|jpeg|png|webp)/i, '.$1');
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

function extractHomePic(element, $) {
    let pic = "";
    
    const selectors = [
        element.find("img"),
        element.find(".lazy"),
        element.find("[data-original]"),
        element.find("[data-src]"),
        element.closest("a").find("img"),
        element.parent().find("img"),
        element.prev().find("img")
    ];
    
    for (let imgElement of selectors) {
        if (imgElement.length > 0) {
            pic = imgElement.attr("data-original") ||
                  imgElement.attr("data-src") ||
                  imgElement.attr("src") ||
                  imgElement.attr("data-lazy-src") ||
                  "";
            if (pic) break;
        }
    }
    
    if (!pic) {
        const bgElements = [
            element,
            element.find("[style*='background']"),
            element.closest("[style*='background']")
        ];
        
        for (let bgElement of bgElements) {
            if (bgElement.length > 0) {
                const style = bgElement.attr("style") || "";
                const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
                if (bgMatch) {
                    pic = bgMatch[1];
                    break;
                }
            }
        }
    }
    
    if (pic) {
        pic = pic.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1');
        pic = pic.replace(/thumb\//i, '');
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

// ================= 播放地址解析核心函数 =================
async function parseIframeContent(iframeUrl, depth = 0) {
    if (depth > 3) {
        logError("iframe 嵌套过深");
        return null;
    }
    
    try {
        logInfo("解析 iframe 内容", { iframeUrl, depth });
        const html = await request(iframeUrl);
        
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.flv[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.m4v[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.ts[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                const videoUrl = toAbsUrl(matches[0]);
                logInfo("从 iframe 找到播放地址", { videoUrl });
                return videoUrl;
            }
        }
        
        const redirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/location\.replace\(["']([^"']+)["']\)/i) ||
                             html.match(/setTimeout.*?location\.href=["']([^"']+)["']/i);
        
        if (redirectMatch) {
            let redirectUrl = redirectMatch[1];
            if (redirectUrl.startsWith('/')) {
                redirectUrl = BASE_URL + redirectUrl;
            } else if (!redirectUrl.startsWith('http')) {
                redirectUrl = BASE_URL + '/' + redirectUrl;
            }
            return parseIframeContent(redirectUrl, depth + 1);
        }
        
        const nestedIframe = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (nestedIframe) {
            let nestedUrl = nestedIframe[1];
            if (nestedUrl.startsWith('/')) {
                nestedUrl = BASE_URL + nestedUrl;
            } else if (!nestedUrl.startsWith('http')) {
                nestedUrl = BASE_URL + '/' + nestedUrl;
            }
            return parseIframeContent(nestedUrl, depth + 1);
        }
        
        const jsVarPatterns = [
            /var\s+url\s*=\s*["']([^"']+)["']/i,
            /var\s+videoUrl\s*=\s*["']([^"']+)["']/i,
            /var\s+src\s*=\s*["']([^"']+)["']/i,
            /["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv))["']/i,
        ];
        
        for (let pattern of jsVarPatterns) {
            const match = html.match(pattern);
            if (match && (match[1].includes('m3u8') || match[1].includes('mp4') || match[1].includes('flv'))) {
                const videoUrl = toAbsUrl(match[1]);
                logInfo("从 JavaScript 变量找到播放地址", { videoUrl });
                return videoUrl;
            }
        }
        
    } catch (e) {
        logError("解析 iframe 失败", e);
    }
    
    return null;
}

function parseVideoUrl(html, originalUrl) {
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
        /var\s+config\s*=\s*(\{[^;]+\})/i,
        /var\s+player\s*=\s*(\{[^;]+\})/i,
        /var\s+video\s*=\s*(\{[^;]+\})/i,
        /player_?\w*\s*=\s*(\{[^;]+\})/i,
        /MacPlayer\s*=\s*(\{[^;]+\})/i,
        /MacGuild\s*=\s*(\{[^;]+\})/i,
        /window\.player\s*=\s*(\{[^;]+\})/i,
    ];
    
    for (let pattern of playerConfigs) {
        const match = html.match(pattern);
        if (match) {
            try {
                let playerData = match[1];
                playerData = playerData.replace(/(\w+):/g, '"$1":');
                const data = JSON.parse(playerData);
                logInfo("找到播放器配置", data);
                
                const possibleFields = ['url', 'video', 'src', 'playUrl', 'play_url', 'source', 'mp4', 'm3u8', 'videoUrl'];
                for (let field of possibleFields) {
                    if (data[field]) {
                        videoUrl = data[field];
                        break;
                    }
                }
                
                if (data.encrypt === '1') {
                    try {
                        videoUrl = unescape(videoUrl);
                    } catch(e) {}
                }
                if (data.encrypt === '2') {
                    try {
                        videoUrl = decodeURIComponent(unescape(videoUrl));
                    } catch(e) {}
                }
                
                if (videoUrl) break;
            } catch (e) {}
        }
    }
    
    if (!videoUrl) {
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.flv[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.m4v[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.ts[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                videoUrl = matches[0];
                break;
            }
        }
    }
    
    if (!videoUrl) {
        const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["'][^>]*>/i) ||
                          html.match(/<source[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (videoMatch) {
            videoUrl = videoMatch[1];
        }
    }
    
    if (!videoUrl) {
        const jsVarPatterns = [
            /var\s+url\s*=\s*["']([^"']+)["']/i,
            /var\s+videoUrl\s*=\s*["']([^"']+)["']/i,
            /var\s+mp4\s*=\s*["']([^"']+)["']/i,
            /var\s+m3u8\s*=\s*["']([^"']+)["']/i,
            /var\s+src\s*=\s*["']([^"']+)["']/i,
            /["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv))["']/i,
        ];
        
        for (let pattern of jsVarPatterns) {
            const match = html.match(pattern);
            if (match && (match[1].includes('m3u8') || match[1].includes('mp4') || match[1].includes('flv'))) {
                videoUrl = match[1];
                break;
            }
        }
    }
    
    if (!videoUrl && html.includes('base64')) {
        const base64Match = html.match(/atob\(["']([^"']+)["']\)/i);
        if (base64Match) {
            try {
                const decoded = Buffer.from(base64Match[1], 'base64').toString('utf-8');
                const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/i);
                if (urlMatch) {
                    videoUrl = urlMatch[0];
                }
            } catch(e) {}
        }
    }
    
    if (!videoUrl) {
        const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
        if (scriptMatches) {
            for (let script of scriptMatches) {
                const urlMatch = script.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/i);
                if (urlMatch) {
                    videoUrl = urlMatch[0];
                    break;
                }
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

        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;

            let title = a.attr("title") || 
                       a.find("img").attr("alt") || 
                       a.find(".title, .name, h3, h4").text().trim() ||
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
                vod_remarks: a.find(".remarks, .episode, .tag").text().trim() || "",
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

// ================= 分类（支持分页）=================
async function category(params) {
    try {
        // TVBox 传递的参数格式
        let url = params.type_id || params.categoryId || "";
        let page = parseInt(params.page) || 1;
        
        logInfo("分类请求", { url, page, params });
        
        // 构建分页URL
        let pageUrl = url;
        
        // 如果URL已经包含页码参数，先移除
        pageUrl = pageUrl.replace(/[?&]page=\d+/, '');
        pageUrl = pageUrl.replace(/[?&]p=\d+/, '');
        
        // 添加页码参数（根据网站实际分页格式调整）
        if (pageUrl.includes('?')) {
            pageUrl += `&page=${page}`;
        } else {
            pageUrl += `?page=${page}`;
        }
        
        // 也尝试其他常见分页格式
        const possibleUrls = [
            pageUrl,
            url.replace(/\/$/, '') + `/${page}.html`,
            url + (url.includes('?') ? `&p=${page}` : `?p=${page}`),
            url + (url.includes('?') ? `&pg=${page}` : `?pg=${page}`)
        ];
        
        let html = "";
        let successUrl = "";
        
        // 尝试不同的分页URL格式
        for (let tryUrl of possibleUrls) {
            try {
                logInfo("尝试分页URL", { tryUrl });
                html = await request(tryUrl);
                successUrl = tryUrl;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!html) {
            throw new Error("无法访问分页页面");
        }
        
        const $ = cheerio.load(html);
        
        const list = [];
        const cache = new Set();
        
        // 提取视频列表
        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;
            
            // 跳过可能是广告的链接
            if (href.includes('ad') || href.includes('advert')) return;
            
            const title = a.attr("title") || 
                         a.find("img").attr("alt") || 
                         a.find(".title, .name, h3, h4").text().trim() ||
                         a.text().trim();
            
            if (!title || title.length < 1) return;
            
            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);
            
            const vod_pic = extractHomePic(a, $);
            
            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: a.find(".remarks, .episode, .tag").text().trim() || "",
            });
        });
        
        // 提取总页数
        let totalPages = 1;
        
        // 查找分页信息
        const paginationSelectors = [
            '.page', '.pagination', '.pages', '.page-numbers',
            '.next', '.prev', '.pager'
        ];
        
        for (let selector of paginationSelectors) {
            const pagination = $(selector);
            if (pagination.length) {
                const lastPageLink = pagination.find('a:last-child');
                if (lastPageLink.length) {
                    const lastPageHref = lastPageLink.attr('href') || "";
                    const pageMatch = lastPageHref.match(/[?&]page=(\d+)/) || 
                                    lastPageHref.match(/\/(\d+)\.html/);
                    if (pageMatch) {
                        totalPages = parseInt(pageMatch[1]) || 1;
                        break;
                    }
                }
                
                // 尝试从文本中提取
                const pageText = pagination.text();
                const pageMatch = pageText.match(/共(\d+)页/) || pageText.match(/\/(\d+)/);
                if (pageMatch) {
                    totalPages = parseInt(pageMatch[1]) || 1;
                    break;
                }
            }
        }
        
        // 检查是否有下一页
        let hasNextPage = false;
        const nextLink = $('a:contains("下一页"), a:contains("next"), .next, .pagination-next');
        if (nextLink.length && !nextLink.hasClass('disabled')) {
            hasNextPage = true;
            // 如果找到下一页链接，说明还有更多内容
            if (totalPages === 1) totalPages = page + 1;
        }
        
        // 如果当前页有内容且可能有下一页，设置总页数为当前页+1
        if (list.length > 0 && (hasNextPage || list.length >= 20)) {
            totalPages = Math.max(totalPages, page + 1);
        }
        
        logInfo("分类完成", { 
            page, 
            totalPages, 
            listCount: list.length,
            hasNextPage 
        });
        
        return {
            page: page,
            pagecount: totalPages,
            total: list.length * totalPages, // 估算总数
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

        const title =
            $("h1").first().text().trim() ||
            $(".title, .vod-title").first().text().trim() ||
            $("title").text().trim();

        let pic = "";
        
        const picSelectors = [
            ".detail img", ".vod-detail img", ".poster img", 
            ".cover img", ".thumb img", "img[class*='poster']",
            "img[class*='cover']", "img[class*='thumb']",
            ".content img", "img"
        ];
        
        for (let selector of picSelectors) {
            const img = $(selector).first();
            if (img.length) {
                pic = img.attr("data-original") ||
                      img.attr("data-src") ||
                      img.attr("src") ||
                      "";
                if (pic) break;
            }
        }
        
        if (!pic) {
            const bgElements = [".detail", ".vod-detail", ".poster", ".cover", ".thumb"];
            for (let selector of bgElements) {
                const style = $(selector).attr("style") || "";
                const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
                if (bgMatch) {
                    pic = bgMatch[1];
                    break;
                }
            }
        }

        pic = toAbsUrl(pic);

        const playSources = [];

        $("a[href*='/vodplay/']").each((i, el) => {
            const href = $(el).attr("href") || "";
            const name = $(el).text().trim() || `播放地址${i + 1}`;

            if (!href) return;

            playSources.push({
                name,
                episodes: [
                    {
                        name,
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

        logInfo("开始播放解析", {
            playUrl,
            flag: params.flag,
        });

        const html = await request(playUrl);
        
        const redirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/location\.replace\(["']([^"']+)["']\)/i) ||
                             html.match(/setTimeout.*?location\.href=["']([^"']+)["']/i);
        
        let videoUrl = null;
        
        if (redirectMatch) {
            logInfo("发现重定向", { redirectUrl: redirectMatch[1] });
            let redirectUrl = redirectMatch[1];
            if (redirectUrl.startsWith('/')) {
                redirectUrl = BASE_URL + redirectUrl;
            } else if (!redirectUrl.startsWith('http')) {
                redirectUrl = BASE_URL + '/' + redirectUrl;
            }
            
            const redirectHtml = await request(redirectUrl);
            videoUrl = parseVideoUrl(redirectHtml, redirectUrl);
        } else {
            videoUrl = parseVideoUrl(html, playUrl);
        }
        
        if (!videoUrl) {
            logError("未抓到播放地址", { 
                playUrl,
                htmlPreview: html.substring(0, 500) 
            });
            return {
                urls: [],
                parse: 1,
            };
        }
        
        if (videoUrl.includes('#')) {
            const urls = videoUrl.split('#').map(url => ({
                name: "播放地址",
                url: toAbsUrl(url.trim())
            }));
            return {
                urls: urls,
                parse: 0,
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
