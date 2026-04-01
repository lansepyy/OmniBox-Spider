const OmniBox = require("omnibox_sdk");
// @downloadURL https://gh-proxy.org/https://raw.githubusercontent.com/lansepyy/OmniBox-Spider/main/影视/采集/测试聚合.js

// ===== CMS源 =====
const CMS_SITES = [
  { name: "滴滴", api: "https://api.ddapi.cc/api.php/provide/vod" },
  { name: "鸡坤", api: "https://jkunzyapi.com/api.php/provide/vod" },
  { name: "TG资源", api: "https://tgzyz.pp.ua/api.php/provide/vod" }
];

// ===== 请求 =====
async function request(api, params = {}) {
  const url = new URL(api);
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));

  try {
    const res = await OmniBox.request(url.toString());
    return JSON.parse(res.body);
  } catch (e) {
    return {};
  }
}

// ===== 修复封面 =====
function fixPic(pic) {
  if (!pic || pic === "<nil>") {
    return "https://via.placeholder.com/300x400?text=No+Image";
  }
  if (pic.startsWith("//")) {
    return "https:" + pic;
  }
  return pic;
}

// ===== 首页（分类+推荐）=====
async function home() {
  let classes = [];
  let videos = [];

  // 取第一个站点的分类
  const first = await request(CMS_SITES[0].api, { ac: "class" });
  if (first.class) {
    classes = first.class.map(c => ({
      type_id: CMS_SITES[0].api + "|" + c.type_id,
      type_name: c.type_name
    }));
  }

  // 推荐：多源聚合
  for (const site of CMS_SITES) {
    const data = await request(site.api, { ac: "list", pg: 1 });
    if (data.list) {
      videos.push(...data.list.slice(0, 5).map(v => ({
        vod_id: site.api + "|" + v.vod_id,
        vod_name: `[${site.name}] ` + v.vod_name,
        vod_pic: fixPic(v.vod_pic),
        vod_remarks: v.vod_remarks
      })));
    }
  }

  return { class: classes, list: videos };
}

// ===== 分类 =====
async function category(params) {
  const [api, tid] = params.categoryId.split("|");

  const data = await request(api, {
    ac: "videolist",
    t: tid,
    pg: params.page || 1
  });

  return {
    list: (data.list || []).map(v => ({
      vod_id: api + "|" + v.vod_id,
      vod_name: v.vod_name,
      vod_pic: fixPic(v.vod_pic),
      vod_remarks: v.vod_remarks
    }))
  };
}

// ===== 搜索 =====
async function search(params) {
  let list = [];

  await Promise.all(CMS_SITES.map(async site => {
    const data = await request(site.api, {
      ac: "list",
      wd: params.wd,
      pg: 1
    });

    if (data.list) {
      list.push(...data.list.map(v => ({
        vod_id: site.api + "|" + v.vod_id,
        vod_name: `[${site.name}] ` + v.vod_name,
        vod_pic: fixPic(v.vod_pic)
      })));
    }
  }));

  return { list };
}

// ===== 详情 =====
async function detail(params) {
  const [api, id] = params.id.split("|");

  const data = await request(api, {
    ac: "detail",
    ids: id
  });

  if (!data.list || !data.list[0]) return { list: [] };

  const v = data.list[0];

  return {
    list: [{
      vod_id: id,
      vod_name: v.vod_name,
      vod_pic: fixPic(v.vod_pic),
      vod_content: v.vod_content,
      vod_play_from: v.vod_play_from,
      vod_play_url: v.vod_play_url
    }]
  };
}

// ===== 播放（关键修复）=====
async function play(params) {
  let url = params.id;

  // 直链直接播
  if (url.includes(".m3u8") || url.includes(".mp4")) {
    return { parse: 0, url };
  }

  // 其余走解析
  return {
    parse: 1,
    url
  };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
