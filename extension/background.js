const offscreenUrl = "offscreen.html";

let offscreenPort = null;
let offscreenReady = false;
let lastKnownRecording = false;

function bglog(...args) {
  console.log("[background]", ...args);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setBadge(recording, tabId) {
  if (tabId) {
    chrome.action.setBadgeText({ text: recording ? "REC" : "", tabId });
    if (recording) {
      chrome.action.setBadgeBackgroundColor({ color: "#d93025", tabId });
    }
    return;
  }

  chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  if (recording) {
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  }
}

async function hasOffscreenContext() {
  try {
    if (typeof chrome.runtime.getContexts === "function") {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      return Array.isArray(contexts) && contexts.length > 0;
    }
  } catch {}

  try {
    return !!(await chrome.offscreen.hasDocument());
  } catch {
    return false;
  }
}

async function ensureOffscreen() {
  const exists = await hasOffscreenContext();
  if (!exists) {
    bglog("Creating offscreen document");
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(offscreenUrl),
      reasons: ["USER_MEDIA"],
      justification: "Record Google Meet tab audio and video in an offscreen document."
    });
  }

  for (let attempt = 0; attempt < 10 && !(offscreenPort && offscreenReady); attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" });
      if (response?.ok) {
        break;
      }
    } catch {}
    await wait(100);
  }

  if (!(offscreenPort && offscreenReady)) {
    try {
      await chrome.runtime.sendMessage({ type: "OFFSCREEN_CONNECT" });
    } catch {}
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (offscreenPort && offscreenReady) {
      return;
    }
    await wait(100);
  }

  throw new Error("Offscreen document did not become ready.");
}

function postToOffscreen(message) {
  return new Promise((resolve, reject) => {
    if (!offscreenPort) {
      reject(new Error("Offscreen port is not connected."));
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const payload = { ...message, __id: id };

    const timeoutId = setTimeout(() => {
      try {
        offscreenPort?.onMessage.removeListener(listener);
      } catch {}
      reject(new Error("Timed out waiting for offscreen response."));
    }, 15000);

    const listener = response => {
      if (response?.__respFor !== id) {
        return;
      }

      offscreenPort.onMessage.removeListener(listener);
      clearTimeout(timeoutId);
      resolve(response.payload);
    };

    offscreenPort.onMessage.addListener(listener);
    offscreenPort.postMessage(payload);
  });
}

function getStreamIdForTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, streamId => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!streamId) {
        reject(new Error("Chrome returned an empty tab media stream ID."));
        return;
      }

      resolve(streamId);
    });
  });
}

function isMeetTab(tab) {
  return !!tab?.url && tab.url.startsWith("https://meet.google.com/") && /[a-z]+-[a-z]+-[a-z]+/i.test(tab.url);
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "offscreen") {
    return;
  }

  bglog("Offscreen connected");
  offscreenPort = port;
  offscreenReady = false;

  port.onMessage.addListener(message => {
    if (message?.type === "OFFSCREEN_READY") {
      offscreenReady = true;
      return;
    }

    if (message?.type === "RECORDING_STATE") {
      lastKnownRecording = !!message.recording;
      setBadge(lastKnownRecording, message.tabId);
      chrome.runtime.sendMessage(message).catch(() => {});
      return;
    }

    if (message?.type === "RECORDING_RESULT") {
      bglog("=== RECORDING_RESULT received from offscreen ===");
      bglog("Status:", message.status);
      bglog("Has result:", !!message.result);
      
      if (message.status === "stopping") {
        chrome.action.setBadgeText({ text: "...", tabId: message.tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#f9ab00", tabId: message.tabId });
        chrome.runtime.sendMessage(message).catch(() => {});
        return;
      }

      lastKnownRecording = false;
      if (message.status === "failed") {
        chrome.action.setBadgeText({ text: "ERR", tabId: message.tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#d93025", tabId: message.tabId });
      } else {
        setBadge(false, message.tabId);
      }
      
      bglog("Forwarding RECORDING_RESULT to sidebar/popup");
      bglog("Message object keys:", Object.keys(message));
      bglog("Message result.summary length:", message.result?.summary?.length || 0);
      
      // Send to all contexts (sidebar, popup, etc.)
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          bglog("❌ Failed to forward:", chrome.runtime.lastError.message);
        } else {
          bglog("✅ Successfully forwarded RECORDING_RESULT");
          bglog("Response from sidebar:", response);
        }
      });
      return;
    }

    if (message?.type === "RECORDING_DEBUG") {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  });

  port.onDisconnect.addListener(() => {
    bglog("Offscreen disconnected");
    offscreenPort = null;
    offscreenReady = false;
    lastKnownRecording = false;
    setBadge(false);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle test message
  if (message?.type === "TEST_SIDEBAR") {
    bglog("TEST_SIDEBAR from:", sender.tab?.id || "unknown");
    sendResponse({ ok: true, timestamp: Date.now() });
    return true;
  }

  (async () => {
    if (message?.type === "GET_RECORDING_STATUS") {
      try {
        if (await hasOffscreenContext()) {
          await ensureOffscreen();
          const result = await postToOffscreen({ type: "OFFSCREEN_STATUS" }).catch(() => null);
          if (typeof result?.recording === "boolean") {
            lastKnownRecording = result.recording;
          }
        }
      } catch {}

      sendResponse({ recording: lastKnownRecording });
      return;
    }

    if (message?.type === "START_RECORDING") {
      // Get tabId from message or from sender (for content scripts)
      let tabId = message.tabId;
      
      // If no tabId provided, try to get it from sender (content script)
      if (typeof tabId !== "number" && sender?.tab?.id) {
        tabId = sender.tab.id;
        bglog("Using sender tab ID:", tabId, "from URL:", sender.tab.url);
      }
      
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, error: "Missing tab ID. Please make sure you're on Google Meet." });
        return;
      }

      const tab = await chrome.tabs.get(tabId).catch(() => null);
      bglog("Got tab:", tab?.url);
      
      if (!isMeetTab(tab)) {
        sendResponse({ ok: false, error: "Please open Google Meet first. The active tab is: " + (tab?.url || "unknown") });
        return;
      }

      bglog("Starting recording on tab:", tabId);
      await ensureOffscreen();
      const streamId = await getStreamIdForTab(tabId);
      const result = await postToOffscreen({
        type: "OFFSCREEN_START",
        streamId,
        tabId,
        tabUrl: tab.url
      });

      if (!result?.ok) {
        sendResponse({ ok: false, error: result?.error || "Failed to start recording." });
        return;
      }

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "STOP_RECORDING") {
      bglog("=== STOP_RECORDING received ===");
      bglog("Sender:", sender?.tab?.id, sender?.tab?.url);
      
      try {
        bglog("Calling ensureOffscreen...");
        await ensureOffscreen();
        bglog("Offscreen ready, posting OFFSCREEN_STOP...");
        
        const result = await postToOffscreen({ type: "OFFSCREEN_STOP" });
        bglog("Offscreen STOP result:", result);
        
        if (!result?.ok) {
          bglog("STOP failed:", result?.error);
          sendResponse({ ok: false, error: result?.error || "Failed to stop recording." });
          return;
        }

        bglog("STOP successful, waiting for RECORDING_RESULT...");
        sendResponse({ ok: true });
      } catch (error) {
        bglog("STOP_RECORDING error:", error);
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "connect-request") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isMeetTab(tab)) {
        sendResponse({ ok: false, error: "No active Google Meet tab found." });
        return;
      }

      chrome.runtime.sendMessage({
        type: "meet-connected",
        meetingCode: new URL(tab.url).pathname.split("/")[1] || null,
        title: tab.title,
        url: tab.url
      }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }
  })().catch(error => {
    console.error("[background] error", error);
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});
