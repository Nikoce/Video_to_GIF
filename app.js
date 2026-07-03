(function () {
  "use strict";

  const state = {
    videos: [],
    selectedIds: new Set(),
    activeId: "",
    resultUrl: "",
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
    batchPanel: document.getElementById("batchPanel"),
    batchSummary: document.getElementById("batchSummary"),
    selectionSummary: document.getElementById("selectionSummary"),
    videoGrid: document.getElementById("videoGrid"),
    removeAllButton: document.getElementById("removeAllButton"),
    selectAllButton: document.getElementById("selectAllButton"),
    clearSelectionButton: document.getElementById("clearSelectionButton"),
    applyClipButton: document.getElementById("applyClipButton"),
    clipSelection: document.getElementById("clipSelection"),
    clipToggle: document.getElementById("clipToggle"),
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
    taskSummary: document.getElementById("taskSummary"),
    taskBody: document.getElementById("taskBody"),
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
  renderAll();

  function bindEvents() {
    elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", () => {
      const files = [...(elements.fileInput.files || [])];
      if (files.length) addFiles(files);
      elements.fileInput.value = "";
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
      const files = [...(event.dataTransfer.files || [])].filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name));
      if (files.length) addFiles(files);
    });

    elements.video.addEventListener("loadedmetadata", onVideoMetadata);
    elements.video.addEventListener("timeupdate", onVideoTimeUpdate);
    elements.video.addEventListener("error", () => {
      setStatus("这个视频浏览器无法直接读取，建议换 MP4/H.264 再试。", true);
      elements.convertButton.disabled = true;
    });

    elements.videoGrid.addEventListener("click", handleVideoGridClick);
    elements.videoGrid.addEventListener("change", handleVideoGridChange);
    elements.removeAllButton.addEventListener("click", reset);
    elements.selectAllButton.addEventListener("click", () => {
      state.selectedIds = new Set(state.videos.map((item) => item.id));
      renderVideoGrid();
      updateControls();
    });
    elements.clearSelectionButton.addEventListener("click", () => {
      state.selectedIds.clear();
      renderVideoGrid();
      updateControls();
    });
    elements.applyClipButton.addEventListener("click", applyActiveClipToSelected);

    elements.clipToggle.addEventListener("change", () => {
      const active = getActiveVideo();
      if (!active?.duration) return;
      active.clip.useClip = elements.clipToggle.checked;
      if (!active.clip.end) {
        active.clip.end = Math.min(5, active.duration);
      }
      setClipControls(active.clip.start, active.clip.end || active.duration, active.duration);
      updateCompressionHint();
      renderVideoGrid();
      updateControls();
      clearResultPreview();
    });
    elements.startInput.addEventListener("input", () => setActiveClip(Number(elements.startInput.value), Number(elements.endInput.value), "start"));
    elements.endInput.addEventListener("input", () => setActiveClip(Number(elements.startInput.value), Number(elements.endInput.value), "end"));
    elements.clipStartRange.addEventListener("input", () => setActiveClip(Number(elements.clipStartRange.value), Number(elements.endInput.value), "start"));
    elements.clipEndRange.addEventListener("input", () => setActiveClip(Number(elements.startInput.value), Number(elements.clipEndRange.value), "end"));
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
      clearResultPreview();
    });

    [elements.targetMbInput, elements.widthInput, elements.fpsInput, elements.colorsInput].forEach((element) => {
      element.addEventListener("input", () => {
        state.preset = "custom";
        elements.compressionMode.value = "custom";
        normalizeCompressionControls(false);
        updateCompressionHint();
        clearResultPreview();
      });
      element.addEventListener("change", () => {
        normalizeCompressionControls(true);
        updateCompressionHint();
      });
    });

    elements.convertButton.addEventListener("click", convertAll);
    elements.resetButton.addEventListener("click", reset);
  }

  function addFiles(files) {
    for (const file of files) {
      const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`;
      const objectUrl = URL.createObjectURL(file);
      state.videos.push({
        id,
        file,
        objectUrl,
        duration: 0,
        width: 0,
        height: 0,
        clip: { start: 0, end: 0, useClip: false },
        status: "waiting",
        message: "等待生成 GIF。",
        resultUrl: "",
        resultSize: 0
      });
      const item = state.videos[state.videos.length - 1];
      hydrateVideoMetadata(item);
      state.selectedIds.add(id);
      if (!state.activeId) state.activeId = id;
    }
    loadActiveVideo();
    renderAll();
    setStatus(`已选择 ${state.videos.length} 个视频。`);
  }

  function hydrateVideoMetadata(item) {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.src = item.objectUrl;
    probe.addEventListener("loadedmetadata", () => {
      item.duration = Number(probe.duration || 0);
      item.width = Number(probe.videoWidth || 0);
      item.height = Number(probe.videoHeight || 0);
      if (Number.isFinite(item.duration) && item.duration > 0 && !item.clip.end) {
        item.clip = {
          start: 0,
          end: Math.min(5, item.duration),
          useClip: false
        };
      }
      if (item.id === state.activeId) {
        elements.sourceMeta.textContent = `${formatDuration(item.duration)} · ${formatBytes(item.file.size)}`;
        setClipControls(item.clip.start, item.clip.end || item.duration, item.duration);
        updateCompressionHint();
      }
      renderAll();
    }, { once: true });
    probe.addEventListener("error", () => {
      item.status = "failed";
      item.message = "这个视频浏览器无法读取，建议换 MP4/H.264 再试。";
      renderAll();
    }, { once: true });
    probe.load();
  }

  function getActiveVideo() {
    return state.videos.find((item) => item.id === state.activeId) || null;
  }

  function loadActiveVideo() {
    const active = getActiveVideo();
    clearResultPreview();
    if (!active) {
      elements.video.removeAttribute("src");
      elements.video.load();
      elements.sourceMeta.textContent = "未选择";
      updateClipControlLimits(0);
      setClipControls(0, 0, 0);
      return;
    }
    elements.video.src = active.objectUrl;
    elements.video.load();
    elements.sourceMeta.textContent = active.duration
      ? `${formatDuration(active.duration)} · ${formatBytes(active.file.size)}`
      : `${formatBytes(active.file.size)}`;
    if (active.duration) {
      updateClipControlLimits(active.duration);
      setClipControls(active.clip.start, active.clip.end || active.duration, active.duration);
    }
  }

  function onVideoMetadata() {
    const active = getActiveVideo();
    if (!active) return;
    active.duration = Number(elements.video.duration || 0);
    active.width = Number(elements.video.videoWidth || 0);
    active.height = Number(elements.video.videoHeight || 0);
    if (!Number.isFinite(active.duration) || active.duration <= 0) {
      setStatus("无法读取视频时长，请换一个文件再试。", true);
      elements.convertButton.disabled = true;
      return;
    }
    if (!active.clip.end) {
      active.clip = {
        start: 0,
        end: Math.min(5, active.duration),
        useClip: false
      };
    }
    updateClipControlLimits(active.duration);
    setClipControls(active.clip.start, active.clip.end, active.duration);
    elements.sourceMeta.textContent = `${formatDuration(active.duration)} · ${formatBytes(active.file.size)}`;
    updateCompressionHint();
    renderVideoGrid();
    updateControls();
    setStatus("可以生成 GIF。");
  }

  function updateClipControlLimits(duration) {
    const max = Math.max(0, Number(duration || 0)).toFixed(1);
    const active = getActiveVideo();
    const clipEnabled = Boolean(active?.clip.useClip);
    [elements.startInput, elements.endInput, elements.clipStartRange, elements.clipEndRange].forEach((input) => {
      input.max = max;
      input.step = "0.1";
      input.disabled = !duration || state.busy || !clipEnabled;
    });
    elements.markStartButton.disabled = !duration || state.busy || !clipEnabled;
    elements.markEndButton.disabled = !duration || state.busy || !clipEnabled;
    elements.previewClipButton.disabled = !duration || state.busy || !clipEnabled;
    elements.clipToggle.disabled = !duration || state.busy;
  }

  function setActiveClip(rawStart, rawEnd, source = "") {
    const active = getActiveVideo();
    if (!active?.duration) return;
    const values = normalizeClip(rawStart, rawEnd, active.duration, source);
    active.clip = { ...active.clip, ...values, useClip: true };
    setClipControls(values.start, values.end, active.duration);
    updateCompressionHint();
    renderVideoGrid();
    if (source && source !== "metadata" && state.resultUrl) clearResultPreview();
  }

  function normalizeClip(rawStart, rawEnd, duration, source = "") {
    const max = Math.max(0, Number(duration || 0));
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
    return { start, end };
  }

  function setClipControls(start, end, duration) {
    elements.startInput.value = formatSecondsValue(start);
    elements.endInput.value = formatSecondsValue(end);
    elements.clipStartRange.value = String(start);
    elements.clipEndRange.value = String(end);
    const selectedDuration = Math.max(0, end - start);
    const active = getActiveVideo();
    const useClip = Boolean(active?.clip.useClip);
    elements.clipToggle.checked = useClip;
    elements.clipSelection.classList.toggle("clip-enabled", useClip);
    elements.clipDurationLabel.textContent = duration
      ? useClip
        ? `截取 ${formatDuration(selectedDuration)} · ${formatSecondsValue(start)}s - ${formatSecondsValue(end)}s`
        : `默认整段转 GIF · ${formatDuration(duration)}`
      : "选择视频后默认整段转 GIF";
    const startPct = duration && useClip ? (start / duration) * 100 : 0;
    const endPct = duration && useClip ? (end / duration) * 100 : duration ? 100 : 0;
    elements.clipSelection.style.setProperty("--clip-start-pct", `${Math.max(0, Math.min(100, startPct))}%`);
    elements.clipSelection.style.setProperty("--clip-end-pct", `${Math.max(0, Math.min(100, endPct))}%`);
  }

  function getEffectiveClip(item) {
    if (!item?.duration) return { start: 0, end: 0, useClip: false };
    if (!item.clip?.useClip) return { start: 0, end: item.duration, useClip: false };
    const values = normalizeClip(item.clip.start, item.clip.end || item.duration, item.duration, "end");
    return { ...values, useClip: true };
  }

  function formatClipSummary(item) {
    if (!item.duration) return "等待读取";
    const clip = getEffectiveClip(item);
    return clip.useClip
      ? `截取 ${formatSecondsValue(clip.start)}-${formatSecondsValue(clip.end)} 秒`
      : "整段";
  }

  function onVideoTimeUpdate() {
    elements.clipCurrentTime.textContent = formatDuration(elements.video.currentTime || 0);
    if (!state.previewingClip) return;
    const active = getActiveVideo();
    if (!active) return;
    if (!active.clip.useClip) return;
    if (elements.video.currentTime >= active.clip.end) {
      state.previewingClip = false;
      elements.video.pause();
      elements.video.currentTime = active.clip.start;
      setStatus("截选片段预览结束。");
    }
  }

  function markCurrentFrameAsStart() {
    const active = getActiveVideo();
    if (!active?.duration) return;
    const current = clampNumber(elements.video.currentTime || 0, 0, active.duration);
    const end = Math.max(active.clip.end || active.duration, current + 0.1);
    setActiveClip(current, Math.min(end, active.duration), "start");
    setStatus("已把当前画面设为开始点。");
  }

  function markCurrentFrameAsEnd() {
    const active = getActiveVideo();
    if (!active?.duration) return;
    const current = clampNumber(elements.video.currentTime || 0, 0, active.duration);
    const start = Math.min(active.clip.start || 0, current - 0.1);
    setActiveClip(Math.max(0, start), current, "end");
    setStatus("已把当前画面设为结束点。");
  }

  async function previewSelectedClip() {
    const active = getActiveVideo();
    if (!active?.duration) return;
    state.previewingClip = true;
    elements.video.currentTime = active.clip.start;
    try {
      await elements.video.play();
      setStatus("正在预览截选片段。");
    } catch {
      state.previewingClip = false;
      setStatus("浏览器阻止自动播放，可以手动点击视频播放预览。", true);
    }
  }

  function applyActiveClipToSelected() {
    const active = getActiveVideo();
    if (!active?.duration || !state.selectedIds.size) return;
    for (const item of state.videos) {
      if (!state.selectedIds.has(item.id) || !item.duration) continue;
      item.clip = active.clip.useClip
        ? clipToDuration(active.clip.start, active.clip.end, item.duration)
        : { start: 0, end: Math.min(5, item.duration), useClip: false };
    }
    renderVideoGrid();
    updateCompressionHint();
    setStatus(active.clip.useClip
      ? `已把当前截选时间套用到 ${state.selectedIds.size} 个选中视频。`
      : `已把“整段转 GIF”套用到 ${state.selectedIds.size} 个选中视频。`);
  }

  function clipToDuration(rawStart, rawEnd, duration) {
    const max = Math.max(0, Number(duration || 0));
    const length = Math.max(0.1, Number(rawEnd || 0) - Number(rawStart || 0));
    const start = clampNumber(rawStart, 0, Math.max(0, max - 0.1));
    const end = Math.min(max, Math.max(start + 0.1, rawEnd));
    if (end > start) return { start, end, useClip: true };
    return {
      start: Math.max(0, max - length),
      end: max,
      useClip: true
    };
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
    const active = getActiveVideo();
    const clip = active ? getEffectiveClip(active) : null;
    const duration = clip ? Math.max(clip.end - clip.start, 0) : 0;
    const durationHint = duration ? ` 当前${clip.useClip ? "片段" : "整段"}约 ${duration.toFixed(1)} 秒。` : "";
    elements.compressionHint.textContent = `${presetHint}${durationHint} 当前参数：${settings.targetMb} MB / ${settings.width}px / ${settings.fps}fps / ${settings.colors}色。`;
  }

  async function convertAll() {
    const queue = state.videos.filter((item) => item.duration > 0);
    if (!queue.length || state.busy) return;

    state.busy = true;
    elements.convertButton.disabled = true;
    clearResultPreview();
    setProgress(0);

    try {
      const ffmpeg = await ensureFfmpeg();
      for (const [index, item] of queue.entries()) {
        await convertOne(ffmpeg, item, index, queue.length);
        renderTasks();
      }
      setProgress(100);
      setStatus(`完成：${queue.length} 个视频已处理。`);
    } catch (error) {
      setStatus(normalizeErrorMessage(error), true);
    } finally {
      state.busy = false;
      updateControls();
      renderVideoGrid();
    }
  }

  function normalizeErrorMessage(error) {
    const message = String(error?.message || error || "");
    if (/Worker|cannot be accessed|SecurityError|cross-origin|cross origin/i.test(message)) {
      return "FFmpeg 组件被浏览器安全策略拦截，请刷新页面后重试；如果仍失败，请确认正在使用最新版链接。";
    }
    return message || "生成失败，请刷新页面后再试。";
  }

  async function convertOne(ffmpeg, item, index, total) {
    const settings = readSettingsForItem(item);
    if (!settings.valid) {
      item.status = "failed";
      item.message = settings.message;
      return;
    }

    const inputName = `input-${index}${getExtension(item.file.name) || ".mp4"}`;
    const outputName = `output-${index}.gif`;
    await cleanupFfmpegFiles(ffmpeg, [inputName, outputName]);

    item.status = "running";
    item.message = `正在处理 ${index + 1}/${total}...`;
    renderTasks();
    setStatus(item.message);
    setProgress(Math.round((index / total) * 100));

    try {
      await ffmpeg.writeFile(inputName, await window.FFmpegUtil.fetchFile(item.file));
      await ffmpeg.exec(buildFfmpegArgs(inputName, outputName, settings));
      const data = await ffmpeg.readFile(outputName);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      const blob = new Blob([data.buffer], { type: "image/gif" });
      item.resultUrl = URL.createObjectURL(blob);
      item.resultSize = blob.size;
      item.status = blob.size > settings.targetBytes ? "qualityRisk" : "passed";
      item.message = blob.size > settings.targetBytes
        ? `GIF 已生成，当前 ${formatBytes(blob.size)}，高于目标大小。`
        : `GIF 已生成，当前 ${formatBytes(blob.size)}。`;
      showResultPreview(item);
      await cleanupFfmpegFiles(ffmpeg, [inputName, outputName]);
    } catch (error) {
      item.status = "failed";
      item.message = error.message || "生成失败，请缩短片段或降低参数后再试。";
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
      const percent = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100);
      setProgress(percent);
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
        // File may not exist.
      }
    }));
  }

  function readSettingsForItem(item) {
    const compression = readCompressionSettings();
    const clip = getEffectiveClip(item);
    const start = Number(clip.start || 0);
    const end = Number(clip.end || item.duration || 0);
    if (!item.duration) return { valid: false, message: "请先等视频读取完成。" };
    if (end <= start) return { valid: false, message: "结束时间需要大于开始时间。" };
    if (start < 0 || end > item.duration + 0.05) return { valid: false, message: "截取时间不能超出视频时长。" };
    if ((end - start) * compression.fps > 260) return { valid: false, message: "当前片段帧数太多，请缩短时长或降低 FPS。" };
    return { valid: true, start, end, ...compression };
  }

  function readCompressionSettings() {
    const targetMb = clampNumber(elements.targetMbInput.value, 0.2, 20);
    const width = Math.max(1, Math.round(clampNumber(elements.widthInput.value, 1, 1920)));
    const fps = Math.round(clampNumber(elements.fpsInput.value, 4, 20));
    const colors = Math.round(clampNumber(elements.colorsInput.value, 32, 256));
    return { targetMb, targetBytes: targetMb * 1024 * 1024, width, fps, colors };
  }

  function handleVideoGridClick(event) {
    const removeButton = event.target.closest(".video-remove-button");
    if (removeButton) {
      removeVideo(removeButton.dataset.id);
      return;
    }
    const tile = event.target.closest(".video-preview-tile");
    if (!tile || event.target.closest(".video-preview-check")) return;
    state.activeId = tile.dataset.id;
    loadActiveVideo();
    renderAll();
  }

  function handleVideoGridChange(event) {
    if (!event.target.classList.contains("video-preview-select")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    renderVideoGrid();
    updateControls();
  }

  function removeVideo(id) {
    const index = state.videos.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [item] = state.videos.splice(index, 1);
    URL.revokeObjectURL(item.objectUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    state.selectedIds.delete(id);
    if (state.activeId === id) state.activeId = state.videos[0]?.id || "";
    loadActiveVideo();
    renderAll();
  }

  function renderAll() {
    renderVideoGrid();
    renderTasks();
    updateControls();
  }

  function renderVideoGrid() {
    elements.batchPanel.classList.toggle("hidden", !state.videos.length);
    elements.batchSummary.textContent = state.videos.length
      ? `已选择 ${state.videos.length} 个视频，勾选后可批量套用整段/截取设置，点击卡片可单独微调。当前压缩：${getCompressionLabel()}。`
      : "所有待生成视频都会显示在这里。";
    elements.selectionSummary.textContent = state.selectedIds.size
      ? `已选 ${state.selectedIds.size}/${state.videos.length} 个视频`
      : "未选择视频";
    elements.videoGrid.innerHTML = state.videos.map((item) => {
      const selected = state.selectedIds.has(item.id);
      const clipText = formatClipSummary(item);
      return `
        <article class="video-preview-tile ${item.id === state.activeId ? "active" : ""} ${selected ? "selected" : ""}" data-id="${escapeHtml(item.id)}">
          <label class="video-preview-check" title="选择这个视频用于批量套用当前设置">
            <input class="video-preview-select" data-id="${escapeHtml(item.id)}" type="checkbox" ${selected ? "checked" : ""} ${state.busy ? "disabled" : ""} />
            <span>选中</span>
          </label>
          <button class="video-remove-button" data-id="${escapeHtml(item.id)}" type="button" aria-label="移除 ${escapeHtml(item.file.name)}">×</button>
          <video src="${item.objectUrl}" controls preload="metadata"></video>
          <div class="video-preview-caption" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
          <span class="video-clip-badge">${escapeHtml(clipText)}</span>
        </article>
      `;
    }).join("");
  }

  function renderTasks() {
    if (!state.videos.length) {
      elements.taskSummary.textContent = "还没有任务。选择视频后即可生成。";
      elements.taskBody.className = "task-body empty";
      elements.taskBody.textContent = "暂无任务";
      return;
    }
    const done = state.videos.filter((item) => ["passed", "qualityRisk", "failed"].includes(item.status)).length;
    elements.taskSummary.textContent = state.busy
      ? `视频转 GIF 中：${done}/${state.videos.length} 已结束。`
      : `任务数：${state.videos.length}，已完成 ${done} 个。`;
    elements.taskBody.className = "task-body";
    elements.taskBody.innerHTML = state.videos.map((item) => {
      const canDownload = Boolean(item.resultUrl);
      const statusText = getStatusLabel(item.status);
      return `
        <article class="task-card">
          <div class="task-row">
            <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
            <span class="status-pill">${escapeHtml(statusText)}</span>
          </div>
          <p>${escapeHtml(item.message || "等待生成 GIF。")}</p>
          <div class="task-actions">
            ${canDownload ? `<a class="secondary-button compact-button" href="${item.resultUrl}" download="${escapeHtml(buildOutputName(item.file.name))}">下载 GIF</a>` : ""}
            ${canDownload ? `<button class="secondary-button compact-button" type="button" data-preview-result="${escapeHtml(item.id)}">预览结果</button>` : ""}
          </div>
        </article>
      `;
    }).join("");
    elements.taskBody.querySelectorAll("[data-preview-result]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = state.videos.find((video) => video.id === button.dataset.previewResult);
        if (item) showResultPreview(item);
      });
    });
  }

  function updateControls() {
    const hasVideos = Boolean(state.videos.length);
    const active = getActiveVideo();
    elements.convertButton.disabled = state.busy || !state.videos.some((item) => item.duration > 0);
    elements.convertButton.textContent = state.busy ? "正在生成..." : "全部生成 GIF";
    elements.selectAllButton.disabled = state.busy || !hasVideos;
    elements.clearSelectionButton.disabled = state.busy || !state.selectedIds.size;
    elements.applyClipButton.disabled = state.busy || !active?.duration || !state.selectedIds.size;
    elements.removeAllButton.disabled = state.busy || !hasVideos;
    updateClipControlLimits(active?.duration || 0);
  }

  function showResultPreview(item) {
    if (!item?.resultUrl) return;
    state.resultUrl = item.resultUrl;
    elements.gifPreview.src = item.resultUrl;
    elements.gifPreview.hidden = false;
    elements.resultStage.querySelector("span").hidden = true;
    elements.downloadLink.href = item.resultUrl;
    elements.downloadLink.download = buildOutputName(item.file.name);
    elements.downloadLink.classList.remove("disabled");
    elements.resultMeta.textContent = item.resultSize ? formatBytes(item.resultSize) : "已生成";
  }

  function clearResultPreview() {
    state.resultUrl = "";
    elements.gifPreview.hidden = true;
    elements.gifPreview.removeAttribute("src");
    elements.resultStage.querySelector("span").hidden = false;
    elements.resultMeta.textContent = "等待生成";
    elements.downloadLink.removeAttribute("href");
    elements.downloadLink.classList.add("disabled");
  }

  function reset() {
    state.videos.forEach((item) => {
      URL.revokeObjectURL(item.objectUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    state.videos = [];
    state.selectedIds.clear();
    state.activeId = "";
    state.previewingClip = false;
    clearResultPreview();
    elements.fileInput.value = "";
    loadActiveVideo();
    setProgress(0);
    setStatus("请选择一个视频。");
    renderAll();
  }

  function getCompressionLabel() {
    const selected = elements.compressionMode.selectedOptions?.[0]?.textContent?.trim();
    if (selected) return selected;
    const settings = readCompressionSettings();
    return `自定义参数（${settings.targetMb} MB / ${settings.width}px / ${settings.fps}fps / ${settings.colors}色）`;
  }

  function getStatusLabel(status) {
    return {
      waiting: "等待",
      running: "生成中",
      passed: "完成",
      qualityRisk: "偏大",
      failed: "失败"
    }[status] || "等待";
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
