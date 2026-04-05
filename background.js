async function getCurrentMeetTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(tab => tab.url && tab.url.includes("meet.google.com"));
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

  if (message.type === "no-meet-tab") {
    console.warn("No active Google Meet tab detected.");
    chrome.runtime.sendMessage({ type: "no-meet-tab" });
    sendResponse({ status: "no-meet-tab" });
    return;
  }

  if (message.type === "connect-request") {
    connectToMeetTab();
    sendResponse({ status: "connecting" });
  }
});
