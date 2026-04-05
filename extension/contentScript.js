const meetTabId = Math.random().toString(36).slice(2);

function getMeetingData() {
  const meetingCode = window.location.pathname.split("/")[1] || null;
  const title = document.title || "Google Meet";
  return { meetingCode, title, url: window.location.href };
}

function sendMeetStatus() {
  chrome.runtime.sendMessage({ type: "meet-connected", ...getMeetingData() }, response => {
    console.log("[Meet Connector] Meet status sent", response);
  });
}

// Only handle connector messages, forward RECORDING messages to sidebar via window.postMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "connect") {
    console.log("[Meet Connector] connect message received");
    sendMeetStatus();
    sendResponse({ status: "connected" });
    return true;
  }

  if (message.type === "capture-log") {
    console.log("[Meet Connector] capture status:", message.text);
    return;
  }

  // Forward RECORDING messages to sidebar via window.postMessage
  if (message.type === "RECORDING_RESULT" || message.type === "RECORDING_STATE") {
    console.log("[Meet Connector] === Forwarding RECORDING message ===", message.type, message.status);
    
    window.postMessage({ 
      type: "FROM_EXTENSION", 
      payload: message 
    }, "*");
    
    // Still respond to background
    sendResponse({ forwarded: true });
    return true;
  }
  
  // Don't handle other messages
  return false;
});

console.log("[Meet Connector] content script loaded for Meet tab", meetTabId);


