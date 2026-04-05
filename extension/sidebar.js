// Sidebar state
let sidebarOpen = false;
let sidebarElement = null;
let toggleButton = null;
let currentUrl = window.location.href;
let currentHostname = window.location.hostname;
let isInMeeting = /[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}/i.test(currentUrl);

// Create the sidebar HTML
function createSidebar() {
  const sidebar = document.createElement("div");
  sidebar.id = "meet-transcriber-sidebar";
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">inVision U</div>
        <div class="sidebar-brand-meta">интервью-ассистент</div>
      </div>
      <button class="sidebar-close-btn" id="sidebar-close">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="sidebar-content">
      <section class="sidebar-section">
        <div class="sidebar-section-head">
          <span class="sidebar-section-index">01</span>
          <h2 class="sidebar-section-title">Запись</h2>
        </div>
        <div class="sidebar-controls">
          <button class="sidebar-btn mic" id="sidebar-enable-mic">
            <span class="sidebar-btn-label">Включить микрофон</span>
            <span class="sidebar-btn-note">Разрешите доступ для записи звука</span>
          </button>
          <button class="sidebar-btn start" id="sidebar-start-rec">
            <span class="sidebar-btn-label">Начать запись</span>
            <span class="sidebar-btn-note">Записать аудио с Google Meet</span>
          </button>
          <button class="sidebar-btn stop" id="sidebar-stop-rec" disabled>
            <span class="sidebar-btn-label">Остановить и создать отчёт</span>
            <span class="sidebar-btn-note">Загрузить запись и получить вопросы</span>
          </button>
        </div>
      </section>

      <section class="sidebar-section sidebar-status">
        <div class="sidebar-status-chip">
          <span class="sidebar-status-dot"></span>
          <span>Статус</span>
        </div>
        <p class="sidebar-status-text" id="sidebar-status">Запись не активна</p>
      </section>

      <section class="sidebar-section">
        <div class="sidebar-section-head">
          <span class="sidebar-section-index">02</span>
          <h2 class="sidebar-section-title">Отчёт рекрутера</h2>
        </div>

        <div class="sidebar-empty" id="sidebar-empty">
          <p class="sidebar-empty-title">Отчёта пока нет</p>
          <p class="sidebar-empty-copy">После записи встречи здесь появятся выводы, вопросы и следующие шаги.</p>
        </div>

        <div class="sidebar-results hidden" id="sidebar-results">
          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Профиль кандидата</div>
            <ul class="sidebar-list" id="sidebar-snapshot"></ul>
          </div>

          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Вопросы для интервью</div>
            <div class="sidebar-questions" id="sidebar-questions"></div>
          </div>

          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Что уточнить</div>
            <ul class="sidebar-list" id="sidebar-signals"></ul>
          </div>

          <details class="sidebar-details">
            <summary>Детали сессии</summary>
            <pre id="sidebar-meta"></pre>
          </details>
        </div>
      </section>
    </div>
  `;
  return sidebar;
}

// Create toggle button
function createToggleButton() {
  const btn = document.createElement("button");
  btn.id = "meet-transcriber-toggle";
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="2" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <line x1="12" y1="2" x2="12" y2="16" stroke="currentColor" stroke-width="1.5"/>
    </svg>
    <span>Transcriber</span>
  `;
  return btn;
}

// Inject sidebar into the page - CSS only, JS already loaded via manifest
function injectSidebar() {
  console.log("[Meet Transcriber] Starting sidebar injection...");
  console.log("[Meet Transcriber] Full URL:", window.location.href);
  console.log("[Meet Transcriber] Has chrome.runtime:", !!chrome.runtime);
  console.log("[Meet Transcriber] Hostname:", window.location.hostname);
  
  // Check if we're actually on Google Meet
  const isMeetPage = window.location.hostname === "meet.google.com" || 
                     window.location.href.includes("meet.google.com");
  console.log("[Meet Transcriber] Is meet.google.com:", isMeetPage);
  
  if (!isMeetPage) {
    console.log("[Meet Transcriber] Not on Google Meet, not injecting sidebar");
    return;
  }
  
  // Check if in an actual meeting
  const hasMeetingCode = /[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}/i.test(window.location.href);
  console.log("[Meet Transcriber] Has meeting code:", hasMeetingCode, "URL:", window.location.href);
  
  if (!hasMeetingCode) {
    console.log("[Meet Transcriber] On Meet landing page (not in a meeting), injecting sidebar with warning");
  }
  
  // Wait for Google Meet to load
  const checkInterval = setInterval(() => {
    const meetRoot = document.querySelector('[role="main"]') || document.body;
    
    if (meetRoot) {
      clearInterval(checkInterval);
      
      console.log("[Meet Transcriber] Found meet root, injecting sidebar");
      
      // Create toggle button
      toggleButton = createToggleButton();
      document.body.appendChild(toggleButton);
      
      // Create sidebar
      sidebarElement = createSidebar();
      document.body.appendChild(sidebarElement);
      
      // Add event listeners
      setupEventListeners();
      
      console.log("[Meet Transcriber] Sidebar injected successfully");
    }
  }, 500);
}

// Setup event listeners
function setupEventListeners() {
  // Toggle button
  toggleButton.addEventListener("click", () => {
    sidebarOpen = !sidebarOpen;
    sidebarElement.classList.toggle("open", sidebarOpen);
    toggleButton.classList.toggle("active", sidebarOpen);
  });

  // Close button
  document.getElementById("sidebar-close")?.addEventListener("click", () => {
    sidebarOpen = false;
    sidebarElement.classList.remove("open");
    toggleButton.classList.remove("active");
  });

  // Control buttons — send messages to background via popup
  document.getElementById("sidebar-enable-mic")?.addEventListener("click", async () => {
    const btn = document.getElementById("sidebar-enable-mic");
    
    try {
      if ("permissions" in navigator) {
        const permission = await navigator.permissions.query({ name: "microphone" });
        
        if (permission.state === "granted") {
          updateStatus("Микрофон уже включён", "success");
          btn.querySelector(".sidebar-btn-label").textContent = "Микрофон включён";
          btn.querySelector(".sidebar-btn-note").textContent = "Запись звука активна";
          btn.disabled = true;
          return;
        }
        
        if (permission.state === "denied") {
          updateStatus("Микрофон заблокирован. Разрешите в настройках браузера.", "error");
          return;
        }
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      
      updateStatus("Микрофон включён!", "success");
      btn.querySelector(".sidebar-btn-label").textContent = "Микрофон включён";
      btn.querySelector(".sidebar-btn-note").textContent = "Запись звука активна";
      btn.disabled = true;
    } catch (error) {
      if (error.name === "NotAllowedError") {
        updateStatus("Доступ к микрофону запрещён. Разрешите доступ.", "error");
      } else if (error.name === "NotFoundError") {
        updateStatus("Микрофон не найден на устройстве.", "error");
      } else {
        updateStatus(`Ошибка: ${error.message}`, "error");
      }
    }
  });

  document.getElementById("sidebar-start-rec")?.addEventListener("click", async () => {
    if (!isInMeeting) {
      updateStatus("Войдите в звонок Google Meet для записи", "warning");
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({ type: "START_RECORDING" });
      if (!response?.ok) throw new Error(response?.error || "Не удалось начать запись");
      
      updateUI(true);
      updateStatus("Запись Google Meet...", "active");
      document.getElementById("sidebar-empty").classList.add("hidden");
      document.getElementById("sidebar-results").classList.remove("hidden");
    } catch (error) {
      updateStatus(`Ошибка: ${error.message}`, "error");
    }
  });

  document.getElementById("sidebar-stop-rec")?.addEventListener("click", async () => {
    console.log("[Sidebar] === STOP BUTTON CLICKED ===");
    
    try {
      console.log("[Sidebar] Sending STOP_RECORDING to background");
      const response = await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
      console.log("[Sidebar] STOP response:", response);
      
      if (!response?.ok) throw new Error(response?.error || "Не удалось остановить");
      updateStatus("Обработка аудио и создание отчёта...", "warning");
    } catch (error) {
      console.error("[Sidebar] Stop error:", error);
      updateStatus(`Ошибка: ${error.message}`, "error");
    }
  });
}

// Update UI based on recording state
function updateUI(recording) {
  const startBtn = document.getElementById("sidebar-start-rec");
  const stopBtn = document.getElementById("sidebar-stop-rec");
  
  if (startBtn) startBtn.disabled = recording;
  if (stopBtn) stopBtn.disabled = !recording;
}

// Update status text
function updateStatus(text, tone = "idle") {
  const statusEl = document.getElementById("sidebar-status");
  const dotEl = document.querySelector(".sidebar-status-dot");
  
  if (statusEl) statusEl.textContent = text;
  if (dotEl) {
    const colors = {
      idle: "#111111",
      active: "#d3ff12",
      warning: "#f0a83a",
      error: "#ff5b43",
      success: "#34a853"
    };
    dotEl.style.backgroundColor = colors[tone] || colors.idle;
  }
}

// Parse summary text
function parseSummary(summaryText) {
  const result = {
    snapshot: [],
    questions: [],
    signals: [],
    raw: summaryText
  };

  console.log("[Sidebar] Raw summary:", summaryText);

  const lines = summaryText.split(/\r?\n/);
  let section = "";
  let currentQuestion = null;

  function flushQuestion() {
    if (!currentQuestion) return;
    
    currentQuestion.text = currentQuestion.text.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
    currentQuestion.whyAsk = currentQuestion.whyAsk.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
    currentQuestion.listenFor = currentQuestion.listenFor.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
    
    if (currentQuestion.text && currentQuestion.text.length > 10) {
      console.log("[Sidebar] Flushed question:", currentQuestion);
      result.questions.push(currentQuestion);
    }
    currentQuestion = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    
    // Remove ** and * markers for detection
    const cleanLine = line.replace(/\*\*/g, "").replace(/\*/g, "");
    
    // Detect sections
    if (/candidate snapshot/i.test(cleanLine)) {
      flushQuestion();
      section = "snapshot";
      continue;
    }

    if (/follow-up questions/i.test(cleanLine)) {
      flushQuestion();
      section = "questions";
      continue;
    }

    if (/signals to explore/i.test(cleanLine)) {
      flushQuestion();
      section = "signals";
      continue;
    }
    
    // Skip section headers
    if (section === "" && !/snapshot|questions|signals/i.test(cleanLine)) {
      // Skip lines that look like headers or instructions
      if (cleanLine.length < 50) continue;
    }

    if (section === "snapshot") {
      const bulletMatch = line.match(/^[-•*]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/);
      if (bulletMatch) {
        const text = bulletMatch[1].replace(/\*\*/g, "").trim();
        if (text && text.length > 5) {
          result.snapshot.push(text);
        }
      }
      continue;
    }

    if (section === "signals") {
      const bulletMatch = line.match(/^[-•*]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/);
      if (bulletMatch) {
        const text = bulletMatch[1].replace(/\*\*/g, "").trim();
        if (text && text.length > 5) {
          result.signals.push(text);
        }
      }
      continue;
    }

    if (section === "questions") {
      // Detect question start: "1. Question: ..." or "1. **Question**: ..." or just "1. **text**"
      const questionMatch = cleanLine.match(/^\d+\.\s*question[:\s]\s*(.+)/i) || 
                            line.match(/^\d+\.\s+\*\*question[:\s]\s*\*\*(.+)/i) ||
                            line.match(/^\d+\.\s+\*\*(.+?)\*\*/i);
      
      if (questionMatch) {
        flushQuestion();
        const text = (questionMatch[1] || cleanLine.replace(/^\d+\.\s*/,"")).replace(/\*\*/g, "").trim();
        currentQuestion = { text, whyAsk: "", listenFor: "" };
        continue;
      }

      // Detect Why ask
      const whyMatch = cleanLine.match(/why ask[:\s]\s*(.+)/i);
      if (whyMatch && currentQuestion) {
        currentQuestion.whyAsk = whyMatch[1].replace(/\*\*/g, "").trim();
        continue;
      }

      // Detect Listen for
      const listenMatch = cleanLine.match(/listen for[:\s]\s*(.+)/i);
      if (listenMatch && currentQuestion) {
        currentQuestion.listenFor = listenMatch[1].replace(/\*\*/g, "").trim();
        continue;
      }

      // If we have a current question and this doesn't look like a new section, append to question
      if (currentQuestion && !/^[-•*]\s+\d+\./.test(line) && !/^(candidate|follow-up|signals)/i.test(cleanLine)) {
        currentQuestion.text = currentQuestion.text + " " + cleanLine.replace(/\*\*/g, "");
      }
    }
  }

  flushQuestion();
  
  console.log("[Sidebar] Parsed summary:", {
    snapshotCount: result.snapshot.length,
    questionCount: result.questions.length,
    signalCount: result.signals.length,
    questions: result.questions
  });
  
  return result;
}

// Remove markdown formatting
function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // **bold**
    .replace(/\*(.+?)\*/g, "$1")      // *italic*
    .replace(/__(.+?)__/g, "$1")      // __bold__
    .replace(/_(.+?)_/g, "$1")        // _italic_
    .replace(/`(.+?)`/g, "$1")        // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // [link](url)
    .replace(/^#+\s*/gm, "")          // headers
    .replace(/^[-*]\s+/gm, "")        // list items
    .replace(/^\d+\.\s+/gm, "")       // numbered lists
    .trim();
}

// Clear node
function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

// Render list
function renderSidebarList(node, items) {
  clearNode(node);
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = stripMarkdown(item);
    node.appendChild(li);
  }
}

// Create question card
function createQuestionCard(question, index) {
  const card = document.createElement("div");
  card.className = "sidebar-question-card";
  
  const questionText = document.createElement("p");
  questionText.className = "sidebar-question-text";
  questionText.textContent = stripMarkdown(question.text);
  
  card.appendChild(questionText);
  
  if (question.whyAsk || question.listenFor) {
    const meta = document.createElement("div");
    meta.className = "sidebar-question-meta";
    
    if (question.whyAsk) {
      const whyRow = document.createElement("div");
      whyRow.className = "sidebar-meta-row";
      
      const whyLabel = document.createElement("span");
      whyLabel.className = "sidebar-meta-label";
      whyLabel.textContent = "Зачем: ";
      
      const whyValue = document.createElement("span");
      whyValue.className = "sidebar-meta-value";
      whyValue.textContent = stripMarkdown(question.whyAsk);
      
      whyRow.appendChild(whyLabel);
      whyRow.appendChild(whyValue);
      meta.appendChild(whyRow);
    }
    
    if (question.listenFor) {
      const listenRow = document.createElement("div");
      listenRow.className = "sidebar-meta-row";
      
      const listenLabel = document.createElement("span");
      listenLabel.className = "sidebar-meta-label";
      listenLabel.textContent = "Слушать: ";
      
      const listenValue = document.createElement("span");
      listenValue.className = "sidebar-meta-value";
      listenValue.textContent = stripMarkdown(question.listenFor);
      
      listenRow.appendChild(listenLabel);
      listenRow.appendChild(listenValue);
      meta.appendChild(listenRow);
    }
    
    card.appendChild(meta);
  }
  
  return card;
}

// Render questions
function renderQuestions(questions) {
  const container = document.getElementById("sidebar-questions");
  if (!container) return;
  
  clearNode(container);
  
  for (const [index, question] of questions.entries()) {
    container.appendChild(createQuestionCard(question, index));
  }
}

// Render result
function renderResult(result) {
  const emptyEl = document.getElementById("sidebar-empty");
  const resultsEl = document.getElementById("sidebar-results");
  const snapshotEl = document.getElementById("sidebar-snapshot");
  const signalsEl = document.getElementById("sidebar-signals");
  const metaEl = document.getElementById("sidebar-meta");
  
  console.log("[Sidebar] renderResult:", result);
  console.log("[Sidebar] raw summary:", result.summary);
  
  if (!emptyEl || !resultsEl) return;
  
  emptyEl.classList.add("hidden");
  resultsEl.classList.remove("hidden");
  
  if (result.summary_status !== "completed" || !result.summary) {
    renderSidebarList(snapshotEl, ["Запись сохранена", "ИИ не смог создать отчёт"]);
    renderQuestions([{
      text: result.summary_error || "Не удалось создать отчёт",
      whyAsk: "Проверьте статус backend или попробуйте ещё раз",
      listenFor: ""
    }]);
    renderSidebarList(signalsEl, ["Перезапустите backend и попробуйте снова"]);
    if (metaEl) metaEl.textContent = JSON.stringify(result, null, 2);
    return;
  }
  
  const parsed = parseSummary(result.summary);
  console.log("[Sidebar] Parsed:", parsed);
  
  renderSidebarList(snapshotEl, parsed.snapshot.length ? parsed.snapshot : ["ИИ вернул отчёт, но профиль пуст"]);
  renderQuestions(parsed.questions.length ? parsed.questions : [{ text: result.summary, whyAsk: "Сырой ответ ИИ", listenFor: "" }]);
  renderSidebarList(signalsEl, parsed.signals.length ? parsed.signals : ["Нет явных следующих шагов"]);
  
  if (metaEl) {
    metaEl.textContent = `РАСПАРСЕННЫЙ ОТЧЁТ:
Профиль: ${parsed.snapshot.length} пунктов
Вопросы: ${parsed.questions.length} пунктов
Сигналы: ${parsed.signals.length} пунктов

СЫРОЙ ОТВЕТ ИИ:
${result.summary}`;
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sidebar] ═══════════════════════════════════════");
  console.log("[Sidebar] === MESSAGE RECEIVED ===");
  console.log("[Sidebar] Message type:", message?.type);
  console.log("[Sidebar] Message status:", message?.status);
  console.log("[Sidebar] Full message:", JSON.stringify(message).substring(0, 500));
  console.log("[Sidebar] ═══════════════════════════════════════");
  
  if (message.type === "open-sidebar") {
    console.log("[Sidebar] Opening sidebar");
    if (!sidebarOpen) {
      sidebarOpen = true;
      sidebarElement.classList.add("open");
      toggleButton.classList.add("active");
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "RECORDING_STATE") {
    console.log("[Sidebar] Recording state:", message.recording);
    updateUI(!!message.recording);
    if (message.recording) {
      updateStatus("Запись Google Meet...", "active");
    } else {
      updateStatus("Запись не активна", "idle");
    }
    sendResponse({ received: true });
    return true;
  }

  if (message.type === "RECORDING_RESULT") {
    console.log("[Sidebar] ═══ RECORDING RESULT RECEIVED ═══");
    console.log("[Sidebar] Status:", message.status);
    console.log("[Sidebar] Has result:", !!message.result);
    
    if (message.status === "uploaded") {
      console.log("[Sidebar] Result object:", message.result);
      console.log("[Sidebar] Has summary:", !!message.result?.summary);
      updateStatus("Отчёт готов!", "success");
      console.log("[Sidebar] Calling renderResult...");
      try {
        renderResult(message.result);
        console.log("[Sidebar] renderResult completed");
      } catch (renderError) {
        console.error("[Sidebar] renderResult error:", renderError);
        updateStatus("Ошибка отображения", "error");
      }
    } else if (message.status === "stopping") {
      updateStatus("Обработка аудио...", "warning");
    } else if (message.status === "failed") {
      updateStatus(`Ошибка: ${message.error || "неизвестная"}`, "error");
    }
    sendResponse({ received: true });
    return true;
  }
  
  console.log("[Sidebar] Message not handled");
  sendResponse({ received: false });
  return true;
});

// Initialize
injectSidebar();

// Confirm sidebar loaded
console.log("[Sidebar] ═══════════════════════════════════════");
console.log("[Sidebar] SIDEBAR LOADED v2.0");
console.log("[Sidebar] URL:", window.location.href);
console.log("[Sidebar] hostname:", window.location.hostname);
console.log("[Sidebar] isInMeeting:", isInMeeting);
console.log("[Sidebar] ═══════════════════════════════════════");

// Test message listener
setTimeout(() => {
  console.log("[Sidebar] Testing message listener...");
  chrome.runtime.sendMessage({ type: "TEST_SIDEBAR" }, (response) => {
    console.log("[Sidebar] Test response:", response);
  });
}, 2000);

// Check microphone permission on load
async function checkMicPermission() {
  try {
    if ("permissions" in navigator) {
      const permission = await navigator.permissions.query({ name: "microphone" });
      
      const updateMicButton = () => {
        const btn = document.getElementById("sidebar-enable-mic");
        if (!btn) return;
        
        if (permission.state === "granted") {
          btn.querySelector(".sidebar-btn-label").textContent = "Микрофон включён";
          btn.querySelector(".sidebar-btn-note").textContent = "Запись звука активна";
          btn.disabled = true;
        } else if (permission.state === "denied") {
          btn.querySelector(".sidebar-btn-label").textContent = "Микрофон заблокирован";
          btn.querySelector(".sidebar-btn-note").textContent = "Разрешите в настройках браузера";
        }
      };
      
      updateMicButton();
      permission.onchange = updateMicButton;
    }
  } catch (error) {
    console.log("[Sidebar] Не удалось проверить разрешение микрофона:", error);
  }
}

// Show warning if not in a meeting
function checkMeetingStatus() {
  if (!isInMeeting) {
    updateStatus("⚠️ Войдите в звонок", "warning");
    
    const warning = document.createElement("div");
    warning.className = "sidebar-warning";
    warning.innerHTML = `
      <strong>Вы не в звонке</strong>
      <p>Запись работает только в активном звонке Google Meet.<br>
      URL должен быть: <code>meet.google.com/abc-defg-hij</code></p>
    `;
    
    const content = document.querySelector(".sidebar-content");
    if (content) {
      content.insertBefore(warning, content.firstChild);
    }
  }
}

// Run check after sidebar is injected
setTimeout(checkMicPermission, 1000);
setTimeout(checkMeetingStatus, 1500);
