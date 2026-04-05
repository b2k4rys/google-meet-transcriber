// Sidebar state
let sidebarOpen = false;
let sidebarElement = null;
let toggleButton = null;

// Create the sidebar HTML
function createSidebar() {
  const sidebar = document.createElement("div");
  sidebar.id = "meet-transcriber-sidebar";
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">inVision U</div>
        <div class="sidebar-brand-meta">interview lens</div>
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
          <h2 class="sidebar-section-title">Capture</h2>
        </div>
        <div class="sidebar-controls">
          <button class="sidebar-btn mic" id="sidebar-enable-mic">
            <span class="sidebar-btn-label">Enable Microphone</span>
            <span class="sidebar-btn-note">Prime mic access for clear audio</span>
          </button>
          <button class="sidebar-btn start" id="sidebar-start-rec">
            <span class="sidebar-btn-label">Start Audio Recording</span>
            <span class="sidebar-btn-note">Begin listening to Google Meet</span>
          </button>
          <button class="sidebar-btn stop" id="sidebar-stop-rec" disabled>
            <span class="sidebar-btn-label">Stop and Generate Brief</span>
            <span class="sidebar-btn-note">Upload call and get recruiter prompts</span>
          </button>
        </div>
      </section>

      <section class="sidebar-section sidebar-status">
        <div class="sidebar-status-chip">
          <span class="sidebar-status-dot"></span>
          <span>Live status</span>
        </div>
        <p class="sidebar-status-text" id="sidebar-status">Recorder is idle.</p>
      </section>

      <section class="sidebar-section">
        <div class="sidebar-section-head">
          <span class="sidebar-section-index">02</span>
          <h2 class="sidebar-section-title">Recruiter Brief</h2>
        </div>

        <div class="sidebar-empty" id="sidebar-empty">
          <p class="sidebar-empty-title">No interview brief yet.</p>
          <p class="sidebar-empty-copy">After a recording finishes, candidate takeaways and follow-up questions will appear here.</p>
        </div>

        <div class="sidebar-results hidden" id="sidebar-results">
          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Candidate Snapshot</div>
            <ul class="sidebar-list" id="sidebar-snapshot"></ul>
          </div>

          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Follow-up Questions</div>
            <div class="sidebar-questions" id="sidebar-questions"></div>
          </div>

          <div class="sidebar-result-block">
            <div class="sidebar-result-kicker">Signals To Explore</div>
            <ul class="sidebar-list" id="sidebar-signals"></ul>
          </div>

          <details class="sidebar-details">
            <summary>Session details</summary>
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

// Inject sidebar into the page
function injectSidebar() {
  // Wait for Google Meet to load
  const checkInterval = setInterval(() => {
    const meetRoot = document.querySelector('[role="main"]') || document.body;
    
    if (meetRoot) {
      clearInterval(checkInterval);
      
      // Create toggle button
      toggleButton = createToggleButton();
      document.body.appendChild(toggleButton);
      
      // Create sidebar
      sidebarElement = createSidebar();
      document.body.appendChild(sidebarElement);
      
      // Add event listeners
      setupEventListeners();
      
      console.log("[Meet Transcriber] Sidebar injected");
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

  // Control buttons
  document.getElementById("sidebar-enable-mic")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "ENABLE_MIC" });
  });

  document.getElementById("sidebar-start-rec")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "START_RECORDING" });
    document.getElementById("sidebar-empty").classList.add("hidden");
    document.getElementById("sidebar-results").classList.remove("hidden");
  });

  document.getElementById("sidebar-stop-rec")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
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

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RECORDING_STATE") {
    updateUI(!!message.recording);
    if (message.recording) {
      updateStatus("Recording current Google Meet audio...", "active");
    } else {
      updateStatus("Recorder is idle.", "idle");
    }
    return;
  }

  if (message.type === "RECORDING_RESULT") {
    if (message.status === "uploaded") {
      updateStatus("Recruiter brief generated!", "success");
      // Render results here
    } else if (message.status === "stopping") {
      updateStatus("Processing audio...", "warning");
    }
    return;
  }
});

// Initialize
injectSidebar();
