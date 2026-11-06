/*
 * 考级子系统 · 门类评分维度「提升建议文案」共享数据层（原型版）
 *
 * 用途：
 *   1) 后台「配置 - 评分维度配置」按门类维护每个维度的提升建议文案；
 *   2) 考生端「成绩详情 - 成绩分析与建议」对被标记「可重点提升」的维度，
 *      直接引用该维度配置的建议文案（未配置时回落到系统默认话术）。
 *
 * 原型说明：数据保存在 localStorage，正式环境应改为服务端接口，例如
 *   GET  /exam-rubrics/{categoryCode}/dimensions
 *   PUT  /exam-rubrics/{categoryCode}/dimensions
 * 维度以 code（DIM-xxx）作为跨端唯一标识，名称仅作展示与兜底匹配。
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "hbyx_exam_score_dimension_advice_v1";
  var SEED_FLAG = "hbyx_exam_score_dimension_advice_seeded_v1";

  /* 默认文案：与后台门类评分维度的编码一一对应，可按门类在后台逐条修改。 */
  var DEFAULT_DIMENSIONS = {
    MUSIC: [
      { code: "DIM-MUSIC-01", name: "音阶/琶音", advice: "每天用节拍器分调练习音阶与琶音，先慢速保证指法与连贯，再逐步提速，重点打磨转指和音色均匀。" },
      { code: "DIM-MUSIC-02", name: "读谱", advice: "练习前先完整读谱，标记调号、临时记号与分句，再用慢速视奏巩固识谱准确度，减少停顿与错音。" },
      { code: "DIM-MUSIC-03", name: "节奏感", advice: "用节拍器从慢速开始稳定基本拍，再逐步提速，重点打磨附点、切分等复杂节奏的准确性与律动感。" },
      { code: "DIM-MUSIC-04", name: "音乐感", advice: "加强对作品背景与情绪的理解，练习乐句的呼吸、力度层次和音色变化，多做完整演奏并录音回听。" },
      { code: "DIM-MUSIC-05", name: "演奏或演唱方法", advice: "回到基础方法练习，重点校正手型、发力与呼吸方式，每次练习先做 5-10 分钟基本功再进入曲目。" },
      { code: "DIM-MUSIC-06", name: "完整性", advice: "把曲目拆成段落逐段练熟，再按考试要求完整连奏，重点解决卡顿、忘谱和段落衔接问题。" },
      { code: "DIM-MUSIC-07", name: "音准（弦乐，声乐）", advice: "用慢速长音与音阶练习稳定音高，配合校音器逐音校对，重点打磨音程关系与换把、换声区的准确性。" },
      { code: "DIM-MUSIC-08", name: "和弦（电子琴）", advice: "先练常用和弦原位与转位指法，再练和弦连接，重点保证转换准确、节奏稳定和伴奏层次清晰。" },
      { code: "DIM-MUSIC-09", name: "风箱运用（手风琴）", advice: "单独练习风箱开合与换向，保持气息平稳连贯，再结合乐句做力度变化，避免换向时断音或重音。" }
    ],
    DANCE: [
      { code: "DIM-DANCE-01", name: "基本体态", advice: "按教材把动作拆成小节逐段练习，重点校正发力顺序与到位幅度，训练时录像回看并对照示范逐项纠错。" },
      { code: "DIM-DANCE-02", name: "技术技巧", advice: "先放慢速度把动作与节奏对齐，再逐步提速，重点打磨动作衔接的准确性与力度层次。" },
      { code: "DIM-DANCE-03", name: "仪表气质", advice: "加强完整片段演练，注意眼神、表情与身体姿态的配合，请指导教师从舞台呈现角度逐项点评。" },
      { code: "DIM-DANCE-04", name: "风格把握", advice: "多观摩同舞种优秀示范，拆解动作韵律与呼吸方式，练习时对照风格特点逐段校正。" },
      { code: "DIM-DANCE-05", name: "音乐节奏", advice: "先听熟音乐、数清拍点再合乐，用慢速练习保证动作与重拍对齐，逐步提升与音乐的协调性。" }
    ],
    FINE_ARTS: [
      { code: "DIM-VISUAL-01", name: "造型基础", advice: "加强构图与比例练习，先用辅助线确定大形再深入细节，坚持速写与临摹交替训练。" },
      { code: "DIM-VISUAL-02", name: "表现技法", advice: "针对薄弱技法做单项练习，熟悉材料特性与用笔顺序，注意画面层次与干湿、浓淡控制。" },
      { code: "DIM-VISUAL-03", name: "画面表现", advice: "加强色彩关系与明暗层次的训练，多画小色稿确定基调，再完整深入，提升画面的整体感染力。" },
      { code: "DIM-VISUAL-04", name: "作品完整度", advice: "练习时先规划作画步骤与时间分配，保证起稿、深入、调整三个阶段完整走完，避免画面半途而废。" }
    ],
    RECITATION: [
      { code: "DIM-LANGUAGE-01", name: "普通话", advice: "每天做 10 分钟吐字归音练习，重点校正平翘舌、前后鼻音，跟读标准音频逐字比对。" },
      { code: "DIM-LANGUAGE-02", name: "表演技巧", advice: "加强作品分析与角色体验，练习眼神、手势与语气变化，多做完整片段演练并录像回看。" },
      { code: "DIM-LANGUAGE-03", name: "仪表气质", advice: "注意上台站姿、目光与表情管理，完整走台演练并请指导教师点评台风与整体呈现。" },
      { code: "DIM-LANGUAGE-04", name: "风格把握", advice: "多听读同体裁优秀范本，分析语言节奏与情感基调，练习时按作品风格调整语气与停连。" },
      { code: "DIM-LANGUAGE-05", name: "语言流畅性", advice: "先熟背稿件再练表达，重点解决卡顿、重复和语速不均，练习时用录音回听并标记需要改进的句子。" }
    ]
  };

  function cloneDefaults() {
    var copy = {};
    Object.keys(DEFAULT_DIMENSIONS).forEach(function (categoryCode) {
      copy[categoryCode] = DEFAULT_DIMENSIONS[categoryCode].map(function (item) {
        return { code: item.code, name: item.name, advice: item.advice };
      });
    });
    return copy;
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(store) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      /* 隐私模式等场景下写入失败时，保持内存态可用 */
    }
  }

  function ensureStore() {
    var store = readStore();
    if (store) return store;
    store = {};
    if (!global.localStorage.getItem(SEED_FLAG)) {
      store = cloneDefaults();
      writeStore(store);
      try { global.localStorage.setItem(SEED_FLAG, "1"); } catch (error) {}
    }
    return store;
  }

  /* 合并默认文案与已保存文案：保存值优先，默认值补齐。 */
  function dimensionsOf(categoryCode) {
    var options = DEFAULT_DIMENSIONS[categoryCode] || [];
    var store = ensureStore();
    var saved = Array.isArray(store[categoryCode]) ? store[categoryCode] : [];
    var byCode = {};
    saved.forEach(function (item) {
      if (item && item.code) byCode[item.code] = item;
    });
    var merged = options.map(function (option) {
      var hit = byCode[option.code] || {};
      return {
        code: option.code,
        name: hit.name || option.name,
        advice: typeof hit.advice === "string" && hit.advice !== "" ? hit.advice : option.advice
      };
    });
    /* 保存过但不属于默认列表的维度（如后台新增的维度）一并保留 */
    saved.forEach(function (item) {
      if (!item || !item.code) return;
      var exists = merged.some(function (entry) { return entry.code === item.code; });
      if (!exists) merged.push({ code: item.code, name: item.name || item.code, advice: item.advice || "" });
    });
    return merged;
  }

  function saveCategory(categoryCode, dimensions) {
    if (!categoryCode) return;
    var store = ensureStore();
    store[categoryCode] = (dimensions || []).map(function (item) {
      return {
        code: String(item.code || "").trim(),
        name: String(item.name || "").trim(),
        advice: String(item.advice || "").trim()
      };
    }).filter(function (item) { return item.code; });
    writeStore(store);
  }

  /* 按编码优先、名称兜底匹配，供考生端成绩详情取用。 */
  function adviceFor(code, name, categoryCode) {
    var store = ensureStore();
    var categories = categoryCode ? [categoryCode] : Object.keys(DEFAULT_DIMENSIONS).concat(Object.keys(store));
    var seen = {};
    var matched = "";
    categories.forEach(function (key) {
      if (seen[key]) return;
      seen[key] = true;
      var list = Array.isArray(store[key]) ? store[key] : [];
      list.forEach(function (item) {
        if (matched || !item) return;
        if (code && item.code === code && item.advice) matched = item.advice;
      });
      if (matched) return;
      var defaults = DEFAULT_DIMENSIONS[key] || [];
      defaults.forEach(function (item) {
        if (matched || !item) return;
        if (code && item.code === code && item.advice) matched = item.advice;
      });
    });
    if (matched) return matched;
    /* 编码对不上时按维度名称匹配（跨门类维度名称存在复用） */
    if (name) {
      Object.keys(DEFAULT_DIMENSIONS).forEach(function (key) {
        (DEFAULT_DIMENSIONS[key] || []).forEach(function (item) {
          if (matched) return;
          if (item.name === name && item.advice) matched = item.advice;
        });
      });
    }
    return matched;
  }

  global.HBYXScoreDimensionAdvice = {
    STORAGE_KEY: STORAGE_KEY,
    defaults: function () { return cloneDefaults(); },
    dimensionsOf: dimensionsOf,
    saveCategory: saveCategory,
    adviceFor: adviceFor,
    reset: function () {
      try {
        global.localStorage.removeItem(STORAGE_KEY);
        global.localStorage.removeItem(SEED_FLAG);
      } catch (error) {}
      return cloneDefaults();
    }
  };
})(window);
