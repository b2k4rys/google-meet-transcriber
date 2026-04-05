const connectButton = document.getElementById("connect");
const statusText = document.getElementById("status");

connectButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "connect-request" }, response => {
    if (!response) {
      statusText.textContent = "Unable to send message. Is the extension loaded?";
      return;
    }
    statusText.textContent = "Connecting to current Meet tab...";
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "no-meet-tab") {
    statusText.textContent = "No active Google Meet tab found.";
    return;
  }

  if (message.type === "meet-connected") {
    statusText.textContent = `Connected to Meet: ${message.meetingCode || "unknown"}`;
    return;
  }

  if (message.type === "capture-status") {
    if (message.status === "starting") {
      statusText.textContent = "Starting audio capture...";
      return;
    }
    if (message.status === "started") {
      statusText.textContent = "Audio capture started successfully.";
      return;
    }
    if (message.status === "failed") {
      statusText.textContent = `Audio capture failed: ${message.error || "unknown error"}`;
      return;
    }
  }
});
