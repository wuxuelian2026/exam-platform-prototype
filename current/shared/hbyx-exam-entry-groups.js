(function (global) {
  "use strict";

  function display(record, subject) {
    record = record || {};
    var online = record.online || record.mode === "online" || record.examMode === "在线考试" || record.examMode === "线上考试";
    var dance = record.categoryCode === "DANCE" || ["中国舞", "国际标准舞", "芭蕾舞"].indexOf(subject || record.subject) > -1;
    if (online || !dance) return { visible: false, text: "" };
    var group = record.entryGroup;
    if (!group || !String(group.name || "").trim()) return { visible: true, text: "待分组" };
    var text = String(group.name).trim();
    if (Number.isInteger(group.memberOrder) && group.memberOrder > 0) text += " · 组内序号 " + String(group.memberOrder).padStart(2, "0");
    if (Number.isInteger(group.memberCount) && group.memberCount > 0) text += " · 共 " + group.memberCount + " 人";
    return { visible: true, text: text };
  }

  global.HBYXExamEntryGroups = { display: display };
})(window);
