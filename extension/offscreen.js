const WANT_MIC_MIX = true;
const uploadUrl = "http://127.0.0.1:8000/api/recordings";

let portRef = null;
let mediaRecorder = null;
let chunks = [];
let capturing = false;
let currentTabId = null;
let activeStreams = [];
let activeAudioContexts = [];
let rpcListenerAttached = false;

function log(...args) {
  console.log("[offscreen]", ...args);
}

function connectPort() {
  if (portRef) {
    return portRef;
  }

  const port = chrome.runtime.connect({ name: "offscreen" });
  port.onDisconnect.addListener(() => {
    portRef = null;
    rpcListenerAttached = false;
  });
  port.postMessage({ type: "OFFSCREEN_READY" });
  portRef = port;
  attachRpcListener(port);
  return port;
}

function getPort() {
  return portRef || connectPort();
}

function respond(request, payload) {
  getPort().postMessage({ __respFor: request?.__id, payload });
}

function pushRecordingState(recording, extra = {}) {
  getPort().postMessage({ type: "RECORDING_STATE", recording, tabId: currentTabId, ...extra });
}

function pushRecordingResult(result) {
  getPort().postMessage({ type: "RECORDING_RESULT", tabId: currentTabId, ...result });
}

function pushDebug(text) {
  getPort().postMessage({ type: "RECORDING_DEBUG", tabId: currentTabId, text });
}

function rememberStream(stream) {
  activeStreams.push(stream);
  return stream;
}

function rememberAudioContext(audioContext) {
  activeAudioContexts.push(audioContext);
  return audioContext;
}

function cleanupMediaGraph() {
  for (const stream of activeStreams) {
    try {
      stream.getTracks().forEach(track => track.stop());
    } catch {}
  }
  activeStreams = [];

  for (const context of activeAudioContexts) {
    try {
      context.close();
    } catch {}
  }
  activeAudioContexts = [];
}

function inferMeetingSuffix(tabUrl) {
  try {
    const url = new URL(tabUrl || "https://meet.google.com/");
    return url.pathname.split("/").pop() || "google-meet";
  } catch {
    return "google-meet";
  }
}

function getRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function makeConstraints(streamId, source) {
  const mandatory = { chromeMediaSource: source, chromeMediaSourceId: streamId };

  return {
    audio: {
      mandatory,
      optional: [{ googDisableLocalEcho: false }]
    },
    video: {
      mandatory: {
        ...mandatory,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30
      }
    }
  };
}

async function captureWithStreamId(streamId) {
  try {
    pushDebug(`Trying tab capture source=tab`);
    return await navigator.mediaDevices.getUserMedia(makeConstraints(streamId, "tab"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushDebug(`source=tab failed: ${message}`);
  }

  pushDebug("Trying tab capture source=desktop");
  return navigator.mediaDevices.getUserMedia(makeConstraints(streamId, "desktop"));
}

async function maybeGetMicStream() {
  if (!WANT_MIC_MIX) {
    return null;
  }

  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const track = micStream.getAudioTracks()[0];
    pushDebug(`Mic stream acquired: enabled=${track?.enabled ?? false}, muted=${track?.muted ?? false}`);
    return rememberStream(micStream);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushDebug(`Mic capture unavailable, continuing without mic: ${message}`);
    return null;
  }
}

function attachRmsMeter(track, label) {
  try {
    const audioContext = rememberAudioContext(new AudioContext());
    void audioContext.resume().catch(() => {});
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const intervalId = setInterval(() => {
      if (!capturing) {
        clearInterval(intervalId);
        return;
      }

      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / buffer.length);
      pushDebug(`${label} rms=${rms.toFixed(4)}`);
    }, 1000);

    track.addEventListener("ended", () => clearInterval(intervalId));
  } catch (error) {
    log("RMS meter failed", error);
  }
}

function mixAudio(baseStream, micStream) {
  const audioContext = rememberAudioContext(new AudioContext());
  void audioContext.resume().catch(() => {});
  const destination = audioContext.createMediaStreamDestination();

  const tabAudioTrack = baseStream.getAudioTracks()[0];
  if (tabAudioTrack) {
    const tabSource = audioContext.createMediaStreamSource(new MediaStream([tabAudioTrack]));
    tabSource.connect(destination);
    tabSource.connect(audioContext.destination);
  }

  const micAudioTrack = micStream?.getAudioTracks?.()[0];
  if (micAudioTrack) {
    const micSource = audioContext.createMediaStreamSource(new MediaStream([micAudioTrack]));
    micSource.connect(destination);
  }

  const finalStream = new MediaStream([
    ...baseStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
  ]);

  return rememberStream(finalStream);
}

async function uploadRecording(blob, tabUrl) {
  const formData = new FormData();
  formData.append("file", blob, `google-meet-recording-${inferMeetingSuffix(tabUrl)}-${Date.now()}.webm`);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.detail || "Upload failed.");
  }

  return result;
}

async function prepareAndRecord(baseStream, tabUrl) {
  const audioTrack = baseStream.getAudioTracks()[0];
  const videoTrack = baseStream.getVideoTracks()[0];

  if (!videoTrack) {
    throw new Error("No video track was captured from the Meet tab.");
  }

  if (audioTrack) {
    pushDebug(`Tab audio track: enabled=${audioTrack.enabled}, muted=${audioTrack.muted}, readyState=${audioTrack.readyState}`);
    attachRmsMeter(audioTrack, "RAW");
  } else {
    pushDebug("Captured tab stream has no audio track.");
  }

  const micStream = await maybeGetMicStream();
  const finalStream = mixAudio(baseStream, micStream);
  const finalAudioTrack = finalStream.getAudioTracks()[0];

  if (finalAudioTrack) {
    attachRmsMeter(finalAudioTrack, "FINAL");
  } else {
    pushDebug("Final mixed stream has no audio track.");
  }

  pushDebug(`Final stream tracks: video=${finalStream.getVideoTracks().length}, audio=${finalStream.getAudioTracks().length}`);

  chunks = [];
  const mimeType = getRecorderMimeType();

  mediaRecorder = new MediaRecorder(finalStream, {
    mimeType,
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 128_000
  });

  mediaRecorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  mediaRecorder.onerror = event => {
    pushRecordingResult({
      status: "failed",
      error: event.error?.message || "MediaRecorder error."
    });
    capturing = false;
    chunks = [];
    mediaRecorder = null;
    pushRecordingState(false);
    cleanupMediaGraph();
    currentTabId = null;
  };

  mediaRecorder.onstart = () => {
    capturing = true;
    pushRecordingState(true);
  };

  mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(chunks, { type: mimeType });
      pushDebug(`Final blob size=${blob.size}`);
      if (!blob.size) {
        throw new Error("Recording is empty.");
      }

      const result = await uploadRecording(blob, tabUrl);
      pushRecordingResult({ status: "uploaded", result });
    } catch (error) {
      pushRecordingResult({
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      capturing = false;
      chunks = [];
      mediaRecorder = null;
      pushRecordingState(false);
      cleanupMediaGraph();
      currentTabId = null;
    }
  };

  finalStream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (capturing && mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  });

  mediaRecorder.start(1000);
}

async function startRecordingFromStreamId(streamId, tabId, tabUrl) {
  if (capturing) {
    throw new Error("Recording is already in progress.");
  }

  currentTabId = tabId;
  const baseStream = rememberStream(await captureWithStreamId(streamId));
  await prepareAndRecord(baseStream, tabUrl);
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    throw new Error("Not currently recording.");
  }

  pushRecordingResult({ status: "stopping" });
  mediaRecorder.stop();
}

function attachRpcListener(port) {
  if (rpcListenerAttached) {
    return;
  }

  port.onMessage.addListener(async message => {
    try {
      if (message?.type === "OFFSCREEN_START") {
        try {
          await startRecordingFromStreamId(message.streamId, message.tabId, message.tabUrl);
          respond(message, { ok: true });
        } catch (error) {
          respond(message, {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (message?.type === "OFFSCREEN_STOP") {
        try {
          stopRecording();
          respond(message, { ok: true });
        } catch (error) {
          respond(message, {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (message?.type === "OFFSCREEN_STATUS") {
        respond(message, { recording: capturing });
      }
    } catch (error) {
      respond(message, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  rpcListenerAttached = true;
}

connectPort();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true, via: "offscreen" });
    return true;
  }

  if (message?.type === "OFFSCREEN_CONNECT") {
    connectPort();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
