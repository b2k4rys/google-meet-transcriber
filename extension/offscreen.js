const WANT_MIC_MIX = true;
const uploadUrl = "http://127.0.0.1:8000/api/recordings";

let portRef = null;
let capturing = false;
let finalizing = false;
let currentTabId = null;
let currentTabUrl = null;
let activeStreams = [];
let activeAudioContexts = [];
let rpcListenerAttached = false;

let recorderContext = null;
let recorderSourceNode = null;
let recorderProcessorNode = null;
let recorderSinkNode = null;
let pcmChunks = [];
let pcmSampleRate = 48000;

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
  log("=== pushRecordingResult called ===");
  log("Result:", JSON.stringify(result).substring(0, 300));
  
  const port = getPort();
  if (!port) {
    log("ERROR: No port to send result!");
    return;
  }
  
  port.postMessage({ type: "RECORDING_RESULT", tabId: currentTabId, ...result });
  log("Sent RECORDING_RESULT to port");
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

function inferMeetingSuffix(tabUrl) {
  try {
    const url = new URL(tabUrl || "https://meet.google.com/");
    return url.pathname.split("/").pop() || "google-meet";
  } catch {
    return "google-meet";
  }
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
    pushDebug("Trying tab capture source=tab");
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

  return rememberStream(new MediaStream(destination.stream.getAudioTracks()));
}

function appendPcmChunk(inputBuffer) {
  const channelCount = inputBuffer.numberOfChannels;
  if (channelCount < 1) {
    return;
  }

  const frameCount = inputBuffer.length;
  const mono = new Float32Array(frameCount);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = inputBuffer.getChannelData(channelIndex);
    for (let i = 0; i < frameCount; i += 1) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  pcmChunks.push(mono);
}

function startWavCapture(audioStream) {
  const audioTrack = audioStream.getAudioTracks()[0];
  if (!audioTrack) {
    throw new Error("No audio track available for recording.");
  }

  recorderContext = rememberAudioContext(new AudioContext());
  void recorderContext.resume().catch(() => {});
  pcmSampleRate = recorderContext.sampleRate;
  pcmChunks = [];

  recorderSourceNode = recorderContext.createMediaStreamSource(audioStream);
  recorderProcessorNode = recorderContext.createScriptProcessor(4096, 2, 1);
  recorderSinkNode = recorderContext.createGain();
  recorderSinkNode.gain.value = 0;

  recorderProcessorNode.onaudioprocess = event => {
    if (!capturing) {
      return;
    }
    appendPcmChunk(event.inputBuffer);
  };

  recorderSourceNode.connect(recorderProcessorNode);
  recorderProcessorNode.connect(recorderSinkNode);
  recorderSinkNode.connect(recorderContext.destination);

  pushDebug(`WAV capture started at ${pcmSampleRate} Hz`);
}

function cleanupRecorderNodes() {
  try {
    recorderSourceNode?.disconnect();
  } catch {}
  try {
    recorderProcessorNode?.disconnect();
  } catch {}
  try {
    recorderSinkNode?.disconnect();
  } catch {}

  recorderSourceNode = null;
  recorderProcessorNode = null;
  recorderSinkNode = null;
}

function cleanupMediaGraph() {
  cleanupRecorderNodes();

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

function encodeWavFromChunks(chunks, sampleRate) {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytesPerSample = 2;
  const channelCount = 1;
  const buffer = new ArrayBuffer(44 + totalSamples * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalSamples * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, totalSamples * bytesPerSample, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function uploadRecording(blob, tabUrl) {
  log("Starting upload to backend...");
  log("Blob size:", blob.size, "bytes");
  log("Upload URL:", uploadUrl);
  
  const formData = new FormData();
  formData.append("file", blob, `google-meet-recording-${inferMeetingSuffix(tabUrl)}-${Date.now()}.wav`);

  log("Sending POST to backend...");
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData
  });

  log("Backend response status:", response.status);
  const result = await response.json();
  log("Backend response:", JSON.stringify(result).substring(0, 200));
  
  if (!response.ok) {
    throw new Error(result.detail || "Upload failed.");
  }

  return result;
}

async function finalizeRecording() {
  if (finalizing) {
    log("Already finalizing, skipping");
    return;
  }

  log("=== FINALIZING RECORDING ===");
  log("pcmChunks count:", pcmChunks.length);
  log("currentTabId:", currentTabId);
  
  finalizing = true;
  capturing = false;
  
  try {
    log("Encoding WAV...");
    const wavBlob = encodeWavFromChunks(pcmChunks, pcmSampleRate);
    log("WAV blob size:", wavBlob.size, "bytes");
    pushDebug(`Final WAV size=${wavBlob.size}`);
    
    if (!wavBlob.size) {
      throw new Error("Recording is empty.");
    }

    log("Uploading to backend...");
    log("Upload URL:", uploadUrl);
    
    const result = await uploadRecording(wavBlob, currentTabUrl);
    log("Upload successful!");
    log("Result summary:", result.summary ? result.summary.substring(0, 100) : "no summary");
    
    log("Sending RECORDING_RESULT with status=uploaded");
    pushRecordingResult({ status: "uploaded", result });
    log("RECORDING_RESULT sent");
  } catch (error) {
    log("=== UPLOAD FAILED ===");
    log("Error:", error);
    log("Error stack:", error.stack);
    
    pushRecordingResult({
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    log("Cleaning up...");
    pushRecordingState(false);
    pcmChunks = [];
    cleanupMediaGraph();
    currentTabId = null;
    currentTabUrl = null;
    finalizing = false;
    log("=== CLEANUP COMPLETE ===");
  }
}

async function prepareAndRecord(baseStream, tabUrl) {
  const audioTrack = baseStream.getAudioTracks()[0];
  const videoTrack = baseStream.getVideoTracks()[0];

  if (audioTrack) {
    pushDebug(`Tab audio track: enabled=${audioTrack.enabled}, muted=${audioTrack.muted}, readyState=${audioTrack.readyState}`);
    attachRmsMeter(audioTrack, "RAW");
  } else {
    pushDebug("Captured tab stream has no audio track.");
  }

  const micStream = await maybeGetMicStream();
  const mixedAudioStream = mixAudio(baseStream, micStream);
  const mixedTrack = mixedAudioStream.getAudioTracks()[0];

  if (mixedTrack) {
    attachRmsMeter(mixedTrack, "FINAL");
  } else {
    pushDebug("Final mixed stream has no audio track.");
  }

  pushDebug(`Mixed audio stream tracks: audio=${mixedAudioStream.getAudioTracks().length}`);
  startWavCapture(mixedAudioStream);
  capturing = true;
  pushRecordingState(true);

  videoTrack?.addEventListener("ended", () => {
    if (capturing && !finalizing) {
      void finalizeRecording();
    }
  });

  audioTrack?.addEventListener("ended", () => {
    if (capturing && !finalizing) {
      void finalizeRecording();
    }
  });
}

async function startRecordingFromStreamId(streamId, tabId, tabUrl) {
  if (capturing || finalizing) {
    throw new Error("Recording is already in progress.");
  }

  currentTabId = tabId;
  currentTabUrl = tabUrl;

  const baseStream = rememberStream(await captureWithStreamId(streamId));
  await prepareAndRecord(baseStream, tabUrl);
}

function stopRecording() {
  if (!capturing || finalizing) {
    throw new Error("Not currently recording.");
  }

  pushRecordingResult({ status: "stopping" });
  void finalizeRecording();
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
        respond(message, { recording: capturing || finalizing });
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
