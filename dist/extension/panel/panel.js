"use strict";
(() => {
  // src/extension/panel/panel.ts
  var showAllTelemetry = false;
  var getRuntime = () => globalThis.chrome?.runtime;
  var getTabsApi = () => globalThis.chrome?.tabs;
  var escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  var toTitleCase = (value) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  var isTabSupported = (tab) => /^https?:\/\//.test(String(tab?.url ?? ""));
  var getCurrentTab = async () => {
    const tabs = getTabsApi();
    if (!tabs?.query) {
      return void 0;
    }
    return await new Promise((resolve) => {
      tabs.query({ active: true, currentWindow: true }, (results) => {
        resolve(Array.isArray(results) ? results[0] : void 0);
      });
    });
  };
  var isMeaningfulExecutionEvent = (event) => event.riskFlags?.includes("code-execution") === true && typeof event.metadata?.jupyterCodeHash === "string" && Number(event.metadata?.jupyterCodeLength ?? 0) > 0;
  var isEgressIndicativeExecutionEvent = (event) => isMeaningfulExecutionEvent(event) && (event.riskFlags?.includes("hidden-egress") === true || event.delegatedExecutionEvent?.outboundCapabilityDetected === true);
  var renderSensorStatus = (diagnostics, tabSupported) => {
    const container = document.getElementById("sensor-status");
    if (!container) {
      return;
    }
    const status = diagnostics ?? {
      pageInstrumentation: "unknown",
      contentBridge: "unavailable",
      backgroundObserver: "active",
      eventsObserved: 0,
      websocketConnectionsObserved: 0,
      websocketOutboundFramesObserved: 0,
      jupyterExecutionRequestsObserved: 0,
      recogniserState: "inactive"
    };
    container.innerHTML = `
    <div><strong>Page instrumentation:</strong> ${escapeHtml(toTitleCase(status.pageInstrumentation))}</div>
    <div><strong>Content bridge:</strong> ${escapeHtml(toTitleCase(status.contentBridge))}</div>
    <div><strong>Background observer:</strong> ${escapeHtml(toTitleCase(status.backgroundObserver))}</div>
    <div><strong>Events observed:</strong> ${escapeHtml(status.eventsObserved)}</div>
    <div><strong>WebSocket connections observed:</strong> ${escapeHtml(status.websocketConnectionsObserved)}</div>
    <div><strong>WebSocket outbound frames observed:</strong> ${escapeHtml(status.websocketOutboundFramesObserved)}</div>
    <div><strong>Jupyter execution requests observed:</strong> ${escapeHtml(status.jupyterExecutionRequestsObserved)}</div>
    <div><strong>Recogniser state:</strong> ${escapeHtml(toTitleCase(status.recogniserState))}</div>
    <div><strong>Latest protocol event:</strong> ${escapeHtml(status.latestProtocolEvent ?? "none")}</div>
    <div><strong>Latest meaningful execution:</strong> ${escapeHtml(status.latestMeaningfulExecutionEvent ?? status.lastSemanticEvent ?? "none")}</div>
    <div><strong>Development diagnostics (metadata only):</strong></div>
    <div><strong>Known symbols:</strong> ${escapeHtml(status.knownSymbolsCount ?? 0)}</div>
    <div><strong>Known functions:</strong> ${escapeHtml(status.knownFunctionsCount ?? 0)}</div>
    <div><strong>Known variables:</strong> ${escapeHtml(status.knownVariablesCount ?? 0)}</div>
    <div><strong>Semantic session hash:</strong> <code>${escapeHtml(status.currentSemanticSessionHash ?? "none")}</code></div>
    <div><strong>Latest function defined:</strong> ${escapeHtml(status.latestFunctionDefined ?? "none")}</div>
    <div><strong>Latest function invoked:</strong> ${escapeHtml(status.latestFunctionInvoked ?? "none")}</div>
    <div><strong>Latest attempted function (this exec):</strong> ${escapeHtml(status.latestAttemptedFunction ?? "none")}</div>
    <div><strong>Latest resolved function (this exec):</strong> ${escapeHtml(status.latestResolvedFunction ?? "none")}</div>
    <div><strong>Execution sequence (context):</strong> ${escapeHtml(status.latestExecutionSequenceId ?? 0)}</div>
    <div><strong>Stored function names:</strong> ${escapeHtml(status.storedFunctionNames?.join(", ") || "none")}</div>
    <div><strong>Latest resolution result:</strong> ${escapeHtml(status.latestResolutionResult ?? "none")}</div>
    <div><strong>Latest resolution failure reason:</strong> ${escapeHtml(status.latestResolutionFailureReason ?? "none")}</div>
    <div><strong>Last state reset reason:</strong> ${escapeHtml(status.lastStateResetReason ?? "none")}</div>
    <div><strong>Total WebSocket frames:</strong> ${escapeHtml(status.totalWebSocketFramesObserved ?? 0)}</div>
    <div><strong>Text frames:</strong> ${escapeHtml(status.textWebSocketFramesObserved ?? 0)}</div>
    <div><strong>Binary frames:</strong> ${escapeHtml(status.binaryWebSocketFramesObserved ?? 0)}</div>
    <div><strong>Latest frame length:</strong> ${escapeHtml(status.latestFrameByteLength ?? 0)}</div>
    <div><strong>Latest display sample length:</strong> ${escapeHtml(status.latestDisplaySampleLength ?? 0)}</div>
    <div><strong>Latest display sample truncated:</strong> ${status.latestDisplaySampleTruncated ? "Yes" : "No"}</div>
    <div><strong>Display samples truncated:</strong> ${escapeHtml(status.displaySamplesTruncatedCount ?? 0)}</div>
    <div><strong>Jupyter parse success/failure:</strong> ${escapeHtml(status.jupyterParseSuccesses ?? 0)}/${escapeHtml(status.jupyterParseFailures ?? 0)}</div>
    <div><strong>Code extraction success/failure:</strong> ${escapeHtml(status.codeExtractionSuccesses ?? 0)}/${escapeHtml(status.codeExtractionFailures ?? 0)}</div>
    <div><strong>Code extraction attempts:</strong> ${escapeHtml(status.codeExtractionAttempts ?? 0)}</div>
    <div><strong>AST analysis success/failure:</strong> ${escapeHtml(status.astAnalysisSuccesses ?? 0)}/${escapeHtml(status.astAnalysisFailures ?? 0)}</div>
    <div><strong>Discovered imports/functions/variables/calls:</strong> ${escapeHtml(
      `${status.importsDiscovered ?? 0}/${status.functionsDiscovered ?? 0}/${status.assignmentsDiscovered ?? 0}/${status.callsDiscovered ?? 0}`
    )}</div>
    <div><strong>Semantic facts emitted:</strong> ${escapeHtml(status.semanticFactsEmitted ?? 0)}</div>
    <div><strong>Latest analysis failure reason:</strong> ${escapeHtml(status.latestAnalysisFailureReason ?? "none")}</div>
    <div><strong>FunctionDef nodes found:</strong> ${escapeHtml(status.functionDefNodesFound ?? 0)}</div>
    <div><strong>AsyncFunctionDef nodes found:</strong> ${escapeHtml(status.asyncFunctionDefNodesFound ?? 0)}</div>
    <div><strong>Latest function hash:</strong> <code>${escapeHtml(status.latestFunctionNameHash ?? "none")}</code></div>
    <div><strong>Latest function parameter count:</strong> ${escapeHtml(status.latestFunctionParameterCount ?? 0)}</div>
    <div><strong>Latest function decorator count:</strong> ${escapeHtml(status.latestFunctionDecoratorCount ?? 0)}</div>
    <div><strong>Latest function body statements:</strong> ${escapeHtml(status.latestFunctionBodyStatementCount ?? 0)}</div>
    <div><strong>Latest function nested count:</strong> ${escapeHtml(status.latestFunctionNestedCount ?? 0)}</div>
    <div><strong>Latest function capability count:</strong> ${escapeHtml(status.latestFunctionCapabilityCount ?? 0)}</div>
    <div><strong>Latest function semantic fact emitted:</strong> ${status.latestFunctionSemanticFactEmitted ? "Yes" : "No"}</div>
    <div><strong>Function store insertion attempted:</strong> ${status.functionStoreInsertionAttempted ? "Yes" : "No"}</div>
    <div><strong>Function store insertion succeeded:</strong> ${status.functionStoreInsertionSucceeded ? "Yes" : "No"}</div>
    <div><strong>Function store insertion failure:</strong> ${escapeHtml(status.functionStoreInsertionFailureReason ?? "none")}</div>
    <div><strong>Function extraction attempted (cumulative):</strong> ${escapeHtml(status.functionExtractionAttempted ?? 0)}</div>
    <div><strong>Function extraction succeeded (cumulative):</strong> ${escapeHtml(status.functionExtractionSucceeded ?? 0)}</div>
    <div><strong>Function extraction failed (cumulative):</strong> ${escapeHtml(status.functionExtractionFailed ?? 0)}</div>
    <div><strong>Function store insertions succeeded (cumulative):</strong> ${escapeHtml(status.functionStoreInsertionSucceededCount ?? 0)}</div>
    <div><strong>Function store insertions failed (cumulative):</strong> ${escapeHtml(status.functionStoreInsertionFailedCount ?? 0)}</div>
    <div><strong>Functions dropped (cumulative):</strong> ${escapeHtml(status.functionDroppedCount ?? 0)}</div>
    <div><strong>Runtime epoch \u2014 kernel ID (hashed):</strong> <code>${escapeHtml(
      status.currentKernelId ? status.currentKernelId.slice(0, 12) + "\u2026" : "none"
    )}</code></div>
    <div><strong>Kernel epoch changes (reconnects/replacements):</strong> ${escapeHtml(status.kernelEpochChanges ?? 0)}</div>
    <div><strong>Last kernel restart observed:</strong> ${escapeHtml(status.lastKernelRestartAt ?? "none")}</div>
    <div><strong>Current tab supported:</strong> ${tabSupported ? "Yes" : "No"}</div>
  `;
  };
  var renderOverview = (latestMeaningfulExecution, latestEgressExecution, diagnostics) => {
    const container = document.getElementById("semantic-overview");
    if (!container) {
      return;
    }
    if (!latestMeaningfulExecution) {
      container.innerHTML = '<span class="muted">No meaningful semantic execution event observed yet.</span>';
      return;
    }
    const recogniser = latestMeaningfulExecution.recogniserFindings?.[0]?.recogniserId ?? "none";
    const riskScore = latestMeaningfulExecution.riskScore?.total ?? 0;
    const capabilities = latestMeaningfulExecution.detectedCapabilities ?? [];
    const crossings = latestMeaningfulExecution.trustBoundaryCrossings ?? [];
    const timeline = latestMeaningfulExecution.timeline ?? [];
    const factors = (latestMeaningfulExecution.riskScore?.factors ?? []).filter((factor) => factor.detected).map((factor) => `<li>${escapeHtml(factor.title)} (+${factor.score})</li>`).join("");
    const codeLength = Number(latestMeaningfulExecution.metadata?.jupyterCodeLength ?? 0);
    const codeHash = String(latestMeaningfulExecution.metadata?.jupyterCodeHash ?? "none");
    const confidence = latestMeaningfulExecution.delegatedExecutionEvent?.confidence ?? 0;
    const egressPotential = latestMeaningfulExecution.delegatedExecutionEvent?.outboundCapabilityDetected === true;
    const executionPlatform = latestMeaningfulExecution.delegatedExecutionEvent?.executionPlatform ?? "unknown";
    const knownSymbolInvoked = latestMeaningfulExecution.delegatedExecutionEvent?.knownSymbolInvoked ?? "unknown";
    const inheritedCapabilities = latestMeaningfulExecution.delegatedExecutionEvent?.inheritedCapabilities ?? [];
    const evidenceSummary = latestMeaningfulExecution.evidenceSummary ?? [];
    const downstreamActivity = latestMeaningfulExecution.delegatedExecutionEvent?.downstreamActivityObserved ?? "unknown";
    const resolutionFailureReason = String(latestMeaningfulExecution.metadata?.semanticResolutionFailureReason ?? "none");
    const resolutionResult = knownSymbolInvoked !== "unknown" ? "Resolved" : resolutionFailureReason !== "none" ? "Failed" : "Unknown";
    const argumentProvenance = String(latestMeaningfulExecution.metadata?.semanticArgumentProvenance ?? "none").split(",").map((value) => value.trim()).filter((value) => value.length > 0 && value !== "none");
    const sessionHash = String(latestMeaningfulExecution.metadata?.semanticContextKeyHash ?? "none");
    const eventSequenceId = Number(latestMeaningfulExecution.metadata?.semanticExecutionSequenceId ?? 0);
    const latestEgressTitle = latestEgressExecution ? `${new Date(latestEgressExecution.observedAt).toLocaleTimeString()} (risk ${latestEgressExecution.riskScore?.total ?? 0})` : "none";
    container.innerHTML = `
    <div><strong>Latest meaningful execution:</strong> ${escapeHtml(diagnostics?.latestMeaningfulExecutionEvent ?? "Jupyter execute_request observed")}</div>
    <div><strong>Current recogniser:</strong> ${escapeHtml(recogniser)}</div>
    <div><strong>Execution platform:</strong> ${escapeHtml(executionPlatform)}</div>
    <div><strong>Known symbol invoked:</strong> ${escapeHtml(knownSymbolInvoked)}</div>
    <div><strong>Symbol resolution:</strong> ${escapeHtml(resolutionResult)}</div>
    <div><strong>Resolution failure reason:</strong> ${escapeHtml(resolutionFailureReason)}</div>
    <div><strong>Capabilities inherited from prior definition:</strong> ${inheritedCapabilities.length ? inheritedCapabilities.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("") : '<span class="muted">none</span>'}</div>
    <div><strong>Argument provenance:</strong> ${argumentProvenance.length ? argumentProvenance.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("") : '<span class="muted">none</span>'}</div>
    <div><strong>Session hash:</strong> <code>${escapeHtml(sessionHash)}</code></div>
    <div><strong>Event execution sequence:</strong> ${eventSequenceId} (tab context; compare with dev diagnostics to check staleness)</div>
    <div><strong>Risk score:</strong> ${riskScore}</div>
    <div><strong>Code length:</strong> ${codeLength}</div>
    <div><strong>Redacted hash:</strong> <code>${escapeHtml(codeHash)}</code></div>
    <div><strong>Delegation confidence:</strong> ${Math.round(confidence * 100)}%</div>
    <div><strong>Egress potential:</strong> ${egressPotential ? "Detected" : "Not detected"}</div>
    <div><strong>Latest egress-indicating execution:</strong> ${escapeHtml(latestEgressTitle)}</div>
    <div><strong>Downstream activity observed:</strong> ${escapeHtml(toTitleCase(downstreamActivity))}</div>
    <div><strong>Evidence summary:</strong> ${evidenceSummary.length ? `<ul>${evidenceSummary.map(
      (item) => `<li><strong>${escapeHtml(toTitleCase(item.level))}:</strong> ${escapeHtml(item.detail)}</li>`
    ).join("")}</ul>` : '<span class="muted">none</span>'}</div>
    <div><strong>Detected capabilities:</strong> ${capabilities.length ? capabilities.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("") : '<span class="muted">none</span>'}</div>
    <div><strong>Trust-boundary timeline:</strong> ${timeline.length ? `<ol>${timeline.map((item) => `<li><strong>${escapeHtml(item.title)}</strong> \u2014 ${escapeHtml(item.details)}</li>`).join("")}</ol>` : '<span class="muted">none</span>'}</div>
    <div><strong>Trust boundary crossings:</strong> ${crossings.length ? crossings.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("") : '<span class="muted">none</span>'}</div>
    <div><strong>Score factors:</strong> ${factors ? `<ul>${factors}</ul>` : '<span class="muted">none</span>'}</div>
  `;
  };
  var render = (events, diagnostics, tabSupported) => {
    const body = document.getElementById("events-body");
    if (!body) {
      return;
    }
    renderSensorStatus(diagnostics, tabSupported);
    const latestMeaningfulExecution = events.find((event) => isMeaningfulExecutionEvent(event));
    const latestEgressExecution = events.find((event) => isEgressIndicativeExecutionEvent(event));
    renderOverview(latestMeaningfulExecution, latestEgressExecution, diagnostics);
    const visibleEvents = showAllTelemetry ? events : events.filter((event) => (event.riskFlags?.length ?? 0) > 0);
    const count = document.getElementById("event-count");
    if (count) {
      count.textContent = showAllTelemetry ? `Showing all ${events.length} events` : `Showing ${visibleEvents.length} semantic events (${events.length} total)`;
    }
    if (!Array.isArray(visibleEvents) || visibleEvents.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No events observed yet.</td></tr>';
      return;
    }
    body.innerHTML = visibleEvents.map(
      (event) => `
        <tr>
          <td>${escapeHtml(new Date(event.observedAt).toLocaleTimeString())}</td>
          <td>${escapeHtml(event.api)}</td>
          <td>${escapeHtml(event.destination?.host ?? "unknown")}</td>
          <td>${escapeHtml((event.classification?.categories ?? []).join(", ") || "unknown")}</td>
          <td>${escapeHtml((event.riskFlags ?? []).join(", ") || "-")}</td>
          <td>${escapeHtml(event.context?.url ?? "-")}</td>
        </tr>
      `
    ).join("");
  };
  var refresh = async () => {
    const runtime = getRuntime();
    const currentTab = await getCurrentTab();
    const supported = isTabSupported(currentTab);
    if (!runtime?.sendMessage) {
      render([], void 0, supported);
      return;
    }
    runtime.sendMessage({ type: "wireshadow-panel-get-events", tabId: currentTab?.id }, (response) => {
      const payload = response?.payload;
      render(payload?.events ?? [], payload?.diagnostics, supported);
    });
  };
  var attachFilters = () => {
    const toggle = document.getElementById("show-all-events");
    if (!toggle) {
      return;
    }
    toggle.addEventListener("change", (event) => {
      const target = event.target;
      showAllTelemetry = target.checked;
      void refresh();
    });
  };
  attachFilters();
  void refresh();
  setInterval(() => {
    void refresh();
  }, 1500);
})();
