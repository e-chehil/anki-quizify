import { resolveRuntimeLifecycle } from "../lifecycle.js";

export function initAudio({ root, lifecycle = null }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);

  root.document.querySelectorAll(".audio-player").forEach((player) => {
    if (player.dataset.quizifyInitialized === "true") return;

    const audio = player.querySelector("audio");
    const playButton = player.querySelector(".play-btn");
    const replayButton = player.querySelector(".replay-btn");
    const speed = player.querySelector(".speed-select");
    const progress = player.querySelector(".progress-bar");
    const progressContainer = player.querySelector(".progress-container");
    const currentTime = player.querySelector(".current-time");
    const duration = player.querySelector(".duration");
    const setAButton = player.querySelector(".setA-btn");
    const setBButton = player.querySelector(".setB-btn");
    const cancelLoopButton = player.querySelector(".cancelLoop-btn");
    if (!audio || !playButton || !progress || !progressContainer) return;
    player.dataset.quizifyInitialized = "true";

    let loopA = null;
    let loopB = null;
    let markerA = null;
    let markerB = null;

    function formatTime(seconds) {
      const safe = Number.isFinite(seconds) ? seconds : 0;
      const minutes = Math.floor(safe / 60);
      const remainder = Math.floor(safe % 60);
      return `${minutes}:${remainder.toString().padStart(2, "0")}`;
    }
    function createMarker(time, label) {
      if (!audio.duration) return null;
      const marker = root.document.createElement("div");
      marker.className = `ab-marker ab-marker-${label.toLowerCase()}`;
      marker.dataset.label = label;
      marker.style.left = `${(time / audio.duration) * 100}%`;
      marker.title = `Point ${label}: ${formatTime(time)}`;
      progressContainer.appendChild(marker);
      return marker;
    }
    function removeMarker(marker) {
      if (marker && progressContainer.contains(marker)) progressContainer.removeChild(marker);
    }
    function setPlayButtonState(isPlaying) {
      playButton.classList.toggle("playing", isPlaying);
      const label = isPlaying ? "暂停" : "播放";
      playButton.setAttribute("aria-label", label);
      playButton.title = label;
    }
    function updateLoopControls() {
      const hasA = loopA !== null;
      const hasB = loopB !== null;
      setAButton?.classList.toggle("active", hasA);
      setBButton?.classList.toggle("active", hasB);
      setAButton?.setAttribute("aria-pressed", String(hasA));
      setBButton?.setAttribute("aria-pressed", String(hasB));
      if (cancelLoopButton) cancelLoopButton.disabled = !hasA && !hasB;
    }
    function requestPlay() {
      audio.play()?.catch?.(() => setPlayButtonState(false));
    }

    activeLifecycle.listen(audio, "loadedmetadata", () => {
      if (duration) duration.textContent = formatTime(audio.duration);
    });
    activeLifecycle.listen(audio, "play", () => setPlayButtonState(true));
    activeLifecycle.listen(audio, "pause", () => setPlayButtonState(false));
    activeLifecycle.listen(audio, "ended", () => setPlayButtonState(false));
    activeLifecycle.listen(playButton, "click", () => {
      if (audio.paused) requestPlay();
      else audio.pause();
    });
    if (replayButton) activeLifecycle.listen(replayButton, "click", () => {
      audio.currentTime = 0;
      if (audio.paused) requestPlay();
    });
    if (speed) activeLifecycle.listen(speed, "change", () => {
      audio.playbackRate = Number(speed.value);
    });
    activeLifecycle.listen(audio, "timeupdate", () => {
      if (!audio.duration) return;
      const percent = Math.max(0, Math.min(100, (audio.currentTime / audio.duration) * 100));
      progress.style.width = `${percent}%`;
      progressContainer.setAttribute("aria-valuenow", String(Math.round(percent)));
      if (currentTime) currentTime.textContent = formatTime(audio.currentTime);
      if (loopA !== null && loopB !== null && audio.currentTime >= loopB) {
        audio.currentTime = loopA;
      }
    });
    activeLifecycle.listen(progressContainer, "click", (event) => {
      if (!audio.duration) return;
      const rect = progressContainer.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * audio.duration;
    });
    activeLifecycle.listen(progressContainer, "keydown", (event) => {
      if (!audio.duration) return;
      const step = Math.max(2, Math.min(10, audio.duration * 0.05));
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - step);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        audio.currentTime = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        audio.currentTime = audio.duration;
      }
    });

    if (setAButton) activeLifecycle.listen(setAButton, "click", () => {
      loopA = audio.currentTime;
      if (loopB !== null && loopB < loopA) {
        loopB = null;
        removeMarker(markerB);
        markerB = null;
      }
      removeMarker(markerA);
      markerA = createMarker(loopA, "A");
      updateLoopControls();
    });
    if (setBButton) activeLifecycle.listen(setBButton, "click", () => {
      loopB = audio.currentTime;
      if (loopA !== null && loopB < loopA) {
        [loopA, loopB] = [loopB, loopA];
        removeMarker(markerA);
        removeMarker(markerB);
        markerA = createMarker(loopA, "A");
        markerB = createMarker(loopB, "B");
        updateLoopControls();
        return;
      }
      removeMarker(markerB);
      markerB = createMarker(loopB, "B");
      updateLoopControls();
    });
    if (cancelLoopButton) activeLifecycle.listen(cancelLoopButton, "click", () => {
      loopA = null;
      loopB = null;
      removeMarker(markerA);
      removeMarker(markerB);
      markerA = null;
      markerB = null;
      updateLoopControls();
    });
    activeLifecycle.add(() => {
      try {
        audio.pause();
      } catch {
        // Some preview/test media elements do not implement pause().
      }
      removeMarker(markerA);
      removeMarker(markerB);
      delete player.dataset.quizifyInitialized;
    });
    updateLoopControls();
  });
}
