// @name 推送脚本（115离线增强版）
// @push 1
// @author lampon
// @description 支持115磁链离线播放
// @version 2.0.0

const OmniBox = require("omnibox_sdk");

// 判断磁链
function isMagnet(url) {
  return url && url.startsWith("magnet:");
}

// 延迟
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 磁链 → 115
async function resolveMagnet(shareURL) {
  const cache = await OmniBox.getCache(shareURL);
  if (cache && cache.shareURL) {
    OmniBox.log("info", "命中缓存");
    return cache.shareURL;
  }

  const task = await OmniBox.addOfflineTask({
    magnet: shareURL,
    type: "115"
  });

  if (!task?.taskId) {
    throw new Error("离线失败");
  }

  let fileId = null;

  for (let i = 0; i < 30; i++) {
    await sleep(2000);

    const status = await OmniBox.getOfflineTask(task.taskId);
    if (status?.status === "finished") {
      fileId = status.fileId;
      break;
    }
  }

  if (!fileId) {
    throw new Error("离线未完成");
  }

  const newShareURL = `115://${fileId}`;

  await OmniBox.setCache(shareURL, {
    shareURL: newShareURL,
    time: Date.now()
  });

  return newShareURL;
}

async function detail(params) {
  try {
    const videoId = params.videoId;
    if (!videoId) throw new Error("videoId不能为空");

    const [rawURL, keyword, note] = videoId.split("|");
    let shareURL = rawURL;

    // 磁链处理
    if (isMagnet(shareURL)) {
      shareURL = await resolveMagnet(shareURL);
    }

    const fileList = await OmniBox.getDriveFileList(shareURL, "0");

    if (!fileList?.files?.length) {
      throw new Error("无文件");
    }

    const videos = fileList.files.filter(f => f.file);

    const episodes = videos.map(f => ({
      name: f.file_name,
      playId: `${shareURL}|${f.fid}`,
      size: f.size
    }));

    return {
      list: [{
        vod_id: videoId,
        vod_name: note || keyword || "115资源",
        vod_play_sources: [{
          name: "直连",
          episodes
        }]
      }]
    };

  } catch (e) {
    OmniBox.log("error", e.message);
    return { list: [] };
  }
}

async function play(params) {
  try {
    const playId = params.playId;
    if (!playId) throw new Error("playId为空");

    const [rawURL, fileId] = playId.split("|");
    let shareURL = rawURL;

    // 磁链恢复
    if (isMagnet(rawURL)) {
      const cache = await OmniBox.getCache(rawURL);
      if (!cache) throw new Error("未离线");

      shareURL = cache.shareURL;
    }

    const playInfo = await OmniBox.getDriveVideoPlayInfo(
      shareURL,
      fileId,
      params.flag
    );

    return {
      urls: playInfo.url.map(u => ({
        name: u.name,
        url: u.url
      })),
      header: playInfo.header || {},
      parse: 0
    };

  } catch (e) {
    OmniBox.log("error", e.message);
    return { urls: [], header: {}, parse: 0 };
  }
}

module.exports = { detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
