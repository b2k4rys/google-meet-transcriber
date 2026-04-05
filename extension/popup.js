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

function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();
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
    listItem.textContent = stripMarkdown(item);
    node.appendChild(listItem);
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch {
    setStatus("Не удалось скопировать", "warning");
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
  copyButton.textContent = "Копировать";
  copyButton.addEventListener("click", () => {
    void copyText(question.text, copyButton);
  });

  head.appendChild(badge);
  head.appendChild(copyButton);

  const questionText = document.createElement("p");
  questionText.className = "question-text";
  questionText.textContent = stripMarkdown(question.text);

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
      whyLabel.textContent = "Зачем";

      const whyValue = document.createElement("p");
      whyValue.className = "meta-value";
      whyValue.textContent = stripMarkdown(question.whyAsk);

      whyRow.appendChild(whyLabel);
      whyRow.appendChild(whyValue);
      meta.appendChild(whyRow);
    }

    if (question.listenFor) {
      const listenRow = document.createElement("div");
      listenRow.className = "meta-row";

      const listenLabel = document.createElement("div");
      listenLabel.className = "meta-label";
      listenLabel.textContent = "Слушать";

      const listenValue = document.createElement("p");
      listenValue.className = "meta-value";
      listenValue.textContent = stripMarkdown(question.listenFor);

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
      whyAsk: "ИИ не вернул ожидаемую структуру, показан сырой анализ.",
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
      "Запись сохранена",
      "ИИ не смог создать отчёт для этой сессии"
    ]);
    renderQuestions([
      {
        text: result.summary_error || "Не удалось создать отчёт",
        whyAsk: "Проверьте статус backend или попробуйте другую загрузку",
        listenFor: ""
      }
    ]);
    renderList(signalsList, [
      "Перезапустите backend и попробуйте снова",
      "Проверьте детали в панели «Детали сессии»"
    ]);
    return;
  }

  const parsed = parseSummary(result.summary);
  renderList(snapshotList, parsed.snapshot.length ? parsed.snapshot : ["ИИ вернул отчёт, но профиль кандидата пуст"]);

  if (parsed.questions.length) {
    renderQuestions(parsed.questions);
  } else {
    renderFallbackQuestion(result.summary);
  }

  renderList(signalsList, parsed.signals.length ? parsed.signals : ["Нет явных следующих шагов из разговора"]);
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
        micButton.querySelector(".control-label").textContent = "Микрофон включён";
        micButton.querySelector(".control-note").textContent = "Запись звука активна";
        micButton.disabled = true;
        return;
      }

      if (permission.state === "denied") {
        micButton.querySelector(".control-label").textContent = "Микрофон заблокирован";
        micButton.querySelector(".control-note").textContent = "Разрешите доступ в настройках браузера";
        micButton.disabled = false;
        return;
      }

      micButton.querySelector(".control-label").textContent = "Включить микрофон";
      micButton.querySelector(".control-note").textContent = "Разрешите доступ к микрофону для записи";
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
      setStatus("Запись Google Meet...", "active");
    } else if (!uiState.awaitingFinalResult && !uiState.hasRenderedResult) {
      setStatus("Запись не активна", "idle");
    }
    return;
  }

  if (message?.type === "RECORDING_RESULT") {
    if (message.status === "uploaded") {
      uiState.awaitingFinalResult = false;
      uiState.hasRenderedResult = true;
      setStatus("Отчёт готов!", "success");
      renderResult(message.result);
    } else if (message.status === "stopping") {
      uiState.awaitingFinalResult = true;
      setStatus("Обработка аудио и создание отчёта...", "warning");
    } else if (message.status === "failed") {
      uiState.awaitingFinalResult = false;
      uiState.hasRenderedResult = true;
      setStatus(`Ошибка: ${message.error || "неизвестная"}`, "error");
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
  setStatus("Начало записи...", "warning");

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
    setStatus("Запись Google Meet...", "active");
  } catch (error) {
    setUi(false);
    setStatus(`Ошибка записи: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

stopButton.addEventListener("click", async () => {
  setStatus("Остановка записи...", "warning");

  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop recording.");
    }
  } catch (error) {
    setUi(false);
    setStatus(`Ошибка остановки: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

openSidebarButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("Нет активной вкладки");
    }

    if (!tab.url.includes("meet.google.com")) {
      await chrome.tabs.create({ url: "https://meet.google.com/" });
      setStatus("Открыт Google Meet. Панель появится когда войдёте в звонок.", "warning");
    } else {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "open-sidebar" });
        setStatus("Боковая панель открыта!", "success");
      } catch (e) {
        setStatus("Откройте Google Meet для панели", "warning");
      }
    }
  } catch (error) {
    setStatus(`Ошибка панели: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});

void (async () => {
  const status = await chrome.runtime.sendMessage({ type: "GET_RECORDING_STATUS" }).catch(() => null);
  setUi(!!status?.recording);
  setStatus(status?.recording ? "Запись Google Meet..." : "Запись не активна", status?.recording ? "active" : "idle");
  copyAllButton.disabled = true;
  await refreshMicButton();
})();
