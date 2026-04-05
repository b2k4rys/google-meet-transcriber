const micButton = document.getElementById("enable-mic");
const startButton = document.getElementById("start-rec");
const stopButton = document.getElementById("stop-rec");
const copyAllButton = document.getElementById("copy-all");
const openSidebarButton = document.getElementById("open-sidebar");
const statusText = document.getElementById("status");
const statusDot = document.querySelector(".status-dot");
const emptyState = document.getElementById("empty-state");
const analysisGrid = document.getElementById("analysis-grid");
const snapshotList = document.getElementById("snapshot-list");
const questionsList = document.getElementById("questions-list");
const signalsList = document.getElementById("signals-list");
const resultMeta = document.getElementById("result-meta");
const debugOutput = document.getElementById("debug-output");

const statusColors = {
  idle: "#111111",
  active: "#d3ff12",
  warning: "#f0a83a",
  error: "#ff5b43",
  success: "#34a853"
};

const uiState = {
  latestQuestions: [],
  debugLines: [],
  hasRenderedResult: false,
  awaitingFinalResult: false
};

function setUi(recording) {
  startButton.disabled = recording;
  stopButton.disabled = !recording;
}

function setStatus(text, tone = "idle") {
  statusText.textContent = text;
  statusDot.style.backgroundColor = statusColors[tone] || statusColors.idle;
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function stripListMarker(line) {
  return normalizeWhitespace(line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, ""));
}

function parseSummary(summaryText) {
  const result = {
    snapshot: [],
    questions: [],
    signals: [],
    raw: summaryText
  };

  const lines = summaryText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let section = "";
  let currentQuestion = null;

  function flushQuestion() {
    if (!currentQuestion) {
      return;
    }

    currentQuestion.text = normalizeWhitespace(currentQuestion.text || "");
    currentQuestion.whyAsk = normalizeWhitespace(currentQuestion.whyAsk || "");
    currentQuestion.listenFor = normalizeWhitespace(currentQuestion.listenFor || "");

    if (currentQuestion.text) {
      result.questions.push(currentQuestion);
    }

    currentQuestion = null;
  }

  for (const line of lines) {
    if (/^Candidate Snapshot:/i.test(line)) {
      flushQuestion();
      section = "snapshot";
      continue;
    }

    if (/^Follow-up Questions:/i.test(line)) {
      flushQuestion();
      section = "questions";
      continue;
    }

    if (/^Signals To Explore:/i.test(line)) {
      flushQuestion();
      section = "signals";
      continue;
    }

    if (section === "snapshot") {
      if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        result.snapshot.push(stripListMarker(line));
      } else if (result.snapshot.length) {
        result.snapshot[result.snapshot.length - 1] = normalizeWhitespace(`${result.snapshot[result.snapshot.length - 1]} ${line}`);
      }
      continue;
    }

    if (section === "signals") {
      if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        result.signals.push(stripListMarker(line));
      } else if (result.signals.length) {
        result.signals[result.signals.length - 1] = normalizeWhitespace(`${result.signals[result.signals.length - 1]} ${line}`);
      }
      continue;
    }

    if (section === "questions") {
      if (/^\d+\.\s+Question:/i.test(line) || /^Question:/i.test(line)) {
        flushQuestion();
        currentQuestion = {
          text: line.replace(/^\d+\.\s+Question:\s*/i, "").replace(/^Question:\s*/i, ""),
          whyAsk: "",
          listenFor: ""
        };
        continue;
      }

      if (/^\d+\.\s+/.test(line) || /^[-*•]\s+/.test(line)) {
        flushQuestion();
        currentQuestion = {
          text: stripListMarker(line).replace(/^Question:\s*/i, ""),
          whyAsk: "",
          listenFor: ""
        };
        continue;
      }

      if (/^Why ask:/i.test(line)) {
        currentQuestion ??= { text: "", whyAsk: "", listenFor: "" };
        currentQuestion.whyAsk = line.replace(/^Why ask:\s*/i, "");
        continue;
      }

      if (/^Listen for:/i.test(line)) {
        currentQuestion ??= { text: "", whyAsk: "", listenFor: "" };
        currentQuestion.listenFor = line.replace(/^Listen for:\s*/i, "");
        continue;
      }

      if (currentQuestion) {
        currentQuestion.text = `${currentQuestion.text} ${line}`;
      }
    }
  }

  flushQuestion();
  return result;
}

function renderList(node, items) {
  clearNode(node);

  for (const item of items) {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    node.appendChild(listItem);
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch {
    setStatus("Copy failed. Clipboard access is unavailable.", "warning");
  }
}

function createQuestionCard(question, index) {
  const card = document.createElement("article");
  card.className = "question-card";

  const head = document.createElement("div");
  head.className = "question-head";

  const badge = document.createElement("div");
  badge.className = "question-index";
  badge.textContent = `Q${String(index + 1).padStart(2, "0")}`;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "question-copy";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", () => {
    void copyText(question.text, copyButton);
  });

  head.appendChild(badge);
  head.appendChild(copyButton);

  const questionText = document.createElement("p");
  questionText.className = "question-text";
  questionText.textContent = question.text;

  card.appendChild(head);
  card.appendChild(questionText);

  if (question.whyAsk || question.listenFor) {
    const meta = document.createElement("div");
    meta.className = "question-meta";

    if (question.whyAsk) {
      const whyRow = document.createElement("div");
      whyRow.className = "meta-row";

      const whyLabel = document.createElement("div");
      whyLabel.className = "meta-label";
      whyLabel.textContent = "Why ask";

      const whyValue = document.createElement("p");
      whyValue.className = "meta-value";
      whyValue.textContent = question.whyAsk;

      whyRow.appendChild(whyLabel);
      whyRow.appendChild(whyValue);
      meta.appendChild(whyRow);
    }

    if (question.listenFor) {
      const listenRow = document.createElement("div");
      listenRow.className = "meta-row";

      const listenLabel = document.createElement("div");
      listenLabel.className = "meta-label";
      listenLabel.textContent = "Listen for";

      const listenValue = document.createElement("p");
      listenValue.className = "meta-value";
      listenValue.textContent = question.listenFor;

      listenRow.appendChild(listenLabel);
      listenRow.appendChild(listenValue);
      meta.appendChild(listenRow);
    }

    card.appendChild(meta);
  }

  return card;
}

function renderQuestions(questions) {
  clearNode(questionsList);
  uiState.latestQuestions = questions.map(question => question.text).filter(Boolean);
  copyAllButton.disabled = uiState.latestQuestions.length === 0;

  for (const [index, question] of questions.entries()) {
    questionsList.appendChild(createQuestionCard(question, index));
  }
}

function renderFallbackQuestion(summary) {
  renderQuestions([
    {
      text: summary,
      whyAsk: "Gemini did not return the expected recruiter structure, so the raw analysis is shown here.",
      listenFor: ""
    }
  ]);
}

function showAnalysis() {
  emptyState.classList.add("hidden");
  analysisGrid.classList.remove("hidden");
}

function showEmptyState() {
  analysisGrid.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

function renderResult(result) {
  showAnalysis();
  resultMeta.textContent = JSON.stringify(result, null, 2);

  if (result.summary_status !== "completed" || !result.summary) {
    renderList(snapshotList, [
      "The recording was uploaded and saved successfully.",
      "Gemini could not generate a recruiter brief for this session."
    ]);
    renderQuestions([
      {
        text: result.summary_error || "Summary generation failed.",
        whyAsk: "Check the backend status or try another upload after verifying the audio format and Gemini response.",
        listenFor: ""
      }
    ]);
    renderList(signalsList, [
      "Retry after restarting the backend if the failure looks transient.",
      "Inspect the session details panel for the exact Gemini error."
    ]);
    return;
  }

  const parsed = parseSummary(result.summary);
  renderList(snapshotList, parsed.snapshot.length ? parsed.snapshot : ["Gemini returned a summary, but the candidate snapshot section was empty."]);

  if (parsed.questions.length) {
    renderQuestions(parsed.questions);
  } else {
    renderFallbackQuestion(result.summary);
  }

  renderList(signalsList, parsed.signals.length ? parsed.signals : ["No explicit next-step signals were extracted from the conversation."]);
}

function pushDebugLine(line) {
  uiState.debugLines.push(line);
  uiState.debugLines = uiState.debugLines.slice(-18);
  debugOutput.textContent = uiState.debugLines.join("\n");
}

async function refreshMicButton() {
  if (!("permissions" in navigator)) {
    return;
  }

  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    const update = () => {
      if (permission.state === "granted") {
        micButton.querySelector(".control-label").textContent = "Microphone Enabled";
        micButton.querySelector(".control-note").textContent = "Your voice can be mixed into recruiter review recordings.";
        micButton.disabled = true;
        return;
      }

      if (permission.state === "denied") {
        micButton.querySelector(".control-label").textContent = "Microphone Blocked";
        micButton.querySelector(".control-note").textContent = "Open the permission page and allow microphone access for the extension.";
        micButton.disabled = false;
        return;
      }

      micButton.querySelector(".control-label").textContent = "Enable Microphone";
      micButton.querySelector(".control-note").textContent = "Prime mic access once so both voices are captured clearly.";
      micButton.disabled = false;
    };

    update();
    permission.onchange = update;
  } catch {}
}

async function openMicSetupTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("micsetup.html") });
}

copyAllButton.addEventListener("click", () => {
  const joinedQuestions = uiState.latestQuestions.join("\n\n");
  if (!joinedQuestions) {
    return;
  }

  void copyText(joinedQuestions, copyAllButton);
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "RECORDING_STATE") {
    setUi(!!message.recording);
    if (message.recording) {
      setStatus("Recording current Google Meet audio...", "active");
    } else if (!uiState.awaitingFinalResult && !uiState.hasRenderedResult) {
      setStatus("Recorder is idle.", "idle");
    }
    return;
  }

  if (message?.type === "RECORDING_RESULT") {
    if (message.status === "uploaded") {
      uiState.awaitingFinalResult = false;
      uiState.hasRenderedResult = true;
      setStatus("Recruiter brief generated from the interview.", "success");
      renderResult(message.result);
    } else if (message.status === "stopping") {
      uiState.awaitingFinalResult = true;
      setStatus("Stopping audio capture and generating the recruiter brief...", "warning");
    } else if (message.status === "failed") {
      uiState.awaitingFinalResult = false;
      uiState.hasRenderedResult = true;
      setStatus(`Recording failed: ${message.error || "unknown error"}`, "error");
    }

    if (message.status !== "stopping") {
      setUi(false);
    }
    return;
  }

  if (message?.type === "RECORDING_DEBUG") {
    pushDebugLine(message.text);
    return;
  }
});

micButton.addEventListener("click", async () => {
  try {
    if ("permissions" in navigator) {
      const permission = await navigator.permissions.query({ name: "microphone" });
      if (permission.state === "granted") {
        await refreshMicButton();
        return;
      }

      if (permission.state === "denied") {
        await openMicSetupTab();
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setStatus("Microphone enabled for the extension.", "success");
      await refreshMicButton();
    } catch {
      await openMicSetupTab();
    }
  } catch (error) {
    setStatus(`Could not enable microphone: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

startButton.addEventListener("click", async () => {
  showEmptyState();
  clearNode(snapshotList);
  clearNode(questionsList);
  clearNode(signalsList);
  resultMeta.textContent = "";
  uiState.latestQuestions = [];
  uiState.hasRenderedResult = false;
  uiState.awaitingFinalResult = false;
  copyAllButton.disabled = true;
  setStatus("Starting audio recording...", "warning");

  try {
    if ("permissions" in navigator) {
      try {
        const permission = await navigator.permissions.query({ name: "microphone" });
        if (permission.state !== "granted") {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            await refreshMicButton();
          } catch {
            setStatus("Microphone not enabled, continuing with Meet tab audio only.", "warning");
          }
        }
      } catch {}
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab.");
    }

    const response = await chrome.runtime.sendMessage({ type: "START_RECORDING", tabId: tab.id });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start recording.");
    }

    setUi(true);
    setStatus("Recording current Google Meet audio...", "active");
  } catch (error) {
    setUi(false);
    setStatus(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

stopButton.addEventListener("click", async () => {
  setStatus("Stopping audio recording...", "warning");

  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop recording.");
    }
  } catch (error) {
    setUi(false);
    setStatus(`Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

openSidebarButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab.");
    }

    if (!tab.url.includes("meet.google.com")) {
      await chrome.tabs.create({ url: "https://meet.google.com/" });
      setStatus("Opened Google Meet. The sidebar will appear when you join a meeting.", "warning");
    } else {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "open-sidebar" });
        setStatus("Sidebar opened in Google Meet!", "success");
      } catch (e) {
        setStatus("Open Google Meet to use the sidebar feature.", "warning");
      }
    }
  } catch (error) {
    setStatus(`Failed to open sidebar: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

void (async () => {
  const status = await chrome.runtime.sendMessage({ type: "GET_RECORDING_STATUS" }).catch(() => null);
  setUi(!!status?.recording);
  setStatus(status?.recording ? "Recording current Google Meet audio..." : "Recorder is idle.", status?.recording ? "active" : "idle");
  copyAllButton.disabled = true;
  await refreshMicButton();
})();
