let captureStream = null;
let captureAudio = null;

async function startCapture(tabId, streamId) {
  if (!streamId) {
    const error = "Missing tab media stream ID.";
    console.error(error);
    chrome.runtime.sendMessage({ type: "capture-status", status: "failed", error, tabId });
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    if (captureStream) {
      captureStream.getTracks().forEach(track => track.stop());
    }
    captureStream = stream;

    if (!captureAudio) {
      captureAudio = document.createElement("audio");
      captureAudio.muted = true;
    }
    captureAudio.srcObject = stream;

    console.log("Capture started", stream);
    chrome.runtime.sendMessage({ type: "capture-status", status: "started", tabId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("getUserMedia failed:", message);
    chrome.runtime.sendMessage({ type: "capture-status", status: "failed", error: message, tabId });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "start-capture") {
    return;
  }

  startCapture(message.tabId, message.streamId);
  sendResponse({ status: "starting" });
  return true;
});
