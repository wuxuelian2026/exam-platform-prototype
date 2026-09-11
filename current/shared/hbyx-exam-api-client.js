(function (global, document) {
  "use strict";

  var CONTRACT_KEY = "hbyx_exam_contract_v1";
  var COLLECTION_KEYS = {
    brochures: "brochureId",
    batches: "batchId",
    applications: "applicationId",
    schedules: "scheduleId",
    tickets: "ticketId",
    scoreTasks: "scoreTaskId",
    scores: "scoreId",
    certificates: "certificateId"
  };
  var API_BASE = String(global.HBYX_EXAM_API_BASE_URL || "").replace(/\/$/, "");
  var REQUEST_TIMEOUT = Number(global.HBYX_EXAM_API_TIMEOUT || 12000);
  var mock = !API_BASE;
  var mockRequests = Object.create(null);
  var listeners = [];
  var snapshot = emptyContract();
  var channel = typeof global.BroadcastChannel === "function" ? new global.BroadcastChannel("hbyx_exam_api_v1") : null;

  function emptyContract() {
    return {
      schemaVersion: "1.0",
      updatedAt: "",
      source: mock ? "prototype-api-mock" : "api",
      brochures: [],
      batches: [],
      applications: [],
      schedules: [],
      tickets: [],
      scoreTasks: [],
      scores: [],
      certificates: [],
      events: []
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function compactDateTimeToMs(date, time) {
    var dateText = String(date || "");
    var timeText = String(time || "");
    if (!/^\d{8}$/.test(dateText) || !/^\d{6}$/.test(timeText)) return NaN;
    return Date.parse(dateText.slice(0, 4) + "-" + dateText.slice(4, 6) + "-" + dateText.slice(6, 8) + "T" + timeText.slice(0, 2) + ":" + timeText.slice(2, 4) + ":" + timeText.slice(4, 6) + "+08:00");
  }

  function businessDateTimeParts(date) {
    var formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    var fields = {};
    formatter.formatToParts(date || new Date()).forEach(function (part) {
      if (part.type !== "literal") fields[part.type] = part.value;
    });
    return fields;
  }

  function mockBusinessClock() {
    var fields = businessDateTimeParts(new Date());
    return {
      serverDate: fields.year + fields.month + fields.day,
      serverTime: fields.hour + fields.minute + fields.second
    };
  }

  function mockDeadlineError(code, message, requestId) {
    var error = new Error(message);
    error.status = 422;
    error.code = code;
    error.requestId = requestId;
    error.retryable = false;
    return error;
  }

  function expireMockApplications() {
    if (!mock) return;
    var now = Date.now();
    (snapshot.applications || []).forEach(function (item) {
      var deadline = compactDateTimeToMs(item.registrationEndDate, item.registrationEndTime);
      if (!Number.isFinite(deadline) && item.registrationEndAt) deadline = Date.parse(item.registrationEndAt);
      if (!Number.isFinite(deadline) || now < deadline) return;
      if (item.registrationStatusCode === "PENDING_PAYMENT" && item.collectionStatusCode === "UNPAID") {
        item.registrationStatusCode = "CANCELLED";
        item.registrationStatusLabel = "已取消";
        item.collectionStatusCode = "EXPIRED";
        item.collectionStatusLabel = "已过期";
        item.refundStatusCode = item.refundStatusCode || "NONE";
        item.deadlineCloseReason = "REGISTRATION_DEADLINE";
        item.deadlineClosedAt = new Date().toISOString();
        item.objectVersion = Number(item.objectVersion || item.version || 1) + 1;
        item.version = item.objectVersion;
      }
    });
  }

  function createRequestId(prefix) {
    var seed = global.crypto && typeof global.crypto.randomUUID === "function"
      ? global.crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    return (prefix || "exam") + "-" + seed;
  }

  function errorFromResponse(response, body, requestId) {
    var error = new Error((body && body.message) || response.statusText || "接口请求失败");
    error.status = response.status;
    error.code = (body && body.code) || (response.status === 403 ? "FORBIDDEN" : response.status === 401 ? "UNAUTHORIZED" : "REQUEST_FAILED");
    error.requestId = (body && body.requestId) || requestId;
    error.currentStatus = body && body.currentStatus;
    error.retryable = body && typeof body.retryable === "boolean" ? body.retryable : response.status >= 500;
    return error;
  }

  function timeoutError(requestId) {
    var error = new Error("接口请求超时");
    error.code = "REQUEST_TIMEOUT";
    error.requestId = requestId;
    error.retryable = true;
    error.timeout = true;
    return error;
  }

  function apiPath(path) {
    var normalized = path.charAt(0) === "/" ? path : "/" + path;
    return API_BASE + normalized;
  }

  function fetchJson(path, options) {
    options = options || {};
    var method = String(options.method || "GET").toUpperCase();
    var requestId = options.requestId || createRequestId(method.toLowerCase());
    var controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    var timer = controller ? global.setTimeout(function () { controller.abort(); }, options.timeout || REQUEST_TIMEOUT) : null;
    var headers = Object.assign({
      Accept: "application/json",
      "X-Request-Id": requestId
    }, options.headers || {});
    var requestOptions = { method: method, headers: headers, credentials: "include" };
    if (controller) requestOptions.signal = controller.signal;
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(Object.assign({}, options.body || {}, { requestId: requestId }));
    }
    return global.fetch(apiPath(path), requestOptions).then(function (response) {
      return response.text().then(function (text) {
        var body = text ? JSON.parse(text) : {};
        if (!response.ok) throw errorFromResponse(response, body, requestId);
        return { data: body && body.data !== undefined ? body.data : body, requestId: body.requestId || requestId };
      });
    }).catch(function (error) {
      if (error && error.name === "AbortError") throw timeoutError(requestId);
      throw error;
    }).finally(function () {
      if (timer) global.clearTimeout(timer);
    });
  }

  function upsert(list, row, key) {
    if (!row || !row[key]) return;
    var index = list.findIndex(function (item) { return item && item[key] === row[key]; });
    if (index < 0) list.push(clone(row));
    else list[index] = Object.assign({}, list[index], clone(row));
  }

  function publish(next) {
    snapshot = Object.assign(emptyContract(), clone(next) || {});
    snapshot.schemaVersion = "1.0";
    snapshot.updatedAt = new Date().toISOString();
    snapshot.source = mock ? "prototype-api-mock" : "api-cache";
    snapshot.events = (snapshot.events || []).slice(-100);
    listeners.slice().forEach(function (listener) { listener(clone(snapshot)); });
    if (channel) channel.postMessage({ type: "contract-updated", contract: clone(snapshot) });
    return clone(snapshot);
  }

  function mockRequest(path, method, body, requestId) {
    expireMockApplications();
    if (mockRequests[requestId]) {
      if (mockRequests[requestId].error) return Promise.reject(Object.assign(new Error(mockRequests[requestId].message), mockRequests[requestId]));
      return Promise.resolve(clone(mockRequests[requestId]));
    }
    var result = { data: {}, requestId: requestId };
    var collection;
    if (method === "GET") {
      collection = path.indexOf("exam-brochures") > -1 ? "brochures" : path.indexOf("exam-batches") > -1 ? "batches" : path.indexOf("score-tasks") > -1 ? "scoreTasks" : path.indexOf("certificates") > -1 ? "certificates" : "";
      result.data = collection ? clone(snapshot[collection]) : {};
    } else if (path.indexOf("exam-applications") > -1) {
      var startAt = compactDateTimeToMs(body.registrationStartDate, body.registrationStartTime);
      var endAt = compactDateTimeToMs(body.registrationEndDate, body.registrationEndTime);
      if (Number.isFinite(startAt) && Date.now() < startAt) {
        var notStarted = mockDeadlineError("REGISTRATION_NOT_STARTED", "报名尚未开始", requestId);
        mockRequests[requestId] = { error: true, status: notStarted.status, code: notStarted.code, message: notStarted.message, requestId: requestId, retryable: false };
        return Promise.reject(notStarted);
      }
      if (Number.isFinite(endAt) && Date.now() >= endAt) {
        var closed = mockDeadlineError("REGISTRATION_CLOSED", "报名已结束", requestId);
        mockRequests[requestId] = { error: true, status: closed.status, code: closed.code, message: closed.message, requestId: requestId, retryable: false };
        return Promise.reject(closed);
      }
      var application = Object.assign({}, body, { applicationId: body.applicationId || "application-" + requestId.slice(-12), status: body.status || "待缴费" });
      upsert(snapshot.applications, application, "applicationId");
      result.data = clone(application);
    } else if (path.indexOf("score-tasks") > -1 && path.indexOf("/draft") > -1) {
      var draftTaskId = path.split("score-tasks/")[1].split("/")[0];
      var draft = Object.assign({}, body, { scoreId: body.scoreId || "score-" + draftTaskId, scoreStatusCode: "DRAFT", scoreStatusLabel: "已暂存", gradeStatusCode: "", gradeStatusLabel: "" });
      delete draft.status;
      delete draft.dimensions;
      upsert(snapshot.scores, draft, "scoreId");
      result.data = clone(draft);
    } else if (path.indexOf("score-tasks") > -1 && path.indexOf("submit") > -1) {
      var submitTaskId = path.split("score-tasks/")[1].split("/")[0];
      var score = Object.assign({}, body, { scoreId: body.scoreId || "score-" + submitTaskId, scoreStatusCode: "SUBMITTED", scoreStatusLabel: "已提交", gradeStatusCode: "PENDING_REVIEW", gradeStatusLabel: "待确认" });
      delete score.status;
      delete score.dimensions;
      upsert(snapshot.scores, score, "scoreId");
      result.data = clone(score);
    } else if (path.indexOf("tickets") > -1 && path.indexOf("publish") > -1) {
      var ticket = Object.assign({}, body, { status: "已发布" });
      upsert(snapshot.tickets, ticket, "ticketId");
      result.data = clone(ticket);
    } else if (path.indexOf("scores") > -1 && path.indexOf("publish") > -1) {
      var notTaken = body.examResultCode === "NOT_TAKEN";
      var published = Object.assign({}, body, { gradeStatusCode: "PUBLISHED", gradeStatusLabel: "已发布", examResultCode: body.examResultCode || "TAKEN", resultCode: notTaken ? "" : (body.resultCode || "PASS"), passedFlag: notTaken ? "" : (body.passedFlag || "Y") });
      delete published.status;
      delete published.dimensions;
      upsert(snapshot.scores, published, "scoreId");
      result.data = clone(published);
    } else {
      result.data = clone(body || {});
    }
    mockRequests[requestId] = result;
    expireMockApplications();
    publish(snapshot);
    return Promise.resolve(clone(result));
  }

  function request(path, options) {
    options = options || {};
    var method = String(options.method || "GET").toUpperCase();
    var requestId = options.requestId || createRequestId(method.toLowerCase());
    if (mock) return mockRequest(path, method, options.body || {}, requestId);
    return fetchJson(path, Object.assign({}, options, { requestId: requestId }));
  }

  function requestStatus(requestId) {
    if (!requestId) return Promise.reject(new Error("缺少 requestId"));
    if (mock) return Promise.resolve(mockRequests[requestId] ? clone(mockRequests[requestId]) : { data: { status: "NOT_FOUND" }, requestId: requestId });
    return fetchJson("/exam-requests/" + encodeURIComponent(requestId), { method: "GET", requestId: requestId });
  }

  function write(path, body, options) {
    options = options || {};
    var requestId = options.requestId || createRequestId("write");
    return request(path, { method: options.method || "POST", body: body || {}, requestId: requestId }).catch(function (error) {
      if (!error || (!error.timeout && !error.retryable)) throw error;
      return requestStatus(requestId).then(function (status) {
        if (status && status.data && status.data.status !== "NOT_FOUND") return status;
        throw error;
      }).catch(function () { throw error; });
    });
  }

  function readContract() {
    expireMockApplications();
    return clone(snapshot);
  }

  function mergeContract(next) {
    var merged = Object.assign(emptyContract(), snapshot, clone(next) || {});
    Object.keys(COLLECTION_KEYS).forEach(function (collection) {
      merged[collection] = Array.isArray(merged[collection]) ? merged[collection] : [];
    });
    snapshot = merged;
    expireMockApplications();
    return publish(snapshot);
  }

  function getCollection(collection, query) {
    var endpoint = {
      brochures: "/exam-brochures",
      batches: "/exam-batches",
      applications: "/exam-applications",
      schedules: "/exam-schedules",
      tickets: "/exam-tickets",
      scoreTasks: "/exam-score-tasks",
      scores: "/exam-scores",
      certificates: "/exam-certificates"
    }[collection];
    if (!endpoint) return Promise.reject(new Error("未知数据集合: " + collection));
    if (mock) {
      expireMockApplications();
      return Promise.resolve(clone(snapshot[collection] || []));
    }
    var params = new URLSearchParams(query || {});
    return request(endpoint + (params.toString() ? "?" + params.toString() : ""), { method: "GET" }).then(function (response) {
      var data = Array.isArray(response.data) ? response.data : (response.data.items || []);
      snapshot[collection] = data;
      publish(snapshot);
      return clone(data);
    });
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }

  function renderState(container, mode, message, retry) {
    if (!container) return;
    var node = container.querySelector("[data-api-state]");
    if (!node) {
      node = document.createElement("div");
      node.setAttribute("data-api-state", "true");
      node.className = "hbyx-api-state";
      container.insertBefore(node, container.firstChild);
    }
    node.setAttribute("data-state", mode || "empty");
    node.textContent = message || ({ loading: "加载中", empty: "暂无数据", error: "加载失败", retry: "请求失败，请重试", forbidden: "暂无权限", expired: "登录状态已过期" }[mode] || "暂无数据");
    node.hidden = false;
    if (mode === "retry" && typeof retry === "function") {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn link";
      button.textContent = "重试";
      button.addEventListener("click", retry);
      node.appendChild(button);
    }
  }

  function clearState(container) {
    var node = container && container.querySelector("[data-api-state]");
    if (node) node.hidden = true;
  }

  if (channel) channel.onmessage = function (event) {
    if (event.data && event.data.type === "contract-updated" && event.data.contract) {
      snapshot = Object.assign(emptyContract(), clone(event.data.contract));
      listeners.slice().forEach(function (listener) { listener(clone(snapshot)); });
    }
  };

  global.HBYXExamApi = {
    contractKey: CONTRACT_KEY,
    baseUrl: API_BASE,
    isMock: mock,
    collections: COLLECTION_KEYS,
    createRequestId: createRequestId,
    request: request,
    write: write,
    requestStatus: requestStatus,
    getCollection: getCollection,
    readContract: readContract,
    mergeContract: mergeContract,
    upsert: upsert,
    onChange: onChange,
    renderState: renderState,
    clearState: clearState,
    errorState: function (error) {
      return {
        code: error && error.code || "UNKNOWN",
        requestId: error && error.requestId || "",
        forbidden: !!(error && [401, 403].indexOf(error.status) > -1),
        expired: !!(error && [401, 419].indexOf(error.status) > -1),
        retryable: !!(error && error.retryable)
      };
    }
  };
})(window, document);
