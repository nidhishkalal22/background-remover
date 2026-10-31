const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_DIMENSION = 1500;

const $ = (selector) => document.querySelector(selector);
const uploadPanel = $("#upload-panel");
const fileInput = $("#file-input");
const chooseButton = $("#choose-button");
const processingCard = $("#processing-card");
const resultsSection = $("#results-section");
const errorMessage = $("#error-message");
const progressBar = $("#progress-bar");
const progressValue = $("#progress-value");
const processingTitle = $("#processing-title");
const processingDetail = $("#processing-detail");
const comparisonShell = $("#comparison-shell");
const comparisonRange = $("#comparison-range");
const originalImage = $("#original-image");
const resultImage = $("#result-image");
const resultLayer = $("#result-layer");
const fileMeta = $("#file-meta");
const colorInput = $("#color-input");
const resultCanvas = $("#resultCanvas");
const editorViewport = $("#editor-viewport");
const editorContext = resultCanvas.getContext("2d", { willReadFrequently: true });
const brushSizeInput = $("#brush-size");
const brushSizeValue = $("#brush-size-value");
const zoomValue = $("#zoom-value");
const undoButton = $("#undo-button");
const redoButton = $("#redo-button");

let originalUrl = "";
let resultUrl = "";
let resultBlob = null;
let selectedBackground = "transparent";
let processing = false;
let originalImageData = null;
let originalAlpha = null;
let aiAlpha = null;
let currentAlpha = null;
let alphaHistory = [];
let historyIndex = -1;
let brushMode = "restore";
let zoom = 1;
let drawing = false;
let strokeChanged = false;

chooseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && handleFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => uploadPanel.addEventListener(eventName, (event) => {
  event.preventDefault();
  uploadPanel.classList.add("drag-over");
}));
["dragleave", "drop"].forEach((eventName) => uploadPanel.addEventListener(eventName, (event) => {
  event.preventDefault();
  uploadPanel.classList.remove("drag-over");
}));
uploadPanel.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) handleFile(file);
});

comparisonRange.addEventListener("input", (event) => {
  comparisonShell.style.setProperty("--split", `${event.target.value}%`);
});

document.querySelectorAll(".swatch").forEach((swatch) => swatch.addEventListener("click", () => setBackground(swatch.dataset.color)));
colorInput.addEventListener("input", (event) => setBackground(event.target.value));
$("#download-png").addEventListener("click", () => downloadResult("png"));
$("#download-jpg").addEventListener("click", () => downloadResult("jpeg"));
$("#reset-button").addEventListener("click", reset);
$("#theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  $("#theme-toggle").textContent = document.body.classList.contains("dark") ? "☀" : "☾";
});
$("#restore-mode").addEventListener("click", () => setBrushMode("restore"));
$("#erase-mode").addEventListener("click", () => setBrushMode("erase"));
brushSizeInput.addEventListener("input", () => { brushSizeValue.value = `${brushSizeInput.value}px`; });
$("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.25));
$("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.25));
$("#reset-ai-button").addEventListener("click", resetToAiResult);
undoButton.addEventListener("click", () => moveHistory(-1));
redoButton.addEventListener("click", () => moveHistory(1));
resultCanvas.addEventListener("pointerdown", startStroke);
resultCanvas.addEventListener("pointermove", continueStroke);
resultCanvas.addEventListener("pointerup", finishStroke);
resultCanvas.addEventListener("pointercancel", finishStroke);

async function handleFile(file) {
  if (processing) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return showError("Please choose a PNG, JPG, JPEG, or WEBP image.");
  if (file.size > MAX_FILE_SIZE) return showError("That image is larger than 10 MB. Please choose a smaller file.");
  clearError();
  processing = true;
  chooseButton.disabled = true;
  originalUrl = URL.createObjectURL(file);
  originalImage.src = originalUrl;
  processingCard.classList.remove("is-hidden");
  resultsSection.classList.add("is-hidden");
  setProgress(3, "Preparing your image", "Optimizing dimensions for faster processing…");
  try {
    const preparedImage = await resizeImage(file);
    setProgress(10, "Processing image", "Doing this might take a while.");
    // The bundled ESM build includes the package dependencies for native browser imports.
    const { removeBackground } = await import("https://esm.sh/@imgly/background-removal@1.4.5?bundle");
    const blob = await removeBackground(preparedImage, {
      progress: (key, current, total) => {
        const ratio = total ? current / total : 0;
        const percent = Math.min(98, Math.max(10, Math.round(10 + ratio * 88)));
        setProgress(percent, key.toLowerCase().includes("fetch") ? "Loading AI model" : "Removing background", "Your image is being processed locally…");
      },
    });
    resultBlob = blob;
    resultUrl = URL.createObjectURL(blob);
    resultImage.src = resultUrl;
    await initializeRefinement(preparedImage, blob);
    fileMeta.textContent = `PNG · ${formatBytes(blob.size)} processed`;
    setProgress(100, "All done", "Your cutout is ready to download.");
    setTimeout(() => {
      processingCard.classList.add("is-hidden");
      resultsSection.classList.remove("is-hidden");
    }, 350);
  } catch (error) {
    console.error("Background removal failed:", error);
    showError("We couldn't process that image. Please try another file or refresh and try again.");
    processingCard.classList.add("is-hidden");
  } finally {
    processing = false;
    chooseButton.disabled = false;
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare image")), "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    image.src = url;
  });
}

function setProgress(percent, title, detail) {
  progressBar.style.width = `${percent}%`;
  progressValue.textContent = `${percent}%`;
  processingTitle.textContent = title;
  processingDetail.textContent = detail;
}

function setBackground(color) {
  selectedBackground = color;
  resultLayer.style.background = color;
  document.querySelectorAll(".swatch").forEach((swatch) => swatch.classList.toggle("active", swatch.dataset.color === color));
}

function downloadResult(format) {
  if (!resultBlob || !resultCanvas.width) return;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = resultCanvas.width;
  exportCanvas.height = resultCanvas.height;
  const context = exportCanvas.getContext("2d");
  if (format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }
  context.drawImage(resultCanvas, 0, 0);
  const extension = format === "jpeg" ? "jpg" : "png";
  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bg-remover-result.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, `image/${format}`);
}

function reset() {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  originalUrl = ""; resultUrl = ""; resultBlob = null; fileInput.value = "";
  originalImageData = null; originalAlpha = null; aiAlpha = null; currentAlpha = null;
  alphaHistory = []; historyIndex = -1; drawing = false; setZoom(1); updateHistoryButtons();
  editorContext.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  resultsSection.classList.add("is-hidden"); processingCard.classList.add("is-hidden"); clearError();
  setBackground("transparent"); comparisonRange.value = 50; comparisonShell.style.setProperty("--split", "50%");
}

function showError(message) { errorMessage.textContent = message; errorMessage.classList.remove("is-hidden"); }
function clearError() { errorMessage.classList.add("is-hidden"); errorMessage.textContent = ""; }
function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }

async function initializeRefinement(sourceBlob, processedBlob) {
  const sourceImage = await loadImage(sourceBlob);
  const processedImage = await loadImage(processedBlob);
  const width = sourceImage.naturalWidth;
  const height = sourceImage.naturalHeight;
  resultCanvas.width = width;
  resultCanvas.height = height;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCanvas.getContext("2d").drawImage(sourceImage, 0, 0, width, height);
  originalImageData = sourceCanvas.getContext("2d").getImageData(0, 0, width, height);
  originalAlpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < originalAlpha.length; index += 1) originalAlpha[index] = originalImageData.data[index * 4 + 3];

  const processedCanvas = document.createElement("canvas");
  processedCanvas.width = width;
  processedCanvas.height = height;
  processedCanvas.getContext("2d").drawImage(processedImage, 0, 0, width, height);
  const processedData = processedCanvas.getContext("2d").getImageData(0, 0, width, height);
  aiAlpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < aiAlpha.length; index += 1) aiAlpha[index] = processedData.data[index * 4 + 3];
  currentAlpha = new Uint8ClampedArray(aiAlpha);
  alphaHistory = [new Uint8ClampedArray(currentAlpha)];
  historyIndex = 0;
  setZoom(1);
  renderEditor();
  updateHistoryButtons();
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load editor image")); };
    image.src = url;
  });
}

function renderEditor() {
  if (!originalImageData || !currentAlpha) return;
  const output = new ImageData(new Uint8ClampedArray(originalImageData.data), resultCanvas.width, resultCanvas.height);
  for (let index = 0; index < currentAlpha.length; index += 1) output.data[index * 4 + 3] = currentAlpha[index];
  editorContext.putImageData(output, 0, 0);
}

function setBrushMode(mode) {
  brushMode = mode;
  $("#restore-mode").classList.toggle("active", mode === "restore");
  $("#erase-mode").classList.toggle("active", mode === "erase");
}

function setZoom(nextZoom) {
  zoom = Math.min(3, Math.max(0.5, nextZoom));
  resultCanvas.style.width = `${zoom * 100}%`;
  resultCanvas.style.maxWidth = zoom > 1 ? "none" : "100%";
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  editorViewport.scrollLeft = 0;
  editorViewport.scrollTop = 0;
}

function getCanvasPoint(event) {
  const bounds = resultCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(resultCanvas.width - 1, (event.clientX - bounds.left) * resultCanvas.width / bounds.width)),
    y: Math.max(0, Math.min(resultCanvas.height - 1, (event.clientY - bounds.top) * resultCanvas.height / bounds.height)),
  };
}

function startStroke(event) {
  if (!currentAlpha) return;
  event.preventDefault();
  resultCanvas.setPointerCapture(event.pointerId);
  drawing = true;
  strokeChanged = false;
  paintAt(getCanvasPoint(event));
}

function continueStroke(event) {
  if (!drawing) return;
  event.preventDefault();
  paintAt(getCanvasPoint(event));
}

function finishStroke(event) {
  if (!drawing) return;
  drawing = false;
  if (event.pointerId !== undefined && resultCanvas.hasPointerCapture(event.pointerId)) resultCanvas.releasePointerCapture(event.pointerId);
  if (strokeChanged) {
    alphaHistory = alphaHistory.slice(0, historyIndex + 1);
    alphaHistory.push(new Uint8ClampedArray(currentAlpha));
    historyIndex += 1;
    updateHistoryButtons();
    updateResultPreview();
  }
}

function paintAt(point) {
  const radius = Number(brushSizeInput.value) / 2;
  const left = Math.max(0, Math.floor(point.x - radius));
  const right = Math.min(resultCanvas.width - 1, Math.ceil(point.x + radius));
  const top = Math.max(0, Math.floor(point.y - radius));
  const bottom = Math.min(resultCanvas.height - 1, Math.ceil(point.y + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (Math.hypot(x - point.x, y - point.y) <= radius) {
        const index = y * resultCanvas.width + x;
        const nextAlpha = brushMode === "restore" ? originalAlpha[index] : 0;
        if (currentAlpha[index] !== nextAlpha) {
          currentAlpha[index] = nextAlpha;
          strokeChanged = true;
        }
      }
    }
  }
  if (strokeChanged) renderEditor();
}

function moveHistory(direction) {
  const nextIndex = historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= alphaHistory.length) return;
  historyIndex = nextIndex;
  currentAlpha = new Uint8ClampedArray(alphaHistory[historyIndex]);
  renderEditor();
  updateHistoryButtons();
  updateResultPreview();
}

function resetToAiResult() {
  if (!aiAlpha) return;
  currentAlpha = new Uint8ClampedArray(aiAlpha);
  alphaHistory = [new Uint8ClampedArray(currentAlpha)];
  historyIndex = 0;
  renderEditor();
  updateHistoryButtons();
  updateResultPreview();
}

function updateHistoryButtons() {
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex < 0 || historyIndex >= alphaHistory.length - 1;
}

function updateResultPreview() {
  resultCanvas.toBlob((blob) => {
    if (!blob) return;
    resultBlob = blob;
    const nextUrl = URL.createObjectURL(blob);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = nextUrl;
    resultImage.src = resultUrl;
    fileMeta.textContent = `PNG · ${formatBytes(blob.size)} processed`;
  }, "image/png");
}
