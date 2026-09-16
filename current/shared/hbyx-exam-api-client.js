(function (global, document) {
  "use strict";

  var CONTRACT_KEY = "hbyx_exam_contract_v1";
  var EXAMINER_CERTIFICATE_CONTRACT = {
    contractId: "EXAM-CERT-REVIEW-DOWNSHIFT-20260911",
    reviewDomain: "examinerCertificateReview",
    validityDomain: "examinerCertificateValidity",
    reviewStatuses: ["PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"],
    validityStatuses: ["NOT_EFFECTIVE", "EFFECTIVE", "EXPIRED"],
    changeTypes: ["CREATE", "UPDATE", "DELETE"],
    endpoints: [
      "GET /api/examiner-certificates",
      "POST /api/examiner-certificates",
      "POST /api/examiner-certificates/{examinerCertificateId}/change-request",
      "POST /api/examiner-certificates/{examinerCertificateId}/withdraw",
      "GET /api/examiner-certificates/{examinerCertificateId}/reviews",
      "POST /api/examiner-certificates/{examinerCertificateId}/review",
      "GET /api/examiner-certificates/dispatch-eligibility"
    ]
  };
  var EXAMINER_CERTIFICATE_VALIDITY_LABEL = {
    EFFECTIVE: "有效",
    EXPIRED: "已过期",
    NOT_EFFECTIVE: "未生效"
  };
  var COLLECTION_KEYS = {
    brochures: "brochureId",
    batches: "batchId",
    applications: "applicationId",
    schedules: "scheduleId",
    tickets: "ticketId",
    scoreTasks: "scoreTaskId",
    scores: "scoreId",
    certificates: "certificateId",
    examinerCertificates: "examinerCertificateId"
  };
  var API_BASE = String(global.HBYX_EXAM_API_BASE_URL || "").replace(/\/$/, "");
  var REQUEST_TIMEOUT = Number(global.HBYX_EXAM_API_TIMEOUT || 12000);
  var mock = !API_BASE;
  var MOCK_SNAPSHOT_KEY = CONTRACT_KEY + ":mock-snapshot";
  var mockRequests = Object.create(null);
  var listeners = [];
  var snapshot = emptyContract();
  var mockStorage = (function () {
    try {
      return global.localStorage || null;
    } catch (error) {
      return null;
    }
  })();
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
      examinerCertificates: [],
      auditLogs: [],
      notificationEvents: [],
      events: []
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function restoreMockSnapshot() {
    if (!mock || !mockStorage) return;
    try {
      var raw = mockStorage.getItem(MOCK_SNAPSHOT_KEY);
      if (!raw) return;
      snapshot = Object.assign(emptyContract(), JSON.parse(raw));
    } catch (error) {
      snapshot = emptyContract();
    }
  }

  function persistMockSnapshot() {
    if (!mock || !mockStorage) return;
    try {
      mockStorage.setItem(MOCK_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (error) {
      /* storage may be unavailable or full; the mock keeps working in memory */
    }
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

  function parseQueryString(path) {
    var query = {};
    var text = String(path || "");
    var index = text.indexOf("?");
    if (index < 0) return query;
    text.slice(index + 1).split("&").forEach(function (pair) {
      if (!pair) return;
      var parts = pair.split("=");
      var key = decodeURIComponent(parts[0] || "");
      if (!key) return;
      query[key] = decodeURIComponent((parts.slice(1).join("=") || "").replace(/\+/g, " "));
    });
    return query;
  }

  function compactDate(value) {
    var digits = String(value == null ? "" : value).replace(/[^0-9]/g, "");
    return digits.length === 8 ? digits : "";
  }

  function isoDate(value) {
    var digits = compactDate(value);
    return digits ? digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6, 8) : "";
  }

  function examinerCertificateRows() {
    if (!Array.isArray(snapshot.examinerCertificates)) snapshot.examinerCertificates = [];
    return snapshot.examinerCertificates;
  }

  function examinerCertificateError(code, message, status, requestId, extra) {
    var error = new Error(message);
    error.status = status || 400;
    error.code = code;
    error.requestId = requestId;
    error.retryable = Number(status || 400) >= 500;
    if (extra) Object.assign(error, extra);
    return error;
  }

  function examinerCertificateFind(id) {
    if (!id) return null;
    return examinerCertificateRows().filter(function (row) {
      return row && row.examinerCertificateId === id;
    })[0] || null;
  }

  function examinerCertificatePendingDelete(certificateId) {
    return examinerCertificateRows().some(function (row) {
      return row
        && row.changeType === "DELETE"
        && row.certificateReviewStatusCode === "PENDING_REVIEW"
        && row.replacedCertificateId === certificateId;
    });
  }

  function examinerCertificateInValidity(row, serverDate) {
    if (!row) return false;
    var from = compactDate(row.validFromDate);
    var until = compactDate(row.validUntilDate);
    if (!from || !until) return true;
    return from <= serverDate && serverDate <= until;
  }

  function examinerCertificateValidityStatus(row, serverDate) {
    if (!row) return "NOT_EFFECTIVE";
    if (["EXPIRED", "REVOKED"].indexOf(row.certificateValidityStatusCode) > -1) return "EXPIRED";
    var from = compactDate(row.validFromDate);
    var until = compactDate(row.validUntilDate);
    if (until && until < serverDate) return "EXPIRED";
    if (from && serverDate < from) return "NOT_EFFECTIVE";
    return row.certificateReviewStatusCode === "APPROVED" ? "EFFECTIVE" : "NOT_EFFECTIVE";
  }

  function examinerCertificateIsDispatchEligible(row, serverDate) {
    if (!row) return false;
    return row.certificateReviewStatusCode === "APPROVED"
      && examinerCertificateValidityStatus(row, serverDate) === "EFFECTIVE"
      && examinerCertificateInValidity(row, serverDate)
      && !examinerCertificatePendingDelete(row.examinerCertificateId);
  }

  function examinerCertificateView(row) {
    if (!row) return null;
    var clock = mockBusinessClock();
    var pendingDelete = examinerCertificatePendingDelete(row.examinerCertificateId);
    var inValidity = examinerCertificateInValidity(row, clock.serverDate);
    var view = clone(row);
    view.id = row.examinerCertificateId;
    view.number = row.certificateNumber;
    view.name = row.certificateName;
    view.major = row.certificateMajor || "";
    view.startDate = isoDate(row.validFromDate);
    view.endDate = isoDate(row.validUntilDate);
    view.expireDate = isoDate(row.validUntilDate);
    view.reviewStatus = row.certificateReviewStatusCode;
    view.validityStatus = examinerCertificateValidityStatus(row, clock.serverDate);
    view.status = EXAMINER_CERTIFICATE_VALIDITY_LABEL[view.validityStatus] || "未生效";
    view.addedAt = isoDate(row.createdDate);
    view.pendingDelete = pendingDelete;
    view.inValidityPeriod = inValidity;
    view.dispatchEligible = examinerCertificateIsDispatchEligible(row, clock.serverDate);
    return view;
  }

  function examinerCertificateDuplicate(number, excludeId) {
    return examinerCertificateRows().some(function (row) {
      return row
        && row.examinerCertificateId !== excludeId
        && row.certificateNumber === number
        && ["REJECTED", "WITHDRAWN"].indexOf(row.certificateReviewStatusCode) < 0
        && !row.replacementCertificateId;
    });
  }

  function examinerCertificateAudit(action, row, actor, detail) {
    var clock = mockBusinessClock();
    if (!Array.isArray(snapshot.auditLogs)) snapshot.auditLogs = [];
    var entry = {
      auditId: createRequestId("audit"),
      action: action,
      businessObjectType: "EXAMINER_CERTIFICATE",
      businessObjectId: row.examinerCertificateId,
      examinerId: row.examinerId,
      actorRole: (actor && actor.role) || "",
      actorId: (actor && actor.id) || "",
      detail: detail || "",
      operationDate: clock.serverDate,
      operationTime: clock.serverTime
    };
    snapshot.auditLogs.push(entry);
    if (snapshot.auditLogs.length > 300) snapshot.auditLogs.splice(0, snapshot.auditLogs.length - 300);
    row.auditEventIds = (row.auditEventIds || []).concat([entry.auditId]);
    return entry;
  }

  function examinerCertificateNotify(eventType, row, templateVersion) {
    var clock = mockBusinessClock();
    if (!Array.isArray(snapshot.notificationEvents)) snapshot.notificationEvents = [];
    var entry = {
      notificationEventId: createRequestId("notify"),
      eventType: eventType,
      businessObjectType: "EXAMINER_CERTIFICATE",
      businessObjectId: row.examinerCertificateId,
      examinerId: row.examinerId,
      templateVersion: templateVersion || "EXAMINER_CERT_REVIEW_V1",
      recipientSnapshot: { role: "examiner", examinerId: row.examinerId },
      channel: "IN_APP",
      status: "PENDING",
      retryCount: 0,
      deliveryAttempts: [{ channel: "IN_APP", status: "PENDING", attemptedDate: clock.serverDate, attemptedTime: clock.serverTime }],
      createdDate: clock.serverDate,
      createdTime: clock.serverTime
    };
    snapshot.notificationEvents.push(entry);
    if (snapshot.notificationEvents.length > 300) snapshot.notificationEvents.splice(0, snapshot.notificationEvents.length - 300);
    row.notificationEventIds = (row.notificationEventIds || []).concat([entry.notificationEventId]);
    return entry;
  }

  function examinerCertificateReviewEntry(row, decision, actor, reason, requestId) {
    var clock = mockBusinessClock();
    return {
      reviewRequestId: row.reviewRequestId || createRequestId("review"),
      objectVersion: row.objectVersion,
      decision: decision,
      reviewerId: (actor && actor.id) || "",
      reviewerRole: (actor && actor.role) || "",
      reason: reason || "",
      reviewerRequestId: requestId || "",
      reviewedDate: clock.serverDate,
      reviewedTime: clock.serverTime
    };
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
    persistMockSnapshot();
    return clone(snapshot);
  }

  function mockExaminerCertificateRequest(path, method, body, requestId) {
    var query = parseQueryString(path);
    var segments = String(path || "").split("?")[0].split("/").filter(function (segment) { return segment; });
    var certificateId = segments[1] || "";
    var action = segments[2] || "";
    var rows = examinerCertificateRows();
    var clock = mockBusinessClock();

    function succeed(data) {
      var result = { data: data, requestId: requestId, contractVersion: EXAMINER_CERTIFICATE_CONTRACT.contractId };
      mockRequests[requestId] = result;
      publish(snapshot);
      return Promise.resolve(clone(result));
    }

    function fail(error) {
      mockRequests[requestId] = {
        error: true,
        status: error.status,
        code: error.code,
        message: error.message,
        requestId: requestId,
        retryable: !!error.retryable,
        currentVersion: error.currentVersion,
        currentStatus: error.currentStatus
      };
      return Promise.reject(error);
    }

    function operator(body, fallback) {
      return {
        id: String((body && (body.actorId || body.examinerId || body.reviewerId)) || ""),
        role: String((body && body.actorRole) || fallback || "")
      };
    }

    if (method === "GET" && certificateId === "dispatch-eligibility") {
      var examinerIdForEligibility = String(query.examinerId || "").trim();
      if (!examinerIdForEligibility) return fail(examinerCertificateError("VALIDATION_ERROR", "examinerId is required", 400, requestId));
      var eligibleRow = rows.filter(function (row) {
        return row.examinerId === examinerIdForEligibility && examinerCertificateIsDispatchEligible(row, clock.serverDate);
      })[0] || null;
      return succeed({
        examinerId: examinerIdForEligibility,
        eligible: !!eligibleRow,
        serverDate: clock.serverDate,
        reason: eligibleRow ? "" : "没有审核通过且在有效期内的证书",
        examinerCertificateId: eligibleRow ? eligibleRow.examinerCertificateId : "",
        certificateNumber: eligibleRow ? eligibleRow.certificateNumber : ""
      });
    }

    if (method === "GET" && action === "reviews") {
      var reviewRow = examinerCertificateFind(certificateId);
      if (!reviewRow) return fail(examinerCertificateError("NOT_FOUND", "证书不存在", 404, requestId));
      return succeed({
        examinerCertificateId: reviewRow.examinerCertificateId,
        examinerId: reviewRow.examinerId,
        certificateReviewStatusCode: reviewRow.certificateReviewStatusCode,
        certificateValidityStatusCode: reviewRow.certificateValidityStatusCode,
        objectVersion: reviewRow.objectVersion,
        reviewHistory: clone(reviewRow.reviewHistory || []),
        auditEventIds: clone(reviewRow.auditEventIds || []),
        notificationEventIds: clone(reviewRow.notificationEventIds || [])
      });
    }

    if (method === "GET" && certificateId) {
      var single = examinerCertificateFind(certificateId);
      if (!single) return fail(examinerCertificateError("NOT_FOUND", "证书不存在", 404, requestId));
      return succeed(examinerCertificateView(single));
    }

    if (method === "GET") {
      var filterExaminerId = String(query.examinerId || "").trim();
      var list = rows.filter(function (row) {
        return !filterExaminerId || row.examinerId === filterExaminerId;
      }).map(function (row) {
        return examinerCertificateView(row);
      });
      return succeed(list);
    }

    if (method !== "POST") return fail(examinerCertificateError("METHOD_NOT_ALLOWED", "不支持的请求方法", 405, requestId));

    if (action === "change-request") {
      var target = examinerCertificateFind(certificateId);
      if (!target) return fail(examinerCertificateError("NOT_FOUND", "证书不存在", 404, requestId));
      var changeType = String(body.changeType || "").toUpperCase();
      if (["UPDATE", "DELETE"].indexOf(changeType) < 0) {
        return fail(examinerCertificateError("VALIDATION_ERROR", "changeType must be UPDATE or DELETE", 400, requestId));
      }
      if (Number(body.objectVersion) !== Number(target.objectVersion)) {
        return fail(examinerCertificateError("VERSION_CONFLICT", "证书已被更新，请刷新后重试", 409, requestId, { currentVersion: target.objectVersion, currentStatus: target.certificateReviewStatusCode }));
      }
      if (target.certificateReviewStatusCode !== "APPROVED") {
        return fail(examinerCertificateError("STATUS_NOT_ALLOWED", "仅已通过的证书可以发起变更或注销", 409, requestId, { currentStatus: target.certificateReviewStatusCode }));
      }
      var hasPendingChange = rows.some(function (row) {
        return row.replacedCertificateId === target.examinerCertificateId && row.certificateReviewStatusCode === "PENDING_REVIEW";
      });
      if (hasPendingChange) {
        return fail(examinerCertificateError("CHANGE_REQUEST_EXISTS", "该证书已有待审核的变更或注销申请", 409, requestId, { currentStatus: target.certificateReviewStatusCode }));
      }
      var nextNumber = changeType === "DELETE" ? target.certificateNumber : String(body.certificateNumber || target.certificateNumber).trim();
      var nextName = changeType === "DELETE" ? target.certificateName : String(body.certificateName || target.certificateName).trim();
      var nextMajor = changeType === "DELETE" ? (target.certificateMajor || "") : String(body.certificateMajor || body.major || target.certificateMajor || "").trim();
      var nextFrom = changeType === "DELETE" ? compactDate(target.validFromDate) : compactDate(body.validFromDate || body.startDate || target.validFromDate);
      var nextUntil = changeType === "DELETE" ? compactDate(target.validUntilDate) : compactDate(body.validUntilDate || body.endDate || body.expireDate || target.validUntilDate);
      if (!nextNumber || !nextName || !nextFrom || !nextUntil) {
        return fail(examinerCertificateError("VALIDATION_ERROR", "证书编号、名称和有效期不能为空", 400, requestId));
      }
      if (nextFrom > nextUntil) {
        return fail(examinerCertificateError("VALIDATION_ERROR", "有效期开始日期不能晚于截止日期", 400, requestId));
      }
      if (changeType === "UPDATE" && examinerCertificateDuplicate(nextNumber, target.examinerCertificateId)) {
        return fail(examinerCertificateError("DUPLICATE_CERTIFICATE_NUMBER", "证书编号已存在", 409, requestId));
      }
      var actor = operator(body, "examiner");
      if (actor.role !== "examiner") return fail(examinerCertificateError("FORBIDDEN", "仅考官本人可以发起证书变更", 403, requestId));
      var pending = {
        examinerCertificateId: createRequestId("cert"),
        examinerId: target.examinerId,
        certificateNumber: nextNumber,
        certificateName: nextName,
        certificateMajor: nextMajor,
        validFromDate: nextFrom,
        validUntilDate: nextUntil,
        certificateReviewStatusCode: "PENDING_REVIEW",
        certificateValidityStatusCode: changeType === "DELETE" ? target.certificateValidityStatusCode : "NOT_EFFECTIVE",
        changeType: changeType,
        objectVersion: 1,
        requestId: requestId,
        replacedCertificateId: target.examinerCertificateId,
        replacementCertificateId: "",
        reviewRequestId: createRequestId("review"),
        reviewReason: "",
        reviewHistory: [],
        auditEventIds: [],
        notificationEventIds: [],
        createdDate: clock.serverDate,
        createdTime: clock.serverTime,
        updatedDate: clock.serverDate,
        updatedTime: clock.serverTime
      };
      rows.push(pending);
      examinerCertificateAudit(changeType === "DELETE" ? "CERTIFICATE_DELETE_REQUESTED" : "CERTIFICATE_UPDATE_REQUESTED", pending, actor, "发起证书" + (changeType === "DELETE" ? "注销" : "变更") + "申请");
      examinerCertificateNotify("EXAMINER_CERTIFICATE_PENDING_REVIEW", pending);
      return succeed(examinerCertificateView(pending));
    }

    if (action === "withdraw") {
      var withdrawRow = examinerCertificateFind(certificateId);
      if (!withdrawRow) return fail(examinerCertificateError("NOT_FOUND", "证书申请不存在", 404, requestId));
      var withdrawActor = operator(body, "examiner");
      if (withdrawActor.role !== "examiner") return fail(examinerCertificateError("FORBIDDEN", "仅考官本人可以撤回证书申请", 403, requestId));
      if (["PENDING_REVIEW", "DRAFT"].indexOf(withdrawRow.certificateReviewStatusCode) < 0) {
        return fail(examinerCertificateError("STATUS_NOT_ALLOWED", "该证书申请已处理，不可撤回", 409, requestId, { currentStatus: withdrawRow.certificateReviewStatusCode }));
      }
      if (Number(body.objectVersion) !== Number(withdrawRow.objectVersion)) {
        return fail(examinerCertificateError("VERSION_CONFLICT", "证书申请已被更新，请刷新后重试", 409, requestId, { currentVersion: withdrawRow.objectVersion, currentStatus: withdrawRow.certificateReviewStatusCode }));
      }
      withdrawRow.certificateReviewStatusCode = "WITHDRAWN";
      withdrawRow.objectVersion = Number(withdrawRow.objectVersion) + 1;
      withdrawRow.updatedDate = clock.serverDate;
      withdrawRow.updatedTime = clock.serverTime;
      withdrawRow.reviewHistory = (withdrawRow.reviewHistory || []).concat([examinerCertificateReviewEntry(withdrawRow, "WITHDRAWN", withdrawActor, "", requestId)]);
      examinerCertificateAudit("CERTIFICATE_WITHDRAWN", withdrawRow, withdrawActor, "考官撤回证书申请");
      examinerCertificateNotify("EXAMINER_CERTIFICATE_WITHDRAWN", withdrawRow);
      return succeed(examinerCertificateView(withdrawRow));
    }

    if (action === "review") {
      var reviewRowTarget = examinerCertificateFind(certificateId);
      if (!reviewRowTarget) return fail(examinerCertificateError("NOT_FOUND", "证书申请不存在", 404, requestId));
      var reviewActor = operator(body, "platform_admin");
      if (reviewActor.role !== "platform_admin") return fail(examinerCertificateError("FORBIDDEN", "仅平台管理员可以审核考官证书", 403, requestId));
      if (reviewRowTarget.certificateReviewStatusCode !== "PENDING_REVIEW") {
        return fail(examinerCertificateError("STATUS_NOT_ALLOWED", "该证书申请已处理", 409, requestId, { currentStatus: reviewRowTarget.certificateReviewStatusCode }));
      }
      if (Number(body.objectVersion) !== Number(reviewRowTarget.objectVersion)) {
        return fail(examinerCertificateError("VERSION_CONFLICT", "证书申请已被更新，请刷新后重试", 409, requestId, { currentVersion: reviewRowTarget.objectVersion, currentStatus: reviewRowTarget.certificateReviewStatusCode }));
      }
      var decision = String(body.decision || "").toUpperCase();
      if (["APPROVE", "REJECT"].indexOf(decision) < 0) {
        return fail(examinerCertificateError("VALIDATION_ERROR", "decision must be APPROVE or REJECT", 400, requestId));
      }
      var reviewReason = String(body.reviewReason || body.reason || "").trim();
      if (decision === "REJECT" && !reviewReason) {
        return fail(examinerCertificateError("VALIDATION_ERROR", "驳回原因不能为空", 400, requestId));
      }
      if (decision === "APPROVE") {
        reviewRowTarget.certificateReviewStatusCode = "APPROVED";
        reviewRowTarget.reviewReason = "";
        if (reviewRowTarget.changeType === "DELETE") {
          reviewRowTarget.certificateValidityStatusCode = "EXPIRED";
          var replacedForDelete = examinerCertificateFind(reviewRowTarget.replacedCertificateId);
          if (replacedForDelete) {
            replacedForDelete.certificateValidityStatusCode = "EXPIRED";
            replacedForDelete.updatedDate = clock.serverDate;
            replacedForDelete.updatedTime = clock.serverTime;
          }
        } else {
          reviewRowTarget.certificateValidityStatusCode = examinerCertificateInValidity(reviewRowTarget, clock.serverDate) ? "EFFECTIVE" : "NOT_EFFECTIVE";
          if (reviewRowTarget.changeType === "UPDATE" && reviewRowTarget.replacedCertificateId) {
            var previousVersion = examinerCertificateFind(reviewRowTarget.replacedCertificateId);
            if (previousVersion) {
              previousVersion.certificateValidityStatusCode = "EXPIRED";
              previousVersion.replacementCertificateId = reviewRowTarget.examinerCertificateId;
              previousVersion.updatedDate = clock.serverDate;
              previousVersion.updatedTime = clock.serverTime;
            }
          }
        }
        examinerCertificateAudit("CERTIFICATE_APPROVED", reviewRowTarget, reviewActor, "平台审核通过");
        examinerCertificateNotify("EXAMINER_CERTIFICATE_APPROVED", reviewRowTarget);
      } else {
        reviewRowTarget.certificateReviewStatusCode = "REJECTED";
        reviewRowTarget.reviewReason = reviewReason;
        examinerCertificateAudit("CERTIFICATE_REJECTED", reviewRowTarget, reviewActor, reviewReason);
        examinerCertificateNotify("EXAMINER_CERTIFICATE_REJECTED", reviewRowTarget);
      }
      reviewRowTarget.objectVersion = Number(reviewRowTarget.objectVersion) + 1;
      reviewRowTarget.updatedDate = clock.serverDate;
      reviewRowTarget.updatedTime = clock.serverTime;
      reviewRowTarget.reviewHistory = (reviewRowTarget.reviewHistory || []).concat([examinerCertificateReviewEntry(reviewRowTarget, decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewActor, reviewReason, requestId)]);
      return succeed(examinerCertificateView(reviewRowTarget));
    }

    if (certificateId) return fail(examinerCertificateError("NOT_FOUND", "接口不存在", 404, requestId));

    var createExaminerId = String(body.examinerId || "").trim();
    var createNumber = String(body.certificateNumber || body.number || "").trim();
    var createName = String(body.certificateName || body.name || "").trim();
    var createMajor = String(body.certificateMajor || body.major || "").trim();
    var createFrom = compactDate(body.validFromDate || body.startDate);
    var createUntil = compactDate(body.validUntilDate || body.endDate || body.expireDate);
    if (!createExaminerId || !createNumber || !createName || !createFrom || !createUntil) {
      return fail(examinerCertificateError("VALIDATION_ERROR", "examinerId、证书编号、名称和有效期不能为空", 400, requestId));
    }
    if (createFrom > createUntil) {
      return fail(examinerCertificateError("VALIDATION_ERROR", "有效期开始日期不能晚于截止日期", 400, requestId));
    }
    if (examinerCertificateDuplicate(createNumber, "")) {
      return fail(examinerCertificateError("DUPLICATE_CERTIFICATE_NUMBER", "证书编号已存在", 409, requestId));
    }
    var createActor = operator(body, "examiner");
    if (["examiner", "platform_admin"].indexOf(createActor.role) < 0) {
      return fail(examinerCertificateError("FORBIDDEN", "当前角色无权新增考官证书", 403, requestId));
    }
    var created = {
      examinerCertificateId: createRequestId("cert"),
      examinerId: createExaminerId,
      certificateNumber: createNumber,
      certificateName: createName,
      certificateMajor: createMajor,
      validFromDate: createFrom,
      validUntilDate: createUntil,
      certificateReviewStatusCode: "PENDING_REVIEW",
      certificateValidityStatusCode: "NOT_EFFECTIVE",
      changeType: "CREATE",
      objectVersion: 1,
      requestId: requestId,
      replacedCertificateId: "",
      replacementCertificateId: "",
      reviewRequestId: createRequestId("review"),
      reviewReason: "",
      reviewHistory: [],
      auditEventIds: [],
      notificationEventIds: [],
      createdDate: clock.serverDate,
      createdTime: clock.serverTime,
      updatedDate: clock.serverDate,
      updatedTime: clock.serverTime
    };
    rows.push(created);
    examinerCertificateAudit("CERTIFICATE_CREATED", created, createActor, "提交新增证书申请");
    examinerCertificateNotify("EXAMINER_CERTIFICATE_PENDING_REVIEW", created);
    return succeed(examinerCertificateView(created));
  }

  function mockRequest(path, method, body, requestId) {
    expireMockApplications();
    if (mockRequests[requestId]) {
      if (mockRequests[requestId].error) return Promise.reject(Object.assign(new Error(mockRequests[requestId].message), mockRequests[requestId]));
      return Promise.resolve(clone(mockRequests[requestId]));
    }
    if (String(path || "").indexOf("examiner-certificates") > -1) {
      return mockExaminerCertificateRequest(path, method, body, requestId);
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
      certificates: "/exam-certificates",
      examinerCertificates: "/examiner-certificates"
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
      persistMockSnapshot();
    }
  };

  restoreMockSnapshot();

  global.HBYXExamApi = {
    contractKey: CONTRACT_KEY,
    examinerCertificateContract: EXAMINER_CERTIFICATE_CONTRACT,
    baseUrl: API_BASE,
    isMock: mock,
    collections: COLLECTION_KEYS,
    createRequestId: createRequestId,
    request: request,
    write: write,
    requestStatus: requestStatus,
    getCollection: getCollection,
    listExaminerCertificates: function (query) {
      var params = query || {};
      if (mock) {
        var examinerId = String(params.examinerId || "").trim();
        return Promise.resolve(clone(examinerCertificateRows().filter(function (row) {
          return !examinerId || row.examinerId === examinerId;
        }).map(function (row) {
          return examinerCertificateView(row);
        })));
      }
      var search = new URLSearchParams();
      if (params.examinerId) search.set("examinerId", params.examinerId);
      return request("/examiner-certificates" + (search.toString() ? "?" + search.toString() : ""), { method: "GET" }).then(function (response) {
        return Array.isArray(response.data) ? response.data : (response.data.items || []);
      });
    },
    getExaminerCertificate: function (examinerCertificateId) {
      return request("/examiner-certificates/" + encodeURIComponent(examinerCertificateId), { method: "GET" }).then(function (response) {
        return response.data;
      });
    },
    createExaminerCertificate: function (payload, options) {
      return write("/examiner-certificates", payload, options);
    },
    requestExaminerCertificateChange: function (examinerCertificateId, payload, options) {
      return write("/examiner-certificates/" + encodeURIComponent(examinerCertificateId) + "/change-request", payload, options);
    },
    withdrawExaminerCertificate: function (examinerCertificateId, payload, options) {
      return write("/examiner-certificates/" + encodeURIComponent(examinerCertificateId) + "/withdraw", payload, options);
    },
    reviewExaminerCertificate: function (examinerCertificateId, payload, options) {
      return write("/examiner-certificates/" + encodeURIComponent(examinerCertificateId) + "/review", payload, options);
    },
    listExaminerCertificateReviews: function (examinerCertificateId, options) {
      return request("/examiner-certificates/" + encodeURIComponent(examinerCertificateId) + "/reviews", Object.assign({ method: "GET" }, options || {})).then(function (response) {
        return response.data;
      });
    },
    examinerCertificateDispatchEligibility: function (examinerId) {
      return request("/examiner-certificates/dispatch-eligibility?examinerId=" + encodeURIComponent(examinerId), { method: "GET" }).then(function (response) {
        return response.data;
      });
    },
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
