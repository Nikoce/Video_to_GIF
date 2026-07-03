(function () {
  "use strict";

  const state = {
    file: null,
    objectUrl: "",
    resultUrl: "",
    duration: 0,
    preset: "standard",
    busy: false,
    ffmpeg: null,
    ffmpegReady: false,
    previewingClip: false
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
    compressionMode: document.getElementById("compressionMode"),
    compressionHint: document.getElementById("compressionHint"),
    targetMbInput: document.getElementById("targetMbInput"),
    colorsInput: document.getElementById("colorsInput"),
    convertButton: document.getElementById("convertButton"),
    downloadLink: document.getElementById("downloadLink"),
    statusText: document.getElementById("statusText"),
    progressBar: document.getElementById("progressBar"),
    progressLabel: document.getElementById("progressLabel")
  };

  const presets = {
    "review-min": {
      label: "复盘极小",
      targetMb: 1,
      width: 360,
      fps: 8,
      colors: 96,
      hint: "尽量压到 1 MB 内，适合群里快速复盘。"
    },
    standard: {
      label: "均衡清晰",
      targetMb: 8,
      width: 720,
      fps: 12,
      colors: 192,
      hint: "均衡清晰，适合日常查看。"
    },
    clear: {
      label: "清晰优先",
      targetMb: 5,
      width: 540,
      fps: 12,
      colors: 160,
      hint: "优先保持画面观感，适合需要看细节的 GIF。"
    }
  };

  const ffmpegBaseUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

  bindEvents();
  applyCompressionPreset("standard");

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

    elements.compressionMode.addEventListener("change", () => {
      if (presets[elements.compressionMode.value]) {
        applyCompressionPreset(elements.compressionMode.value);
      } else {
        state.preset = "custom";
        updateCompressionHint();
      }
      revokeResult();
    });

    [elements.targetMbInput, elements.widthInput, elements.fpsInput, elements.colorsInput].forEach((element) => {
      element.addEventListener("input", () => {
        state.preset = "custom";
        elements.compressionMode.value = "custom";
        normalizeCompressionControls(false);
        updateCompressionHint();
        revokeResult();
      });
      element.addEventListener("change", () => {
        normalizeCompressionControls(true);
        updateCompressionHint();
      });
    });

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
    updateCompressionHint();
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
    updateCompressionHint();

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

  function applyCompressionPreset(mode) {
    const preset = presets[mode] || presets.standard;
    state.preset = mode;
    elements.compressionMode.value = mode;
    elements.targetMbInput.value = String(preset.targetMb);
    elements.widthInput.value = String(preset.width);
    elements.fpsInput.value = String(preset.fps);
    elements.colorsInput.value = String(preset.colors);
    updateCompressionHint();
  }

  function normalizeCompressionControls(force = true) {
    if (!force) return;
    elements.targetMbInput.value = String(clampNumber(elements.targetMbInput.value, 0.2, 20));
    elements.widthInput.value = String(Math.round(clampNumber(elements.widthInput.value, 1, 1920)));
    elements.fpsInput.value = String(Math.round(clampNumber(elements.fpsInput.value, 4, 20)));
    elements.colorsInput.value = String(Math.round(clampNumber(elements.colorsInput.value, 32, 256)));
  }

  function updateCompressionHint() {
    const settings = readCompressionSettings();
    const presetHint = presets[state.preset]?.hint || "按自定义参数压缩，大小和清晰度由当前数值决定。";
    const duration = Math.max(Number(elements.endInput.value || 0) - Number(elements.startInput.value || 0), 0);
    const durationHint = duration ? ` 当前片段约 ${duration.toFixed(1)} 秒。` : "";
    elements.compressionHint.textContent = `${presetHint}${durationHint} 当前参数：${settings.targetMb} MB / ${settings.width}px / ${settings.fps}fps / ${settings.colors}色。`;
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
      const ffmpeg = await ensureFfmpeg();
      const inputName = `input${getExtension(state.file.name) || ".mp4"}`;
      const outputName = "output.gif";
      await cleanupFfmpegFiles(ffmpeg, [inputName, outputName]);

      setStatus("正在读取视频...");
      setProgress(10);
      await ffmpeg.writeFile(inputName, await window.FFmpegUtil.fetchFile(state.file));

      setStatus("正在用 FFmpeg 生成 GIF...");
      setProgress(18);
      const args = buildFfmpegArgs(inputName, outputName, settings);
      await ffmpeg.exec(args);

      setStatus("正在准备下载...");
      setProgress(92);
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      state.resultUrl = url;
      elements.gifPreview.src = url;
      elements.gifPreview.hidden = false;
      elements.resultStage.querySelector("span").hidden = true;
      elements.downloadLink.href = url;
      elements.downloadLink.download = buildOutputName(state.file.name);
      elements.downloadLink.classList.remove("disabled");
      elements.resultMeta.textContent = `${formatBytes(blob.size)}`;
      const sizeWarning = blob.size > settings.targetBytes ? "，当前仍高于目标大小，可以降低宽度、FPS 或颜色数" : "";
      setProgress(100);
      setStatus(`完成：${formatBytes(blob.size)}${sizeWarning}。`);
      await cleanupFfmpegFiles(ffmpeg, [inputName, outputName]);
    } catch (error) {
      setStatus(error.message || "生成失败，请缩短片段或降低宽度后再试。", true);
      elements.resultMeta.textContent = "生成失败";
    } finally {
      state.busy = false;
      elements.convertButton.disabled = !state.file;
    }
  }

  async function ensureFfmpeg() {
    if (!window.FFmpegWASM?.FFmpeg || !window.FFmpegUtil?.toBlobURL) {
      throw new Error("FFmpeg 组件没有加载成功，请刷新页面后再试。");
    }

    if (state.ffmpegReady && state.ffmpeg) return state.ffmpeg;

    setStatus("首次使用正在加载 FFmpeg 组件...");
    setProgress(4);
    const ffmpeg = new window.FFmpegWASM.FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      if (!state.busy) return;
      const percent = 18 + Math.round(Math.max(0, Math.min(1, progress || 0)) * 70);
      setProgress(percent);
    });
    ffmpeg.on("log", ({ message }) => {
      if (/error/i.test(message || "")) {
        console.debug(message);
      }
    });

    const { toBlobURL } = window.FFmpegUtil;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${ffmpegBaseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${ffmpegBaseUrl}/ffmpeg-core.wasm`, "application/wasm")
    });
    state.ffmpeg = ffmpeg;
    state.ffmpegReady = true;
    return ffmpeg;
  }

  function buildFfmpegArgs(inputName, outputName, settings) {
    const filter = [
      `fps=${settings.fps}`,
      `scale=w='min(${settings.width},iw)':h=-2:flags=lanczos`,
      `split[s0][s1];[s0]palettegen=max_colors=${settings.colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`
    ].join(",");

    return [
      "-y",
      "-ss", String(settings.start),
      "-t", String(settings.end - settings.start),
      "-i", inputName,
      "-filter_complex", filter,
      "-loop", "0",
      outputName
    ];
  }

  async function cleanupFfmpegFiles(ffmpeg, fileNames) {
    await Promise.all(fileNames.map(async (fileName) => {
      try {
        await ffmpeg.deleteFile(fileName);
      } catch {
        // The file may not exist yet.
      }
    }));
  }

  function readSettings() {
    const compression = readCompressionSettings();
    const start = Number(elements.startInput.value || 0);
    const end = Number(elements.endInput.value || 0);

    if (!state.duration) return { valid: false, message: "请先选择视频。" };
    if (end <= start) return { valid: false, message: "结束时间需要大于开始时间。" };
    if (start < 0 || end > state.duration + 0.05) return { valid: false, message: "截取时间不能超出视频时长。" };
    if ((end - start) * compression.fps > 260) return { valid: false, message: "当前片段帧数太多，请缩短时长或降低 FPS。" };
    return {
      valid: true,
      start,
      end,
      ...compression
    };
  }

  function readCompressionSettings() {
    const targetMb = clampNumber(elements.targetMbInput.value, 0.2, 20);
    const width = Math.max(1, Math.round(clampNumber(elements.widthInput.value, 1, 1920)));
    const fps = Math.round(clampNumber(elements.fpsInput.value, 4, 20));
    const colors = Math.round(clampNumber(elements.colorsInput.value, 32, 256));
    return {
      targetMb,
      targetBytes: targetMb * 1024 * 1024,
      width,
      fps,
      colors
    };
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

  function formatBytes(bytes) {
    if (!bytes) return "0 MB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(totalSeconds / 60);
    const rest = String(totalSeconds % 60).padStart(2, "0");
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

  function getExtension(fileName) {
    const match = String(fileName || "").match(/\.[^.]+$/);
    return match ? match[0].toLowerCase() : "";
  }

  function buildOutputName(fileName) {
    const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
    return `${base || "video"}-gif.gif`;
  }
})();
