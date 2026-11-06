/*!
 * 考级子系统 · 评语库共享数据层（原型）
 * 后台「业务配置 → 评语库」维护，考官端评分页按考生报考专业读取。
 * 生产环境应改为服务端接口：GET/POST/PUT/DELETE /exam-comment-library
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "hbyx_exam_comment_library_v1";
  var SEED_FLAG = "hbyx_exam_comment_library_seeded_v1";

  /* 专业三级目录：门类 → 分类 → 专业（与后台基础专业目录保持一致） */
  var CATALOG = [{"code":"01","categoryCode":"MUSIC","name":"音乐类","groups":[{"code":"01-01","name":"基础知识","subjects":[{"code":"01001","name":"音乐基础知识"}]},{"code":"01-02","name":"键盘乐器","subjects":[{"code":"01002","name":"钢琴"},{"code":"01003","name":"手风琴"},{"code":"01004","name":"电子琴（单、双排键）"},{"code":"01005","name":"双排键"},{"code":"01006","name":"数码钢琴"}]},{"code":"01-03","name":"西洋管乐","subjects":[{"code":"01007","name":"长笛"},{"code":"01008","name":"双簧管"},{"code":"01009","name":"单簧管"},{"code":"01010","name":"大管（巴松管）"},{"code":"01011","name":"萨克斯管"},{"code":"01012","name":"圆号"},{"code":"01013","name":"小号"},{"code":"01014","name":"次中音号（上低音号）"},{"code":"01015","name":"长号"},{"code":"01016","name":"大号"}]},{"code":"01-04","name":"西洋弦乐","subjects":[{"code":"01017","name":"小提琴"},{"code":"01018","name":"中提琴"},{"code":"01019","name":"大提琴"},{"code":"01020","name":"低音提琴"},{"code":"01021","name":"竖琴"}]},{"code":"01-05","name":"打击乐器","subjects":[{"code":"01022","name":"小军鼓"},{"code":"01023","name":"定音鼓及打击乐器"},{"code":"01024","name":"木琴及马林巴琴"}]},{"code":"01-06","name":"民族管乐","subjects":[{"code":"01025","name":"竹笛"},{"code":"01026","name":"笙"},{"code":"01027","name":"唢呐"},{"code":"01028","name":"管子"},{"code":"01029","name":"巴乌"},{"code":"01030","name":"葫芦丝"},{"code":"01031","name":"陶笛"},{"code":"01032","name":"埙"},{"code":"01033","name":"箫"}]},{"code":"01-07","name":"民族拉弦乐器","subjects":[{"code":"01034","name":"二胡"},{"code":"01035","name":"板胡"},{"code":"01036","name":"高胡"},{"code":"01037","name":"京胡"},{"code":"01038","name":"革胡"},{"code":"01039","name":"低音革胡"}]},{"code":"01-08","name":"民族弹拨乐器","subjects":[{"code":"01040","name":"琵琶"},{"code":"01041","name":"古筝"},{"code":"01042","name":"三弦"},{"code":"01043","name":"古琴"},{"code":"01044","name":"扬琴"},{"code":"01045","name":"柳琴"}]},{"code":"01-09","name":"吉他与电声乐器","subjects":[{"code":"01055","name":"民谣吉他"},{"code":"01056","name":"夏威夷吉他"},{"code":"01057","name":"电吉他"},{"code":"01058","name":"电贝司"},{"code":"01059","name":"爵士鼓"},{"code":"01060","name":"电爵士鼓"},{"code":"01061","name":"架子鼓"}]},{"code":"01-10","name":"口琴类","subjects":[{"code":"01062","name":"口琴"},{"code":"01063","name":"复音口琴"}]},{"code":"01-11","name":"声乐","subjects":[{"code":"01064","name":"声乐（民族）"},{"code":"01065","name":"声乐（通俗）"},{"code":"01066","name":"少儿歌唱"}]},{"code":"01-12","name":"古典与民谣吉他","subjects":[{"code":"01067","name":"古典吉他"},{"code":"01068","name":"民谣吉他"}]}]},{"code":"02","categoryCode":"DANCE","name":"舞蹈类","groups":[{"code":"02-01","name":"舞蹈类","subjects":[{"code":"02001","name":"中国舞"},{"code":"02002","name":"国际标准舞"},{"code":"02003","name":"芭蕾舞"}]}]},{"code":"03","categoryCode":"FINE_ARTS","name":"美术类","groups":[{"code":"03-01","name":"中国画","subjects":[{"code":"03001","name":"人物"},{"code":"03002","name":"山水"},{"code":"03003","name":"花鸟"}]},{"code":"03-02","name":"绘画","subjects":[{"code":"03004","name":"素描"},{"code":"03005","name":"速写"},{"code":"03006","name":"水粉画"},{"code":"03007","name":"水彩画"},{"code":"03008","name":"儿童画"},{"code":"03009","name":"漫画"}]},{"code":"03-03","name":"书法","subjects":[{"code":"03010","name":"软笔书法"},{"code":"03011","name":"硬笔书法"}]}]},{"code":"05","categoryCode":"RECITATION","name":"朗诵类","groups":[{"code":"05-01","name":"朗诵","subjects":[{"code":"05001","name":"朗诵"}]}]}];

  var SEED = [
    {
      id: "CL-20260820-001",
      content: "演奏完整流畅，基本功扎实，音准与节奏稳定。乐句处理自然，强弱对比清晰，音乐表现力较好。建议继续加强慢速练习，注意乐句呼吸与收句处理。",
      scopeLevel: "subject",
      categoryCode: "MUSIC", categoryName: "音乐类",
      groupCode: "01-02", groupName: "键盘乐器",
      subjectCode: "01002", subjectName: "钢琴",
      updatedBy: "平台运营 · 张岚", updatedAt: "2026-08-20 10:12", createdAt: "2026-08-20 10:12"
    },
    {
      id: "CL-20260820-002",
      content: "技术完成度较高，快速乐段清晰度好，舞台状态稳定。中段速度略有波动，建议配合节拍器训练，保持全曲速度统一。",
      scopeLevel: "subject",
      categoryCode: "MUSIC", categoryName: "音乐类",
      groupCode: "01-02", groupName: "键盘乐器",
      subjectCode: "01002", subjectName: "钢琴",
      updatedBy: "平台运营 · 张岚", updatedAt: "2026-08-20 10:18", createdAt: "2026-08-20 10:18"
    },
    {
      id: "CL-20260821-003",
      content: "键盘乐器基本功扎实，手指独立性与力度控制良好，触键层次清晰，踏板使用得当。建议进一步打磨音色变化，加强不同风格作品的触键区分。",
      scopeLevel: "group",
      categoryCode: "MUSIC", categoryName: "音乐类",
      groupCode: "01-02", groupName: "键盘乐器",
      subjectCode: "", subjectName: "",
      updatedBy: "平台运营 · 李昂", updatedAt: "2026-08-21 09:30", createdAt: "2026-08-21 09:30"
    },
    {
      id: "CL-20260821-004",
      content: "整体表现符合本级水平要求，作品完成度较好，舞台礼仪规范。建议在日常练习中加强基础训练与完整演奏（演唱）的连贯性，积累舞台实践经验。",
      scopeLevel: "category",
      categoryCode: "MUSIC", categoryName: "音乐类",
      groupCode: "", groupName: "",
      subjectCode: "", subjectName: "",
      updatedBy: "平台运营 · 李昂", updatedAt: "2026-08-21 09:42", createdAt: "2026-08-21 09:42"
    },
    {
      id: "CL-20260821-005",
      content: "音乐感知与表现意识较好，对作品风格把握基本准确。个别段落熟练度不足，建议加强难点段落的分解练习，提高全曲完整度。",
      scopeLevel: "category",
      categoryCode: "MUSIC", categoryName: "音乐类",
      groupCode: "", groupName: "",
      subjectCode: "", subjectName: "",
      updatedBy: "平台运营 · 李昂", updatedAt: "2026-08-21 09:48", createdAt: "2026-08-21 09:48"
    },
    {
      id: "CL-20260822-006",
      content: "身体条件与软开度较好，动作规范，节奏与音乐配合自然，舞台表现大方。建议加强重心控制与动作延伸，注意动作之间的连贯与呼吸。",
      scopeLevel: "subject",
      categoryCode: "DANCE", categoryName: "舞蹈类",
      groupCode: "02-01", groupName: "舞蹈类",
      subjectCode: "02001", subjectName: "中国舞",
      updatedBy: "平台运营 · 周敏", updatedAt: "2026-08-22 14:05", createdAt: "2026-08-22 14:05"
    },
    {
      id: "CL-20260822-007",
      content: "舞蹈基本功扎实，动作完成质量较好，风格韵律把握基本准确。建议加强体态控制与情绪表达，提升整体舞台感染力。",
      scopeLevel: "category",
      categoryCode: "DANCE", categoryName: "舞蹈类",
      groupCode: "", groupName: "",
      subjectCode: "", subjectName: "",
      updatedBy: "平台运营 · 周敏", updatedAt: "2026-08-22 14:10", createdAt: "2026-08-22 14:10"
    },
    {
      id: "CL-20260823-008",
      content: "造型基础扎实，构图完整，画面层次分明，色彩关系较为协调。建议在细节刻画与整体关系处理上进一步提升，注意画面主次的取舍。",
      scopeLevel: "category",
      categoryCode: "FINE_ARTS", categoryName: "美术类",
      groupCode: "", groupName: "",
      subjectCode: "", subjectName: "",
      updatedBy: "平台运营 · 陈曦", updatedAt: "2026-08-23 11:20", createdAt: "2026-08-23 11:20"
    },
    {
      id: "CL-20260823-009",
      content: "普通话发音准确，吐字清晰，语言流畅自然，情感表达真挚。建议加强停连与重音处理，注意作品基调的统一，增强感染力。",
      scopeLevel: "subject",
      categoryCode: "RECITATION", categoryName: "朗诵类",
      groupCode: "05-01", groupName: "朗诵",
      subjectCode: "05001", subjectName: "朗诵",
      updatedBy: "平台运营 · 陈曦", updatedAt: "2026-08-23 11:26", createdAt: "2026-08-23 11:26"
    }
  ];

  var SCOPE_LABEL = { category: "门类", group: "分类", subject: "专业" };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function pad(value, size) {
    var text = String(value);
    while (text.length < size) text = "0" + text;
    return text;
  }

  function nowText() {
    var date = new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2) +
      " " + pad(date.getHours(), 2) + ":" + pad(date.getMinutes(), 2);
  }

  function readRaw() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeRaw(items) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (err) { /* 忽略存储异常 */ }
    return items;
  }

  function ensureSeed() {
    var seeded = false;
    try { seeded = global.localStorage.getItem(SEED_FLAG) === "1"; } catch (err) { seeded = false; }
    var existing = readRaw();
    if (!seeded && (!existing || !existing.length)) {
      writeRaw(clone(SEED));
      try { global.localStorage.setItem(SEED_FLAG, "1"); } catch (err2) { /* 忽略 */ }
      return true;
    }
    return false;
  }

  function list() {
    ensureSeed();
    return readRaw() || [];
  }

  function find(id) {
    var found = null;
    list().forEach(function (item) { if (item.id === id) found = item; });
    return found;
  }

  function nextId(items) {
    var date = new Date();
    var stamp = "" + date.getFullYear() + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2);
    var index = items.filter(function (item) { return String(item.id || "").indexOf("CL-" + stamp) === 0; }).length + 1;
    var id = "CL-" + stamp + "-" + pad(index, 3);
    while (items.some(function (item) { return item.id === id; })) {
      index += 1;
      id = "CL-" + stamp + "-" + pad(index, 3);
    }
    return id;
  }

  function normalize(entry) {
    entry = entry || {};
    var level = SCOPE_LABEL[entry.scopeLevel] ? entry.scopeLevel : "category";
    return {
      id: entry.id || "",
      content: String(entry.content || "").replace(/\s+$/, "").trim(),
      scopeLevel: level,
      categoryCode: entry.categoryCode || "",
      categoryName: entry.categoryName || "",
      groupCode: level === "category" ? "" : (entry.groupCode || ""),
      groupName: level === "category" ? "" : (entry.groupName || ""),
      subjectCode: level === "subject" ? (entry.subjectCode || "") : "",
      subjectName: level === "subject" ? (entry.subjectName || "") : "",
      updatedBy: entry.updatedBy || "平台运营",
      updatedAt: entry.updatedAt || nowText(),
      createdAt: entry.createdAt || entry.updatedAt || nowText()
    };
  }

  function save(entry) {
    var items = list().slice();
    var record = normalize(entry);
    if (!record.id) record.id = nextId(items);
    var index = -1;
    items.forEach(function (item, i) { if (item.id === record.id) index = i; });
    if (index > -1) {
      record.createdAt = items[index].createdAt || record.createdAt;
      items[index] = record;
    } else {
      items.unshift(record);
    }
    writeRaw(items);
    return record;
  }

  function remove(id) {
    writeRaw(list().filter(function (item) { return item.id !== id; }));
    return true;
  }

  function categories() {
    return CATALOG.map(function (category) {
      return { code: category.code, categoryCode: category.categoryCode, name: category.name };
    });
  }

  function categoryByCode(categoryCode) {
    var found = null;
    CATALOG.forEach(function (category) {
      if (category.categoryCode === categoryCode || category.code === categoryCode) found = category;
    });
    return found;
  }

  function categoryByName(name) {
    var found = null;
    CATALOG.forEach(function (category) { if (category.name === name) found = category; });
    return found;
  }

  function groupsOf(categoryCode) {
    var category = categoryByCode(categoryCode);
    if (!category) return [];
    return (category.groups || []).map(function (group) { return { code: group.code, name: group.name }; });
  }

  function subjectsOf(categoryCode, groupCode) {
    var category = categoryByCode(categoryCode);
    if (!category) return [];
    var result = [];
    (category.groups || []).forEach(function (group) {
      if (groupCode && group.code !== groupCode) return;
      (group.subjects || []).forEach(function (subject) {
        result.push({ code: subject.code, name: subject.name, groupCode: group.code, groupName: group.name });
      });
    });
    return result;
  }

  function resolveSubject(subjectName) {
    if (!subjectName) return null;
    var found = null;
    CATALOG.forEach(function (category) {
      (category.groups || []).forEach(function (group) {
        (group.subjects || []).forEach(function (subject) {
          if (!found && subject.name === subjectName) found = { category: category, group: group, subject: subject };
        });
      });
    });
    return found;
  }

  function scopeLevelLabel(level) { return SCOPE_LABEL[level] || "门类"; }

  function scopeName(entry) {
    if (!entry) return "";
    if (entry.scopeLevel === "subject") return entry.subjectName || "";
    if (entry.scopeLevel === "group") return entry.groupName || "";
    return entry.categoryName || "";
  }

  function scopeLabel(entry) { return scopeLevelLabel(entry && entry.scopeLevel) + " · " + scopeName(entry); }

  function scopePath(entry) {
    if (!entry) return "";
    if (entry.scopeLevel === "subject") return [entry.categoryName, entry.groupName, entry.subjectName].filter(Boolean).join(" / ");
    if (entry.scopeLevel === "group") return [entry.categoryName, entry.groupName].filter(Boolean).join(" / ");
    return entry.categoryName || "";
  }

  /* 按考生报考专业取可用评语：本专业 → 本分类 → 本门类 */
  function matchForCandidate(candidate) {
    candidate = candidate || {};
    var resolved = resolveSubject(candidate.subject);
    var categoryCode = (resolved && resolved.category.categoryCode) || candidate.categoryCode || "";
    var categoryName = (resolved && resolved.category.name) || candidate.categoryName || "";
    var groupName = resolved ? resolved.group.name : (candidate.groupName || "");
    var subjectName = resolved ? resolved.subject.name : (candidate.subject || "");
    var rows = [];
    list().forEach(function (entry) {
      var rank = -1;
      if (entry.scopeLevel === "subject" && subjectName && entry.subjectName === subjectName) rank = 0;
      else if (entry.scopeLevel === "group" && groupName && entry.groupName === groupName && (!categoryCode || entry.categoryCode === categoryCode)) rank = 1;
      else if (entry.scopeLevel === "category" && categoryCode && entry.categoryCode === categoryCode) rank = 2;
      if (rank < 0) return;
      rows.push({
        id: entry.id,
        content: entry.content,
        scopeLevel: entry.scopeLevel,
        scopeLabel: scopeLabel(entry),
        scopePath: scopePath(entry),
        scopeRank: rank,
        updatedBy: entry.updatedBy,
        updatedAt: entry.updatedAt
      });
    });
    rows.sort(function (a, b) {
      return a.scopeRank - b.scopeRank || String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    return {
      rows: rows,
      context: { categoryCode: categoryCode, categoryName: categoryName, groupName: groupName, subjectName: subjectName }
    };
  }

  global.HBYXCommentLibrary = {
    STORAGE_KEY: STORAGE_KEY,
    CATALOG: CATALOG,
    categories: categories,
    categoryByCode: categoryByCode,
    categoryByName: categoryByName,
    groupsOf: groupsOf,
    subjectsOf: subjectsOf,
    resolveSubject: resolveSubject,
    list: list,
    find: find,
    save: save,
    remove: remove,
    ensureSeed: ensureSeed,
    scopeLevelLabel: scopeLevelLabel,
    scopeName: scopeName,
    scopeLabel: scopeLabel,
    scopePath: scopePath,
    matchForCandidate: matchForCandidate
  };
})(window);
