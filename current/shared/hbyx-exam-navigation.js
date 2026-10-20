(function (global) {
  "use strict";

  var storageKey = "hbyx_exam_navigation_v1";

  function getLearningVisible() {
    try {
      var settings = JSON.parse(global.localStorage.getItem(storageKey) || "null");
      return !settings || settings.learningVisible !== false;
    } catch (error) {
      return true;
    }
  }

  function setLearningVisible(visible) {
    if (typeof visible !== "boolean") throw new TypeError("Learning visibility must be a boolean");
    global.localStorage.setItem(storageKey, JSON.stringify({ learningVisible: visible }));
  }

  global.HBYXExamNavigation = {
    storageKey: storageKey,
    getLearningVisible: getLearningVisible,
    setLearningVisible: setLearningVisible
  };
})(window);
