const OmniBox = require("omnibox_sdk");

// ====== 你的CMS源（已提取）======
const CMS_SITES = [
  { name: "滴滴", api: "https://api.ddapi.cc/api.php/provide/vod" },
  { name: "鸡坤", api: "https://jkunzyapi.com/api.php/provide/vod" },
  { name: "TG资源", api: "https://tgzyz.pp.ua/api.php/provide/vod" },
  { name: "越南", api: "https://vnzyz.com/api.php/provide/vod" },
  { name: "奥斯卡", api: "https://aosikazy4.com/api.php/provide/vod" },
  { name: "X细胞", api: "https://www.xxibaozyw.com/api.php/provide/vod" },
  { name: "大奶子", api: "https://apidanaizi.com/api.php/provide/vod" },
  { name: "精品X", api: "https://www.jingpinx.com/api.php/provide/vod" },
  { name: "老色p", api: "https://apilsbzy1.com/api.php/provide/vod" },
  { name: "番号", api: "http://fhapi9.com/api.php/provide/vod" }
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

// ===== 首页（多源聚合）=====
async function home() {
  let allVideos = [];

  for (const site of CMS_SITES) {
    try {
      const data = await request(site.api, { ac: "list", pg: 1 });
      if (data.list) {
        const list = data.list.slice(0, 5).map(v => ({
          vod_id: site.api + "|" + v.vod_id,
          vod_name: `[${site.name}] ` + v.vod_name,
          vod_pic: v.vod_pic,
          vod_remarks: v.vod_remarks
        }));
        allVideos.push(...list);
      }
    } catch {}
  }

  return {
    class: [
      { type_id: "all", type_name: "🔥全部" }
    ],
    list: allVideos
  };
}

// ===== 分类（单源，避免炸）=====
async function category(params) {
  const [api, typeId] = params.categoryId.split("|");

  const data = await request(api, {
    ac: "videolist",
    t: typeId,
    pg: params.page || 1
  });

  return {
    list: (data.list || []).map(v => ({
      vod_id: api + "|" + v.vod_id,
      vod_name: v.vod_name,
      vod_pic: v.vod_pic,
      vod_remarks: v.vod_remarks
    }))
  };
}

// ===== 搜索（全源并发）=====
async function search(params) {
  const wd = params.wd;
  let results = [];

  await Promise.all(
    CMS_SITES.map(async (site) => {
      try {
        const data = await request(site.api, {
          ac: "list",
          wd,
          pg: 1
        });

        if (data.list) {
          const list = data.list.map(v => ({
            vod_id: site.api + "|" + v.vod_id,
            vod_name: `[${site.name}] ` + v.vod_name,
            vod_pic: v.vod_pic
          }));
          results.push(...list);
        }
      } catch {}
    })
  );

  return { list: results };
}

// ===== 详情 =====
async function detail(params) {
  const [api, id] = params.id.split("|");

  const data = await request(api, {
    ac: "detail",
    ids: id
  });

  return {
    list: data.list || []
  };
}

// ===== 播放 =====
async function play(params) {
  return {
    parse: 0,
    url: params.id
  };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
