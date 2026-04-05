document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("enable");
  const status = document.getElementById("status");

  button.addEventListener("click", async () => {
    status.textContent = "Requesting microphone permission...";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      status.textContent = "Microphone enabled. You can close this tab.";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `Microphone access failed: ${message}`;
    }
  });
});
