const micButton = document.getElementById("enable-mic");
const startButton = document.getElementById("start-rec");
const stopButton = document.getElementById("stop-rec");
const statusText = document.getElementById("status");
const responseText = document.getElementById("response");

function setUi(recording) {
  startButton.disabled = recording;
  stopButton.disabled = !recording;
}

function setStatus(text) {
  statusText.textContent = text;
}

async function refreshMicButton() {
  if (!("permissions" in navigator)) {
    return;
  }

  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    const update = () => {
      if (permission.state === "granted") {
        micButton.textContent = "Microphone Enabled";
        micButton.disabled = true;
        return;
      }

      if (permission.state === "denied") {
        micButton.textContent = "Microphone Blocked";
        micButton.disabled = false;
        return;
      }

      micButton.textContent = "Enable Microphone";
      micButton.disabled = false;
    };

    update();
    permission.onchange = update;
  } catch {}
}

async function openMicSetupTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("micsetup.html") });
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "RECORDING_STATE") {
    setUi(!!message.recording);
    if (message.recording) {
      setStatus("Recording current Google Meet audio...");
    }
    return;
  }

  if (message?.type === "RECORDING_RESULT") {
    if (message.status === "uploaded") {
      setStatus("Audio recording uploaded successfully.");
      responseText.textContent = JSON.stringify(message.result, null, 2);
    } else if (message.status === "stopping") {
      setStatus("Stopping audio recording and uploading...");
    } else if (message.status === "failed") {
      setStatus(`Recording failed: ${message.error || "unknown error"}`);
    }

    if (message.status !== "stopping") {
      setUi(false);
    }
    return;
  }

  if (message?.type === "RECORDING_DEBUG") {
    responseText.textContent = message.text;
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
      setStatus("Microphone enabled for the extension.");
      await refreshMicButton();
    } catch {
      await openMicSetupTab();
    }
  } catch (error) {
    setStatus(`Could not enable microphone: ${error instanceof Error ? error.message : String(error)}`);
  }
});

startButton.addEventListener("click", async () => {
  responseText.textContent = "";
  setStatus("Starting audio recording...");

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
            setStatus("Microphone not enabled, continuing with Meet tab audio only.");
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
    setStatus("Recording current Google Meet audio...");
  } catch (error) {
    setUi(false);
    setStatus(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`);
  }
});

stopButton.addEventListener("click", async () => {
  setStatus("Stopping audio recording...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop recording.");
    }
  } catch (error) {
    setUi(false);
    setStatus(`Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`);
  }
});

void (async () => {
  const status = await chrome.runtime.sendMessage({ type: "GET_RECORDING_STATUS" }).catch(() => null);
  setUi(!!status?.recording);
  setStatus(status?.recording ? "Recording current Google Meet audio..." : "Recorder is idle.");
  await refreshMicButton();
})();
