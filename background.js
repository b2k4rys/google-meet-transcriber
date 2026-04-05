const offscreenUrl = "offscreen.html";
let captureWindowId = null;

async function getCurrentMeetTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(tab => tab.url && tab.url.includes("meet.google.com"));
}

async function ensureCaptureDocument() {
  const url = offscreenUrl;

  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
      return { type: "offscreen", url };
    }

    await chrome.offscreen.createDocument({
      url,
      reasons: ["USER_MEDIA"],
      justification: "Capture Google Meet audio in an offscreen document."
    });

    return { type: "offscreen", url };
  }

  return new Promise(resolve => {
    chrome.windows.create({
      url,
      type: "popup",
      state: "minimized",
      width: 160,
      height: 160
    }, window => {
      if (chrome.runtime.lastError || !window) {
        resolve(null);
        return;
      }
      captureWindowId = window.id;
      resolve({ type: "window", url });
    });
  });
}

function getMediaStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, streamId => {
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to get tab media stream ID."));
        return;
      }
      resolve(streamId);
    });
  });
}

function requestOffscreenCapture(tabId, streamId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "start-capture", tabId, streamId }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || response.status !== "starting") {
        reject(new Error(response?.error || "Offscreen document did not acknowledge capture start."));
        return;
      }

      resolve();
    });
  });
}

async function connectToMeetTab() {
  const meetTab = await getCurrentMeetTab();
  if (!meetTab) {
    chrome.runtime.sendMessage({ type: "no-meet-tab" });
    return;
  }

  chrome.tabs.sendMessage(meetTab.id, { type: "connect" }, response => {
    if (chrome.runtime.lastError) {
      console.warn("Meet connector error:", chrome.runtime.lastError.message);
      return;
    }
    console.log("Connect response:", response);
  });

  let captureDoc = null;

  try {
    captureDoc = await ensureCaptureDocument();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Failed to create capture document:", message);
    chrome.tabs.sendMessage(meetTab.id, { type: "capture-log", text: `capture failed: ${message}` });
    chrome.runtime.sendMessage({ type: "capture-status", status: "failed", error: message, tabId: meetTab.id });
    return;
  }

  const ready = !!captureDoc;
  chrome.tabs.sendMessage(meetTab.id, { type: "capture-log", text: `capture document ready: ${ready}, type: ${captureDoc?.type || "none"}` });
  chrome.runtime.sendMessage({ type: "capture-status", status: "starting", location: captureDoc?.type || "none", ready });

  if (!ready) {
    const error = "Capture document is not available.";
    console.warn(error);
    chrome.tabs.sendMessage(meetTab.id, { type: "capture-log", text: `capture failed: ${error}` });
    chrome.runtime.sendMessage({ type: "capture-status", status: "failed", error });
    return;
  }

  try {
    const streamId = await getMediaStreamId(meetTab.id);
    chrome.tabs.sendMessage(meetTab.id, { type: "capture-log", text: "tab media stream ID acquired" });
    await requestOffscreenCapture(meetTab.id, streamId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Capture startup failed:", message);
    chrome.tabs.sendMessage(meetTab.id, { type: "capture-log", text: `capture failed: ${message}` });
    chrome.runtime.sendMessage({ type: "capture-status", status: "failed", error: message, tabId: meetTab.id });
  }
}

chrome.action.onClicked.addListener(connectToMeetTab);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "meet-connected") {
    console.log("Connected to Meet tab:", message.meetingCode, sender.tab?.url);
    chrome.action.setBadgeText({ text: "OK", tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#34a853" });
    chrome.runtime.sendMessage({ type: "meet-connected", meetingCode: message.meetingCode, title: message.title, url: message.url });
    sendResponse({ status: "ok" });
    return;
  }

  if (message.type === "capture-status") {
    const meetTabId = message.tabId || sender.tab?.id;
    if (message.status === "started") {
      chrome.action.setBadgeText({ text: "REC", tabId: meetTabId });
      chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    }
    if (message.status === "failed") {
      chrome.action.setBadgeText({ text: "ERR", tabId: meetTabId });
      chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    }
    if (meetTabId) {
      chrome.tabs.sendMessage(meetTabId, { type: "capture-log", text: `capture status: ${message.status}${message.error ? ` - ${message.error}` : ""}` });
    }
    chrome.runtime.sendMessage(message);
    sendResponse({ status: "ok" });
    return;
  }

  if (message.type === "no-meet-tab") {
    console.warn("No active Google Meet tab detected.");
    chrome.runtime.sendMessage({ type: "no-meet-tab" });
    sendResponse({ status: "no-meet-tab" });
    return;
  }

  if (message.type === "connect-request") {
    connectToMeetTab();
    sendResponse({ status: "connecting" });
    return;
  }
});
