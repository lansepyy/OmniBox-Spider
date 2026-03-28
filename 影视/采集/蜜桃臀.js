// @name 蜜桃臀18+
// @author ChatGPT
// @description OmniBox 蜜桃站最终稳定修复版（封面+播放地址）- 增强封面提取
/* @dependencies: axios, cheerio */
// @version 1.3.0
// @downloadURL https://gh-proxy.org/https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/main/影视/采集/蜜桃臀.js

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
    
    // 从当前元素查找图片
    const img = element.find("img");
    
    if (img.length > 0) {
        // 尝试各种图片属性
        pic = img.attr("data-original") ||
              img.attr("data-src") ||
              img.attr("src") ||
              img.attr("data-lazy-src") ||
              img.attr("data-srcset") ||
              "";
        
        // 如果还是没找到，尝试从 style 属性中提取
        if (!pic) {
            const style = img.attr("style") || "";
            const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
            if (bgMatch) pic = bgMatch[1];
        }
        
        // 尝试从 class 中提取背景图
        if (!pic) {
            const classAttr = img.attr("class") || "";
            if (classAttr.includes("lazy")) {
                pic = img.attr("data-original") || img.attr("data-src");
            }
        }
    }
    
    // 如果当前元素没有图片，尝试查找父级或兄弟元素中的图片
    if (!pic) {
        const parentImg = element.closest("a").find("img");
        if (parentImg.length > 0) {
            pic = parentImg.attr("data-original") ||
                  parentImg.attr("data-src") ||
                  parentImg.attr("src") ||
                  "";
        }
    }
    
    // 如果还是没有，尝试从背景图中提取
    if (!pic) {
        const style = element.attr("style") || "";
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch) pic = bgMatch[1];
    }
    
    // 如果图片是相对路径，补全为绝对路径
    if (pic) {
        // 处理可能的小图后缀，尝试获取大图
        pic = pic.replace(/-\w+\.(jpg|jpeg|png|webp)/i, '.$1');
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

// ================= 首页增强封面提取 =================
function extractHomePic(element, $) {
    let pic = "";
    
    // 查找所有可能的图片元素
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
    
    // 如果还是没找到，尝试从背景图中提取
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
    
    // 处理图片URL
    if (pic) {
        // 替换可能的小图后缀
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
        
        // 在 iframe 页面中直接查找播放地址
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
        
        // 查找 iframe 中的重定向
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
        
        // 查找嵌套的 iframe
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
        
        // 尝试从 JavaScript 变量中提取
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
    
    // 1. 提取并解析 iframe
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
    
    // 2. 尝试解析页面中的播放器配置
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
                // 处理可能的 JavaScript 对象格式
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
            } catch (e) {
                // JSON 解析失败，继续尝试
            }
        }
    }
    
    // 3. 直接在页面中搜索视频地址
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
    
    // 4. 提取 video 或 source 标签
    if (!videoUrl) {
        const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["'][^>]*>/i) ||
                          html.match(/<source[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (videoMatch) {
            videoUrl = videoMatch[1];
        }
    }
    
    // 5. 提取 JavaScript 变量
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
    
    // 6. Base64 解码
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
    
    // 7. 尝试从 script 标签中提取
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

        // 更精准的视频条目选择器
        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;

            // 提取标题
            let title = a.attr("title") || 
                       a.find("img").attr("alt") || 
                       a.find(".title, .name, h3, h4").text().trim() ||
                       a.text().trim();
            
            if (!title) return;

            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);

            // 使用增强的封面提取函数
            const vod_pic = extractHomePic(a, $);
            
            logInfo("提取到视频", { title, vodId, vod_pic });

            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: a.find(".remarks, .episode, .tag").text().trim() || "",
            });
        });

        logInfo("首页完成", { classCount: classes.length, videoCount: list.length });

        return {
            class: classes,
            list: list.slice(0, 30), // 限制首页数量
        };
    } catch (e) {
        logError("首页失败", e);

        return {
            class: [],
            list: [],
        };
    }
}

// ================= 分类 =================
async function category(params) {
    try {
        const url = String(
            params.type_id ||
            params.categoryId ||
            ""
        );

        const html = await request(url);
        const $ = cheerio.load(html);

        const list = [];
        const cache = new Set();

        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;

            const title = a.attr("title") || 
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
            page: 1,
            pagecount: 999,
            total: list.length,
            list,
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

        // 增强的详情页封面提取
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
        
        // 如果没有找到，尝试从背景图中提取
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

        logInfo("详情解析", {
            title,
            pic,
            playCount: playSources.length,
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
        
        // 检查是否有重定向
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
        
        // 处理可能的多个地址（用 # 分隔）
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
