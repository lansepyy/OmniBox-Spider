// @name 4KVM
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.2.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/4KVM.js

/**
* ============================================================================
* 4KVM
* 刮削：支持
* 弹幕：支持
* 嗅探：支持
* ============================================================================
*/
const axios = require("axios");
const https = require("https");
const http = require("http");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ========== 
const config = {
    host: "https://www.4kvm.org",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.4kvm.org/",
        "Cache-Control": "no-cache"
    }
};

// 弹幕 API 地址(优先使用环境变量)
const DANMU_API = process.env.DANMU_API || "";

// ========== 超时配置 ==========
const SCRAPE_TIMEOUT = 5 * 1000;      // 详情页刮削超时
const SNIFF_TIMEOUT = 10 * 1000;      // 播放页嗅探超时（原来 2.5s 太短，很多页面嗅探需要 5~10s）
const DANMU_TIMEOUT = 2 * 1000;       // 弹幕匹配超时

// ========== 缓存 ==========
const htmlCache = new Map();
const HTML_CACHE_TTL = 10 * 60 * 1000;

const axiosInstance = axios.create({
    timeout: 15 * 1000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true })
});

const PLAY_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Referer": "https://www.4kvm.org/",
    "Origin": "https://www.4kvm.org"
};

/**
* 日志工具函数
*/
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[4KVM-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[4KVM-DEBUG] ${message}: ${error.message || error}`);
};

/**
* 通用超时工具
*/
function withTimeout(promise, ms, fallback = null, label = "") {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                if (label) logInfo(`操作超时(${ms}ms): ${label}`);
                resolve(fallback);
            }
        }, ms);

        Promise.resolve(promise)
            .then((value) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                }
            })
            .catch((err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    if (label) logInfo(`操作失败: ${label} - ${err.message || err}`);
                    resolve(fallback);
                }
            });
    });
}

/**
* 带缓存的页面抓取
*/
async function getHtml(url, ttl = HTML_CACHE_TTL) {
    const now = Date.now();
    const hit = htmlCache.get(url);
    if (hit && hit.expireAt > now) {
        return hit.html;
    }

    const response = await axiosInstance.get(url, { headers: config.headers });
    const html = response.data;
    htmlCache.set(url, { html, expireAt: now + ttl });
    return html;
}

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
    } catch {
        return "";
    }
};

const decodeMeta = (str) => {
    try {
        const raw = Buffer.from(str || "", "base64").toString("utf8");
        return JSON.parse(raw || "{}");
    } catch {
        return {};
    }
};

/**
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniff4kvmPlay = async (playUrl) => {
    if (!playUrl) return null;
    try {
        logInfo("开始嗅探播放页", playUrl);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", sniffed.url);
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || { ...PLAY_HEADERS, "Referer": playUrl }
            };
        }
        logInfo("嗅探无结果");
    } catch (error) {
        logInfo(`嗅探失败: ${error.message}`);
    }
    return null;
};

const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        const epName = mapping.episodeNumber + "." + mapping.episodeName;
        return epName;
    }
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find(
            (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
        );
        if (hit?.name) {
            return `${hit.episodeNumber}.${hit.name}`;
        }
    }
    return originalName;
};

const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
    if (!scrapeData) {
        return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
    }
    if (scrapeType === "movie") {
        return scrapeData.title || fallbackVodName;
    }
    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || "";
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
};

/**
* 标准化URL
*/
const normalizeUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${config.host}${url}`;
    return url;
};

/**
* 提取视频基本信息
*/
const extractVideoBasic = ($item) => {
    try {
        const link = normalizeUrl(
            $item.find('a[href*="/play/"]').first().attr('href') ||
            $item.find('a').attr('href') ||
            $item.find('h3 a').attr('href') ||
            $item.find('.data h3 a').attr('href')
        );

        if (!link) return null;

        const title = (
            $item.find('h3').first().text().trim() ||
            $item.find('.data h3').text().trim() ||
            $item.find('img').attr('alt') ||
            $item.find('a').attr('title') ||
            '未知标题'
        );

        const img = normalizeUrl(
            $item.find('img').attr('data-src') ||
            $item.find('img').attr('src')
        );

        const remarks = (
            $item.find('.absolute.bottom-0 span').last().text().trim() ||
            $item.find('.text-xs.text-gray-400').last().text().trim() ||
            $item.find('.rating, .imdb, .vote').text().trim() ||
            $item.find('.year, .date, span').text().trim() ||
            $item.find('.type, .genre, .tag').text().trim() ||
            ''
        );

        return {
            vod_id: link,
            vod_name: title,
            vod_pic: img || '',
            vod_remarks: remarks
        };
    } catch (error) {
        logError("提取视频信息失败", error);
        return null;
    }
};

/**
* 获取视频列表
*/
const getVideoList = ($, selector = '.movie-card, article, .items article, .content article') => {
    const videos = [];
    $(selector).each((_, element) => {
        const videoInfo = extractVideoBasic($(element));
        if (videoInfo) {
            videos.push(videoInfo);
        }
    });
    return videos;
};

const getSearchVideoList = ($) => {
    const videos = [];
    const seen = new Set();

    $('a[href^="/play/"]').each((_, element) => {
        const $a = $(element);
        const href = normalizeUrl($a.attr('href'));
        if (!href || seen.has(href)) return;

        const title = (
            $a.find('h3').first().text().trim() ||
            $a.find('img').attr('alt') ||
            $a.attr('title') ||
            ''
        );
        if (!title) return;

        const pic = normalizeUrl($a.find('img').attr('data-src') || $a.find('img').attr('src'));
        const remarks = (
            $a.find('.absolute.top-2.right-2').text().trim() ||
            $a.find('.absolute.bottom-0 p').text().trim() ||
            ''
        );

        seen.add(href);
        videos.push({
            vod_id: href,
            vod_name: title,
            vod_pic: pic || '',
            vod_remarks: remarks,
        });
    });

    return videos;
};

/**
* 智能检测集数
* 检测不到时返回 null，由调用方兜底
*/
const getEpisodeCount = ($seasonData, pageHtml) => {
    try {
        // 方法1: 精确容器检测
        const episodeContainer = $seasonData('.jujiepisodios');
        if (episodeContainer.length) {
            const episodeLinks = episodeContainer.find('a');
            const episodeNumbers = [];
            episodeLinks.each((_, el) => {
                const text = $seasonData(el).text().trim();
                if (text) {
                    const num = parseInt(text);
                    if (num >= 1 && num <= 500) {
                        episodeNumbers.push(num);
                    }
                }
            });
            if (episodeNumbers.length > 0) {
                const result = Math.max(...episodeNumbers);
                logInfo("集数检测命中方法1: .jujiepisodios", { count: result, samples: episodeNumbers.slice(0, 10) });
                return result;
            }
        }

        // 方法2: JavaScript数据提取
        const videoMatches = pageHtml.match(/video.*?=.*?\[(.*?)\]/gi);
        if (videoMatches) {
            for (const match of videoMatches) {
                const episodeNames = match.match(/"name"\s*:\s*(\d+)/g);
                if (episodeNames && episodeNames.length >= 5) {
                    const numbers = episodeNames.map(m => parseInt(m.match(/\d+/)[0]));
                    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
                    if (sorted[0] === 1 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1) {
                        const result = Math.max(...sorted);
                        logInfo("集数检测命中方法2: JS数据", { count: result, samples: sorted.slice(0, 10) });
                        return result;
                    }
                }
            }
        }

        // 方法3: 文本模式匹配
        const pageText = $seasonData.text();
        const patterns = [/共(\d+)集/, /全(\d+)集/, /更新至(\d+)集/, /第(\d+)集/];
        for (const pattern of patterns) {
            const matches = pageText.match(pattern);
            if (matches && matches[1]) {
                const result = parseInt(matches[1]);
                logInfo("集数检测命中方法3: 文本模式", { pattern: String(pattern), count: result });
                return result;
            }
        }

        return null;
    } catch (error) {
        logError("检测集数失败", error);
        return null;
    }
};

/**
* 获取季度集数信息（并发抓取）
*/
const getSeasonEpisodes = async ($, detailUrl) => {
    const seasonItems = [];

    $('.seasons-list a, .season-item a, .se-c a, .se-a a, .seasons a').each((_, el) => {
        const $season = $(el);
        const title = $season.text().trim() || '第1季';
        const url = normalizeUrl($season.attr('href'));
        if (url) seasonItems.push({ name: title, url });
    });

    if (seasonItems.length === 0) return [];

    // 详情页 custom_fields 集数提示
    let detailCount = 0;
    const customFields = $(".custom_fields");
    if (customFields.length) {
        const spanText = customFields.last().find("span").last().text().trim();
        const parsed = parseInt(spanText, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            detailCount = parsed;
            logInfo(`集数检测命中方法0: .custom_fields span ${parsed}`);
        }
    }

    // 详情页其他方式检测到的集数（仅单季时参与修正）
    const detailDetected = seasonItems.length === 1 ? getEpisodeCount($, $.html()) : null;

    const seasonSources = await Promise.all(seasonItems.map(async (item) => {
        try {
            logInfo(`获取季度信息: ${item.name}，seasonUrl：${item.url}`);
            const html = await getHtml(item.url);
            const $seasonData = cheerio.load(html);

            const detected = getEpisodeCount($seasonData, html);
            let count = (Number.isFinite(detected) && detected > 0) ? detected : null;

            // 单季时用详情页信息修正
            if (seasonItems.length === 1) {
                if (Number.isFinite(detailDetected) && detailDetected > 0) {
                    count = count ? Math.max(count, detailDetected) : detailDetected;
                }
                if (detailCount > 0) {
                    count = count ? Math.max(count, detailCount) : detailCount;
                }
            }

            // 检测失败兜底
            if (!count || count <= 0) {
                count = $seasonData('iframe, video, .player').length ? 24 : 1;
            }

            // 防御性上限，避免异常值拖垮详情页
            count = Math.min(Math.max(count, 1), 2000);

            logInfo(`${item.name} 集数: ${count}`);

            const episodes = [];
            for (let epNum = 1; epNum <= count; epNum++) {
                const episodeTitle = `第${epNum}集`;
                const episodeUrl = `${item.url}?ep=${epNum}`;
                episodes.push({ name: episodeTitle, url: episodeUrl });
            }

            return { name: item.name, episodes };
        } catch (error) {
            logError("获取季度失败", error);
            return { name: item.name, episodes: [{ name: '第1集', url: item.url }] };
        }
    }));

    return seasonSources;
};

/**
* 提取播放选项
*/
const extractPlayOptions = ($, detailUrl) => {
    const playLinks = [];
    const playOptions = $('#playeroptions ul li, .dooplay_player_option');

    playOptions.each((_, element) => {
        const $option = $(element);
        let title = $option.find('.title, span.title').text().trim() || '播放';
        const server = $option.find('.server, span.server').text().trim();

        if (server) {
            title = `${title}-${server}`;
        }

        const dataPost = $option.attr('data-post');
        const dataNume = $option.attr('data-nume');
        const dataType = $option.attr('data-type');

        if (dataPost && dataNume) {
            const playUrl = `${detailUrl}?post=${dataPost}&nume=${dataNume}&type=${dataType || 'movie'}`;
            playLinks.push(`${title}$${playUrl}`);
        }
    });

    return playLinks;
};

/**
* 将播放链接数组转换为 vod_play_sources 格式
*/
const parsePlaySources = (playLinks, vodName, videoId = "") => {
    if (!playLinks || playLinks.length === 0) {
        return [];
    }
    const episodes = playLinks.map((link, epIndex) => {
        const parts = link.split('$');
        const episodeName = parts[0] || '正片';
        const actualUrl = parts[1] || parts[0];
        const fid = `${videoId}#0#${epIndex}`;
        const combinedId = `${actualUrl}|||${encodeMeta({ sid: String(videoId || ""), fid, v: vodName || "", e: episodeName })}`;

        return {
            name: episodeName,
            playId: combinedId,
            _fid: fid,
            _rawName: episodeName,
        };
    }).filter(e => e.playId);

    return [{
        name: '4KVM',
        episodes: episodes
    }];
};

const buildSeasonPlaySources = (seasonSources, vodName, videoId = "") => {
    if (!seasonSources || seasonSources.length === 0) {
        return [];
    }
    return seasonSources.map((season, seasonIndex) => {
        const episodes = (season.episodes || []).map((ep, epIndex) => {
            const episodeName = ep.name || '正片';
            const actualUrl = ep.url || '';
            const fid = `${videoId}#${seasonIndex}#${epIndex}`;
            const combinedId = `${actualUrl}|||${encodeMeta({ sid: String(videoId || ""), fid, v: vodName || "", e: episodeName })}`;
            return {
                name: episodeName,
                playId: combinedId,
                _fid: fid,
                _rawName: episodeName,
            };
        }).filter(e => e.playId);

        return {
            name: season.name || `线路${seasonIndex + 1}`,
            episodes: episodes
        };
    }).filter(source => (source.episodes || []).length > 0);
};

const extractEpisodePlaySources = ($, vodName, videoId = "") => {
    const sourcesMap = new Map();

    $('.episode-link[data-line][data-episode]').each((_, element) => {
        const $el = $(element);
        const line = String($el.attr('data-line') || '1');
        const episodeNo = String($el.attr('data-episode') || '').trim();
        const dataId = String($el.attr('dataid') || '').trim();
        const href = normalizeUrl($el.attr('href') || '');
        const rawName = $el.find('span').last().text().trim() || episodeNo || '播放';
        const episodeName = /^\d+$/.test(rawName) ? `第${rawName}集` : rawName;
        if (!href) return;

        const sourceName = `线路${line}`;
        if (!sourcesMap.has(sourceName)) {
            sourcesMap.set(sourceName, []);
        }

        const fid = dataId || `${videoId}#${line}#${episodeNo || sourcesMap.get(sourceName).length + 1}`;
        const combinedId = `${href}|||${encodeMeta({ sid: String(videoId || ""), fid, v: vodName || "", e: episodeName })}`;
        sourcesMap.get(sourceName).push({
            name: episodeName,
            playId: combinedId,
            _fid: fid,
            _rawName: rawName || episodeName,
            _episodeNumber: Number(episodeNo) || undefined,
        });
    });

    const sources = [];
    for (const [name, episodes] of sourcesMap.entries()) {
        episodes.sort((a, b) => Number(a._episodeNumber || 0) - Number(b._episodeNumber || 0));
        sources.push({ name, episodes });
    }
    return sources;
};

/**
* 过滤电视剧内容
*/
const filterTVShowsOnly = (videoList) => {
    const movieKeywords = ['/movies/', '/movie/'];
    const tvshowKeywords = ['/tvshows/', '/tvshow/', '/seasons/'];

    return videoList.filter(video => {
        const vodId = video.vod_id || '';
        const isMovie = movieKeywords.some(keyword => vodId.includes(keyword));
        if (isMovie) return false;

        const isTvshow = tvshowKeywords.some(keyword => vodId.includes(keyword));
        return isTvshow || !isMovie;
    });
};

/**
* 过滤搜索结果
*/
const filterSearchResults = (results, searchKey) => {
    if (!results || !searchKey) return results;

    const searchKeyLower = searchKey.toLowerCase().trim();
    const searchWords = searchKeyLower.split(/\s+/);
    const scoredResults = [];

    for (const result of results) {
        const title = (result.vod_name || '').toLowerCase();
        let score = 0;

        if (searchKeyLower === title) {
            score = 100;
        } else if (title.includes(searchKeyLower)) {
            score = 80;
        } else if (title.startsWith(searchKeyLower)) {
            score = 70;
        } else if (searchWords.every(word => title.includes(word))) {
            score = 60;
        } else {
            const wordMatches = searchWords.filter(word => title.includes(word)).length;
            if (wordMatches > 0) {
                score = 30 + (wordMatches * 10);
            } else {
                continue;
            }
        }

        if (searchKeyLower.includes('剧') && result.vod_id.includes('tvshows')) {
            score += 5;
        } else if (searchKeyLower.includes('电影') && result.vod_id.includes('movies')) {
            score += 5;
        }

        scoredResults.push({ score, result });
    }

    scoredResults.sort((a, b) => b.score - a.score);

    const minScore = searchWords.length > 1 ? 30 : 40;
    let filtered = scoredResults.filter(item => item.score >= minScore).map(item => item.result);

    if (filtered.length < 3 && scoredResults.length > 3) {
        filtered = scoredResults.slice(0, 10).map(item => item.result);
    }

    return filtered;
};

/**
 * 预处理标题，去掉常见干扰项
 */
function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
 * 将中文数字转换为阿拉伯数字 (简单实现)
 */
function chineseToArabic(cn) {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

/**
 * 核心：从标题中提取集数数字
 */
function extractEpisode(title) {
    if (!title) return "";

    const processedTitle = preprocessTitle(title).trim();

    // 1. S01E03 格式
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    // 2. 中文格式：第XX集/话
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    // 3. EP/E 格式
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    // 4. 括号格式 [03]
    const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    // 5. 独立的数字 (排除常见的视频参数)
    const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
    if (standaloneMatches) {
        const candidates = standaloneMatches
            .map(m => m.match(/\d+/)[0])
            .filter(num => {
                const n = parseInt(num);
                return n > 0 && n < 300 && !["720", "480", "264", "265"].includes(num);
            });

        if (candidates.length > 0) {
            const normalEp = candidates.find(n => parseInt(n) < 100);
            return normalEp || candidates[0];
        }
    }

    return "";
}

/**
* 根据播放URL推断文件名(用于弹幕匹配)
*/
function inferFileNameFromURL(url) {
    try {
        const urlObj = new URL(url);
        let base = urlObj.pathname.split("/").pop() || "";

        const dotIndex = base.lastIndexOf(".");
        if (dotIndex > 0) {
            base = base.substring(0, dotIndex);
        }

        base = base.replace(/[_-]/g, " ").replace(/\./g, " ").trim();

        return base || url;
    } catch (error) {
        return url;
    }
}

/**
* 匹配弹幕
*/
async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) {
        return [];
    }

    try {
        logInfo(`匹配弹幕: ${fileName}`);

        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName: fileName }),
        });

        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);

        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

        const matches = matchData.matches || [];
        if (matches.length === 0) {
            return [];
        }

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";

        if (!episodeId) {
            return [];
        }

        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;

        logInfo(`弹幕匹配成功: ${danmakuName}`);

        return [
            {
                name: danmakuName,
                url: danmakuURL,
            },
        ];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
}

/**
* 构建用于弹幕匹配的文件名
*/
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";

    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) {
                return `${vodName} S01E0${epNum}`;
            } else {
                return `${vodName} S01E${epNum}`;
            }
        }
    }

    return vodName;
}

// ========== 接口实现 ==========

/**
* 首页
*/
async function home(params) {
    logInfo("进入首页");

    try {
        const html = await getHtml(config.host);
        const $ = cheerio.load(html);

        const classes = [];
        const seen = new Set();
        $('nav a.nav-item').each((_, element) => {
            const $el = $(element);
            const link = normalizeUrl($el.attr('href'));
            const name = $el.text().trim();
            if (!link || !name || ['首页', '影片下载', '片单'].includes(name)) return;
            if (!/^https?:\/\/www\.4kvm\.org\/(movie|tv|anime|filter)/.test(link)) return;
            if (seen.has(link)) return;
            seen.add(link);
            classes.push({ type_id: link, type_name: name });
        });

        const homeList = getVideoList($, '.movie-card');

        logInfo(`分类获取完成,共 ${classes.length} 个`);

        return {
            class: classes,
            list: homeList
        };
    } catch (error) {
        logError("首页获取失败", error);
        return {
            class: [
                { 'type_id': `${config.host}/movie`, 'type_name': '电影' },
                { 'type_id': `${config.host}/tv`, 'type_name': '电视剧' },
                { 'type_id': `${config.host}/anime`, 'type_name': '动漫' },
                { 'type_id': `${config.host}/filter`, 'type_name': '筛选' }
            ],
            list: []
        };
    }
}

/**
* 分类
*/
async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);

    try {
        let url = categoryId;
        if (pg > 1) {
            url = categoryId.includes('?')
                ? `${categoryId}&page=${pg}`
                : `${categoryId}?page=${pg}`;
        }

        const html = await getHtml(url);
        const $ = cheerio.load(html);

        let videoList = getVideoList($, '.movie-card');

        if (categoryId.includes('/tv')) {
            videoList = filterTVShowsOnly(videoList);
        }

        logInfo(`获取到 ${videoList.length} 个视频`);

        return {
            list: videoList,
            page: pg,
            pagecount: videoList.length > 0 ? pg + 1 : pg
        };
    } catch (error) {
        logError("分类请求失败", error);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
* 详情
*/
async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        const html = await getHtml(videoId);
        const $ = cheerio.load(html);

        const detailMap = {};
        $('.grid .text-gray-500').each((_, el) => {
            const key = $(el).text().trim();
            const value = $(el).next('div').text().trim();
            if (key && value) detailMap[key] = value;
        });

        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const metaPic = $('meta[property="og:image"]').attr('content') || '';
        const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
        const keywordParts = metaKeywords.split(',').map((s) => s.trim()).filter(Boolean);

        const vod = {
            vod_id: videoId,
            vod_name: $('h1.text-xl, h1').first().text().trim() || $('meta[property="og:title"]').attr('content')?.replace(/\s*-\s*第\d+集.*$/, '') || '未知标题',
            vod_pic: normalizeUrl($('.video-player').attr('data-poster') || $('.video-player img').attr('src') || metaPic),
            vod_content: $('.bg-dark-800 p.text-xs.text-gray-300.leading-relaxed').first().text().trim() || metaDesc.trim(),
            vod_year: detailMap['年份'] || '',
            vod_area: detailMap['地区'] || detailMap['国家/地区'] || '',
            vod_remarks: detailMap['状态'] || $('.text-xs.text-gray-500').filter((_, el) => $(el).text().includes('更新')).first().text().trim() || '',
            vod_actor: detailMap['主演'] || '',
            vod_director: detailMap['导演'] || ''
        };

        const genres = [];
        if (detailMap['类型']) genres.push(...detailMap['类型'].split('/').map((s) => s.trim()).filter(Boolean));
        if (genres.length === 0 && keywordParts.length > 1) {
            const maybeType = keywordParts.filter((s) => !/^\d+(\.\d+)?$/.test(s) && s !== vod.vod_name && s !== vod.vod_director);
            if (maybeType.length > 0) genres.push(maybeType[0]);
        }
        if (genres.length > 0) {
            vod.type_name = genres.join(', ');
        }

        logInfo(`视频标题: ${vod.vod_name}`);

        // 获取播放链接
        let playLinks = extractPlayOptions($, videoId);
        let seasonSources = [];
        const videoIdForScrape = String(videoId || "");
        let playSources = extractEpisodePlaySources($, vod.vod_name, videoIdForScrape);

        // 旧结构兜底
        if (playSources.length === 0) {
            const seasonLinks = $('.seasons-list a, .season-item a, .se-c a, .se-a a, .seasons a');
            if (playLinks.length === 0 && seasonLinks.length > 0) {
                seasonSources = await getSeasonEpisodes($, videoId);
                if (seasonSources.length === 0) {
                    playLinks = [`播放$${videoId}`];
                }
            } else if (playLinks.length === 0) {
                playLinks = [`播放$${videoId}`];
            }

            playSources = seasonSources.length > 0
                ? buildSeasonPlaySources(seasonSources, vod.vod_name, videoIdForScrape)
                : parsePlaySources(playLinks, vod.vod_name, videoIdForScrape);
        }

        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";
        const scrapeCandidates = [];

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                if (!ep._fid) continue;
                scrapeCandidates.push({
                    fid: ep._fid,
                    file_id: ep._fid,
                    file_name: ep._rawName || ep.name || "正片",
                    name: ep._rawName || ep.name || "正片",
                    format_type: "video",
                });
            }
        }

        // 详情页只刮削前 N 集，避免集数过多时严重阻塞详情返回
        const SCRAPE_LIMIT = 30;
        const scrapeCandidatesToProcess = scrapeCandidates.slice(0, SCRAPE_LIMIT);

        if (scrapeCandidatesToProcess.length > 0) {
            try {
                await withTimeout(
                    OmniBox.processScraping(
                        videoIdForScrape,
                        vod.vod_name || "",
                        vod.vod_name || "",
                        scrapeCandidatesToProcess
                    ),
                    SCRAPE_TIMEOUT,
                    null,
                    "详情页刮削"
                );

                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
            } catch (error) {
                logError("刮削处理失败", error);
            }
        }

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                if (!mapping) continue;
                const oldName = ep.name;
                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                if (newName && newName !== oldName) {
                    ep.name = newName;
                    OmniBox.log("info", `[4KVM-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
                }
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }

            const hasEpisodeNumber = (source.episodes || []).some(
                (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
            );
            if (hasEpisodeNumber) {
                source.episodes.sort((a, b) => {
                    const seasonA = a._seasonNumber || 0;
                    const seasonB = b._seasonNumber || 0;
                    if (seasonA !== seasonB) return seasonA - seasonB;
                    const episodeA = a._episodeNumber || 0;
                    const episodeB = b._episodeNumber || 0;
                    return episodeA - episodeB;
                });
            }
        }

        vod.vod_play_sources = playSources.map((source) => ({
            name: source.name,
            episodes: (source.episodes || []).map((ep) => ({
                name: ep.name,
                playId: ep.playId,
            })),
        }));

        if (scrapeData) {
            vod.vod_name = scrapeData.title || vod.vod_name;
            if (scrapeData.posterPath) {
                vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            }
            if (scrapeData.overview) {
                vod.vod_content = scrapeData.overview;
            }
            if (scrapeData.releaseDate) {
                vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year;
            }
            const actors = (scrapeData.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",");
            if (actors) {
                vod.vod_actor = actors;
            }
            const directors = (scrapeData.credits?.crew || [])
                .filter((c) => c?.job === "Director" || c?.department === "Directing")
                .slice(0, 3)
                .map((c) => c?.name)
                .filter(Boolean)
                .join(",");
            if (directors) {
                vod.vod_director = directors;
            }
        }

        const totalEpisodes = playSources.reduce((sum, source) => sum + (source.episodes || []).length, 0);
        logInfo(`播放线路数: ${playSources.length}, 总集数: ${totalEpisodes}`);

        return {
            list: [vod]
        };
    } catch (error) {
        logError("详情获取失败", error);
        return { list: [] };
    }
}

/**
* 搜索
*/
async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);

    try {
        let searchUrl = `${config.host}/search?q=${encodeURIComponent(wd)}`;
        if (pg > 1) {
            searchUrl += `&page=${pg}`;
        }

        const html = await getHtml(searchUrl);
        const $ = cheerio.load(html);

        const rawResults = getSearchVideoList($);
        const filteredResults = filterSearchResults(rawResults, wd);

        logInfo(`搜索到 ${filteredResults.length} 个结果`);

        return {
            list: filteredResults,
            page: pg,
            pagecount: filteredResults.length > 0 ? pg + 1 : pg
        };
    } catch (error) {
        logError("搜索失败", error);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
* 播放
*/
async function play(params) {
    let playId = params.playId;
    const flag = params.flag || "";
    logInfo(`准备播放 ID: ${playId}, flag: ${flag}`);

    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    // 解析透传参数
    if (playId && playId.includes("|||")) {
        const [mainPlayId, metaB64] = playId.split("|||");
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}, 真实playId: ${playId}`);
    } else if (playId && playId.includes('|')) {
        const parts = playId.split('|');
        playId = parts[0];
        vodName = parts[1] || "";
        episodeName = parts[2] || "";
        logInfo(`解析旧格式透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    let scrapedDanmuFileName = "";
    try {
        const videoIdFromParam = params.vodId ? String(params.vodId) : "";
        const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
        const videoIdForScrape = videoIdFromParam || videoIdFromMeta;
        if (videoIdForScrape) {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(
                    metadata.scrapeData,
                    metadata.scrapeType || "",
                    mapping,
                    vodName,
                    episodeName
                );
                if (metadata.scrapeData.title) {
                    vodName = metadata.scrapeData.title;
                }
                if (mapping?.episodeName) {
                    episodeName = mapping.episodeName;
                }
            }
        }
    } catch (error) {
        logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    try {
        let dataPost = null;
        let dataNume = null;
        let dataType = null;
        let baseUrl = playId;

        if (playId.includes('?')) {
            const [url, queryParams] = playId.split('?', 2);
            baseUrl = url;
            const paramPairs = queryParams.split('&');
            for (const pair of paramPairs) {
                const [key, value] = pair.split('=');
                if (key === 'post') dataPost = value;
                if (key === 'nume') dataNume = value;
                if (key === 'type') dataType = value;
            }
            logInfo(`解析播放参数: post=${dataPost}, nume=${dataNume}, type=${dataType}`);
        }

        let playResponse = {
            urls: [{ name: "4KVM", url: playId }],
            parse: 1,
            header: PLAY_HEADERS
        };

        // API调用
        if (dataPost && dataNume) {
            try {
                const apiUrl = `${config.host}/wp-json/dooplayer/v1/post/${dataPost}`;
                logInfo(`调用播放API: ${apiUrl}, source=${dataNume}`);

                const apiResponse = await axiosInstance.get(apiUrl, {
                    headers: config.headers,
                    params: {
                        type: dataType || 'movie',
                        source: dataNume
                    },
                    timeout: 15000
                });

                if (apiResponse.status === 200 && apiResponse.data.embed_url) {
                    const embedUrl = apiResponse.data.embed_url;
                    const parseFlag = ['.m3u8', '.mp4', '.flv', '.avi'].some(ext =>
                        embedUrl.toLowerCase().includes(ext)
                    ) ? 0 : 1;

                    logInfo(`API解析成功: ${embedUrl}, parse=${parseFlag}`);
                    playResponse.urls = [{ name: "4KVM", url: embedUrl }];
                    playResponse.parse = parseFlag;
                } else {
                    logInfo(`API返回异常: HTTP ${apiResponse.status}`);
                }
            } catch (error) {
                logError("API调用失败", error);
            }
        }

        // 如果API调用失败，页面解析回退
        if (playResponse.urls[0].url === playId) {
            logInfo(`API未返回直链，尝试页面解析: ${baseUrl}`);
            const html = await getHtml(baseUrl);
            const $ = cheerio.load(html);

            const iframe = $('iframe.metaframe, .dooplay_player iframe, .player iframe').first().attr('src');
            if (iframe) {
                const iframeUrl = normalizeUrl(iframe);
                const parseFlag = ['.m3u8', '.mp4', '.flv'].some(ext =>
                    iframeUrl.toLowerCase().includes(ext)
                ) ? 0 : 1;

                logInfo(`Iframe解析: ${iframeUrl}, parse=${parseFlag}`);
                playResponse.urls = [{ name: "4KVM", url: iframeUrl }];
                playResponse.parse = parseFlag;
            } else {
                const videoSrc = normalizeUrl($('video source, video').first().attr('src'));
                if (videoSrc) {
                    logInfo(`Video标签解析: ${videoSrc}`);
                    playResponse.urls = [{ name: "4KVM", url: videoSrc }];
                    playResponse.parse = 0;
                } else {
                    logInfo("页面解析未找到 iframe/video");
                }
            }
        }

        // 非直链时嗅探，带超时
        const currentUrl = playResponse.urls[0]?.url;
        if (currentUrl && !/\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i.test(currentUrl)) {
            logInfo(`当前地址非直链，开始嗅探: ${currentUrl}`);
            const sniffResult = await withTimeout(
                sniff4kvmPlay(currentUrl),
                SNIFF_TIMEOUT,
                null,
                "播放页嗅探"
            );
            if (sniffResult) {
                playResponse = sniffResult;
                logInfo("嗅探结果已采用");
            } else {
                logInfo("嗅探超时或失败，保留原地址返回");
            }
        } else {
            logInfo(`当前地址为直链，跳过嗅探: ${currentUrl}`);
        }

        // 弹幕匹配，带超时
        if (DANMU_API && (vodName || params.vodName)) {
            const finalVodName = vodName || params.vodName;
            const finalEpisodeName = episodeName || params.episodeName || '';

            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(finalVodName, finalEpisodeName);
            logInfo(`尝试匹配弹幕文件名: ${fileName}`);

            if (fileName) {
                const danmakuList = await withTimeout(matchDanmu(fileName), DANMU_TIMEOUT, [], "弹幕匹配");
                if (danmakuList && danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                }
            }
        }

        logInfo(`最终播放返回: ${JSON.stringify({
            url: playResponse.urls?.[0]?.url,
            parse: playResponse.parse,
            hasDanmaku: !!(playResponse.danmaku && playResponse.danmaku.length > 0)
        })}`);

        return playResponse;
    } catch (error) {
        logError("播放解析失败", error);
        const fallbackSniff = await withTimeout(sniff4kvmPlay(playId), SNIFF_TIMEOUT, null, "失败兜底嗅探");
        if (fallbackSniff) {
            return fallbackSniff;
        }
        return {
            urls: [{ name: "4KVM", url: playId }],
            parse: 1,
            header: PLAY_HEADERS
        };
    }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
