const meetTabId = Math.random().toString(36).slice(2);

function getMeetingData() {
  const meetingCode = window.location.pathname.split("/")[1] || null;
  const title = document.title || "Google Meet";
  return { meetingCode, title, url: window.location.href };
}

function sendMeetStatus() {
  chrome.runtime.sendMessage({ type: "meet-connected", ...getMeetingData() }, response => {
    console.log("Meet status sent", response);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "connect") {
    console.log("[Meet Connector] connect message received");
    sendMeetStatus();
    sendResponse({ status: "connected" });
    return;
  }

  if (message.type === "capture-log") {
    console.log("[Meet Connector] capture status:", message.text);
    return;
  }
});

console.log("[Meet Connector] content script loaded for Meet tab", meetTabId);
