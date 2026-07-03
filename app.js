(function () {
  "use strict";

  const state = {
    file: null,
    objectUrl: "",
    resultUrl: "",
    duration: 0,
    preset: "balanced",
    busy: false
  };

  const elements = {
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    chooseButton: document.getElementById("chooseButton"),
    resetButton: document.getElementById("resetButton"),
    video: document.getElementById("videoPreview"),
    sourceMeta: document.getElementById("sourceMeta"),
    resultMeta: document.getElementById("resultMeta"),
    resultStage: document.getElementById("resultStage"),
    gifPreview: document.getElementById("gifPreview"),
    clipSelection: document.getElementById("clipSelection"),
    clipStartRange: document.getElementById("clipStartRange"),
    clipEndRange: document.getElementById("clipEndRange"),
    clipDurationLabel: document.getElementById("clipDurationLabel"),
    clipCurrentTime: document.getElementById("clipCurrentTime"),
    markStartButton: document.getElementById("markStartButton"),
    markEndButton: document.getElementById("markEndButton"),
    previewClipButton: document.getElementById("previewClipButton"),
    startInput: document.getElementById("startInput"),
    endInput: document.getElementById("endInput"),
    fpsInput: document.getElementById("fpsInput"),
    widthInput: document.getElementById("widthInput"),
    qualityInput: document.getElementById("qualityInput"),
    qualityLabel: document.getElementById("qualityLabel"),
    convertButton: document.getElementById("convertButton"),
    downloadLink: document.getElementById("downloadLink"),
    statusText: document.getElementById("statusText"),
    progressBar: document.getElementById("progressBar"),
    progressLabel: document.getElementById("progressLabel"),
    canvas: document.getElementById("workCanvas")
  };

  const presets = {
    balanced: { fps: 10, width: 480, quality: 2, label: "均衡" },
    clear: { fps: 12, width: 640, quality: 3, label: "更清晰" },
    small: { fps: 8, width: 360, quality: 1, label: "小体积" }
  };

  bindEvents();
  applyPreset("balanced");

  function bindEvents() {
    elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files?.[0];
      if (file) loadFile(file);
    });

    elements.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
    elements.dropZone.addEventListener("dragleave", () => {
      elements.dropZone.classList.remove("is-dragging");
    });
    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
      const file = event.dataTransfer.files?.[0];
      if (file) loadFile(file);
    });

    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });

    elements.video.addEventListener("loadedmetadata", onVideoMetadata);
    elements.video.addEventListener("timeupdate", onVideoTimeUpdate);
    elements.video.addEventListener("error", () => {
      setStatus("这个视频浏览器无法直接读取，建议换 MP4/H.264 再试。", true);
      elements.convertButton.disabled = true;
    });
    elements.startInput.addEventListener("input", () => setClipValues(Number(elements.startInput.value), Number(elements.endInput.value), "start"));
    elements.endInput.addEventListener("input", () => setClipValues(Number(elements.startInput.value), Number(elements.endInput.value), "end"));
    elements.clipStartRange.addEventListener("input", () => setClipValues(Number(elements.clipStartRange.value), Number(elements.endInput.value), "start"));
    elements.clipEndRange.addEventListener("input", () => setClipValues(Number(elements.startInput.value), Number(elements.clipEndRange.value), "end"));
    elements.markStartButton.addEventListener("click", markCurrentFrameAsStart);
    elements.markEndButton.addEventListener("click", markCurrentFrameAsEnd);
    elements.previewClipButton.addEventListener("click", previewSelectedClip);
    elements.qualityInput.addEventListener("input", updateQualityLabel);
    elements.convertButton.addEventListener("click", convert);
    elements.resetButton.addEventListener("click", reset);
  }

  function loadFile(file) {
    revokeResult();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);

    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    elements.video.src = state.objectUrl;
    elements.video.load();
    elements.sourceMeta.textContent = `${formatBytes(file.size)}`;
    setStatus(`已选择：${file.name}`);
    setProgress(0);
  }

  function onVideoMetadata() {
    state.duration = Number(elements.video.duration || 0);
    if (!Number.isFinite(state.duration) || state.duration <= 0) {
      setStatus("无法读取视频时长，请换一个文件再试。", true);
      elements.convertButton.disabled = true;
      return;
    }

    updateClipControlLimits(state.duration);
    setClipValues(0, Math.min(3, state.duration), "metadata");
    elements.sourceMeta.textContent = `${formatDuration(state.duration)} · ${formatBytes(state.file.size)}`;
    elements.convertButton.disabled = false;
    setStatus("可以生成 GIF。");
  }

  function updateClipControlLimits(duration) {
    const max = Math.max(0, Number(duration || 0)).toFixed(1);
    [
      elements.startInput,
      elements.endInput,
      elements.clipStartRange,
      elements.clipEndRange
    ].forEach((input) => {
      input.max = max;
      input.step = "0.1";
      input.disabled = !duration;
    });
    elements.markStartButton.disabled = !duration;
    elements.markEndButton.disabled = !duration;
    elements.previewClipButton.disabled = !duration;
  }

  function setClipValues(rawStart, rawEnd, source = "") {
    const max = Math.max(0, Number(state.duration || 0));
    const minGap = max > 0.1 ? 0.1 : max;
    let start = clampNumber(rawStart, 0, max);
    let end = clampNumber(rawEnd, 0, max);

    if (max && end <= start) {
      if (source === "start") {
        end = Math.min(max, start + minGap);
        if (end === start) start = Math.max(0, end - minGap);
      } else {
        start = Math.max(0, end - minGap);
        if (end === start) end = Math.min(max, start + minGap);
      }
    }

    elements.startInput.value = formatSecondsValue(start);
    elements.endInput.value = formatSecondsValue(end);
    elements.clipStartRange.value = String(start);
    elements.clipEndRange.value = String(end);
    updateClipSummary(start, end);

    if (source && source !== "metadata" && state.resultUrl) {
      revokeResult();
    }
  }

  function updateClipSummary(start = Number(elements.startInput.value || 0), end = Number(elements.endInput.value || 0)) {
    const duration = Math.max(0, end - start);
    elements.clipDurationLabel.textContent = state.duration
      ? `已选 ${formatDuration(duration)} · ${formatSecondsValue(start)}s - ${formatSecondsValue(end)}s`
      : "选择视频后可拖动截选";
    const startPct = state.duration ? (start / state.duration) * 100 : 0;
    const endPct = state.duration ? (end / state.duration) * 100 : 0;
    elements.clipSelection.style.setProperty("--clip-start-pct", `${Math.max(0, Math.min(100, startPct))}%`);
    elements.clipSelection.style.setProperty("--clip-end-pct", `${Math.max(0, Math.min(100, endPct))}%`);
  }

  function onVideoTimeUpdate() {
    elements.clipCurrentTime.textContent = formatDuration(elements.video.currentTime || 0);
    if (!state.previewingClip) return;
    const end = Number(elements.endInput.value || 0);
    const start = Number(elements.startInput.value || 0);
    if (elements.video.currentTime >= end) {
      state.previewingClip = false;
      elements.video.pause();
      elements.video.currentTime = start;
      setStatus("截选片段预览结束。");
    }
  }

  function markCurrentFrameAsStart() {
    const current = clampNumber(elements.video.currentTime || 0, 0, state.duration);
    const end = Math.max(Number(elements.endInput.value || 0), current + 0.1);
    setClipValues(current, Math.min(end, state.duration), "start");
    setStatus("已把当前画面设为开始点。");
  }

  function markCurrentFrameAsEnd() {
    const current = clampNumber(elements.video.currentTime || 0, 0, state.duration);
    const start = Math.min(Number(elements.startInput.value || 0), current - 0.1);
    setClipValues(Math.max(0, start), current, "end");
    setStatus("已把当前画面设为结束点。");
  }

  async function previewSelectedClip() {
    const settings = readSettings();
    if (!settings.valid) {
      setStatus(settings.message, true);
      return;
    }
    state.previewingClip = true;
    elements.video.currentTime = settings.start;
    try {
      await elements.video.play();
      setStatus("正在预览截选片段。");
    } catch {
      state.previewingClip = false;
      setStatus("浏览器阻止自动播放，可以手动点击视频播放预览。", true);
    }
  }

  function applyPreset(name) {
    const preset = presets[name] || presets.balanced;
    state.preset = name;
    elements.fpsInput.value = String(preset.fps);
    elements.widthInput.value = String(preset.width);
    elements.qualityInput.value = String(preset.quality);
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.classList.toggle("active", button.dataset.preset === name);
    });
    updateQualityLabel();
  }

  function updateQualityLabel() {
    const labels = { 1: "小体积", 2: "均衡", 3: "更清晰" };
    elements.qualityLabel.textContent = labels[elements.qualityInput.value] || "均衡";
  }

  async function convert() {
    if (state.busy || !state.file) return;

    const settings = readSettings();
    if (!settings.valid) {
      setStatus(settings.message, true);
      return;
    }

    state.busy = true;
    elements.convertButton.disabled = true;
    elements.downloadLink.classList.add("disabled");
    revokeResult();
    setProgress(0);

    try {
      const dimensions = resolveOutputSize(settings.width);
      const frames = await captureFrames(settings, dimensions);
      setStatus("正在编码 GIF...");
      setProgress(92);
      await waitForPaint();
      const blob = window.GIFEncoder.encode({
        width: dimensions.width,
        height: dimensions.height,
        frames
      });
      const url = URL.createObjectURL(blob);
      state.resultUrl = url;
      elements.gifPreview.src = url;
      elements.gifPreview.hidden = false;
      elements.resultStage.querySelector("span").hidden = true;
      elements.downloadLink.href = url;
      elements.downloadLink.download = buildOutputName(state.file.name);
      elements.downloadLink.classList.remove("disabled");
      elements.resultMeta.textContent = `${formatBytes(blob.size)}`;
      setProgress(100);
      setStatus(`完成：${frames.length} 帧，${formatBytes(blob.size)}。`);
    } catch (error) {
      setStatus(error.message || "生成失败，请缩短片段或降低宽度后再试。", true);
      elements.resultMeta.textContent = "生成失败";
    } finally {
      state.busy = false;
      elements.convertButton.disabled = !state.file;
    }
  }

  function readSettings() {
    const start = Number(elements.startInput.value || 0);
    const end = Number(elements.endInput.value || 0);
    const fps = Math.max(4, Math.min(18, Math.round(Number(elements.fpsInput.value || 10))));
    const width = Math.max(160, Math.min(960, Math.round(Number(elements.widthInput.value || 480))));
    const quality = Math.max(1, Math.min(3, Math.round(Number(elements.qualityInput.value || 2))));

    if (!state.duration) return { valid: false, message: "请先选择视频。" };
    if (end <= start) return { valid: false, message: "结束时间需要大于开始时间。" };
    if (start < 0 || end > state.duration + 0.05) return { valid: false, message: "截取时间不能超出视频时长。" };
    if ((end - start) * fps > 160) return { valid: false, message: "当前片段帧数太多，请缩短时长或降低帧率。" };
    return { valid: true, start, end, fps, width, quality };
  }

  function resolveOutputSize(maxWidth) {
    const videoWidth = elements.video.videoWidth || 640;
    const videoHeight = elements.video.videoHeight || 360;
    const width = Math.min(maxWidth, videoWidth);
    const height = Math.max(2, Math.round((width / videoWidth) * videoHeight / 2) * 2);
    return { width, height };
  }

  async function captureFrames(settings, dimensions) {
    const frameCount = Math.max(1, Math.ceil((settings.end - settings.start) * settings.fps));
    const delayCs = Math.max(2, Math.round(100 / settings.fps));
    const context = elements.canvas.getContext("2d", { willReadFrequently: true });
    elements.canvas.width = dimensions.width;
    elements.canvas.height = dimensions.height;

    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(settings.end - 0.02, settings.start + index / settings.fps);
      setStatus(`正在抽帧 ${index + 1}/${frameCount}...`);
      setProgress(Math.round((index / frameCount) * 88));
      await seekVideo(time);
      context.drawImage(elements.video, 0, 0, dimensions.width, dimensions.height);
      const image = context.getImageData(0, 0, dimensions.width, dimensions.height);
      frames.push({
        delayCs,
        indices: window.GIFEncoder.quantizeRgbaTo332(image.data, settings.quality)
      });
      await waitForPaint();
    }
    return frames;
  }

  function seekVideo(time) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("读取视频帧超时，请换 MP4 或缩短片段。"));
      }, 6000);

      function onSeeked() {
        cleanup();
        resolve();
      }

      function onError() {
        cleanup();
        reject(new Error("读取视频帧失败，请换 MP4/H.264 再试。"));
      }

      function cleanup() {
        window.clearTimeout(timeout);
        elements.video.removeEventListener("seeked", onSeeked);
        elements.video.removeEventListener("error", onError);
      }

      elements.video.addEventListener("seeked", onSeeked, { once: true });
      elements.video.addEventListener("error", onError, { once: true });
      elements.video.currentTime = time;
    });
  }

  function reset() {
    state.file = null;
    state.duration = 0;
    state.previewingClip = false;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
    revokeResult();
    elements.fileInput.value = "";
    elements.video.removeAttribute("src");
    elements.video.load();
    elements.sourceMeta.textContent = "未选择";
    elements.resultMeta.textContent = "等待生成";
    elements.convertButton.disabled = true;
    updateClipControlLimits(0);
    setClipValues(0, 0, "metadata");
    setProgress(0);
    setStatus("请选择一个视频。");
  }

  function revokeResult() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = "";
    elements.gifPreview.hidden = true;
    elements.gifPreview.removeAttribute("src");
    elements.resultStage.querySelector("span").hidden = false;
    elements.resultMeta.textContent = "等待生成";
  }

  function setStatus(message, isWarning = false) {
    elements.statusText.textContent = message;
    elements.statusText.style.color = isWarning ? "var(--warning)" : "var(--muted)";
  }

  function setProgress(value) {
    const progress = Math.max(0, Math.min(100, value));
    elements.progressBar.style.width = `${progress}%`;
    elements.progressLabel.textContent = `${progress}%`;
  }

  function waitForPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 MB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function formatSecondsValue(seconds) {
    return (Math.round(Number(seconds || 0) * 10) / 10).toFixed(1);
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function buildOutputName(fileName) {
    const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
    return `${base || "video"}-gif.gif`;
  }
})();
