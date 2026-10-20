(function (global) {
  "use strict";

  var storageKey = "hbyx_exam_navigation_v1";

  function readSettings() {
    try {
      var settings = JSON.parse(global.localStorage.getItem(storageKey) || "null");
      return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    } catch (error) {
      return {};
    }
  }

  function setVisibility(key, visible) {
    if (typeof visible !== "boolean") throw new TypeError("Navigation visibility must be a boolean");
    var settings = readSettings();
    settings[key] = visible;
    global.localStorage.setItem(storageKey, JSON.stringify(settings));
  }

  global.HBYXExamNavigation = {
    storageKey: storageKey,
    getLearningVisible: function () { return readSettings().learningVisible !== false; },
    setLearningVisible: function (visible) { setVisibility("learningVisible", visible); },
    getTrainingVisible: function () { return readSettings().trainingVisible !== false; },
    setTrainingVisible: function (visible) { setVisibility("trainingVisible", visible); }
  };
})(window);
