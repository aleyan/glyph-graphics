import * as THREE from "three";
import {
  alexHarriAlgorithm,
  buildAlexHarriAlphabet,
  charsets,
  type AlexHarriOptions,
  type Alphabet,
} from "../src/index.js";
import { AsciiTilemap } from "../src/three/index.js";

/* -------------------------------------------------------------------------- */
/* DOM Element Handles                                                        */
/* -------------------------------------------------------------------------- */

const container = document.getElementById("canvas-container") as HTMLDivElement;
const dropOverlay = document.getElementById("drop-overlay") as HTMLDivElement;

const btnUpload = document.getElementById("btn-upload") as HTMLButtonElement;
const btnSample = document.getElementById("btn-sample") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;

const btnPlayPause = document.getElementById("btn-play-pause") as HTMLButtonElement;
const videoControls = document.getElementById("video-controls") as HTMLDivElement;

const selectFont = document.getElementById("select-font") as HTMLSelectElement;

const inputCols = document.getElementById("input-cols") as HTMLInputElement;
const inputQuality = document.getElementById("input-quality") as HTMLInputElement;
const inputGlobalCrunch = document.getElementById("input-globalCrunch") as HTMLInputElement;
const inputDirectionalCrunch = document.getElementById(
  "input-directionalCrunch",
) as HTMLInputElement;

const inputUseColor = document.getElementById("input-useColor") as HTMLInputElement;
const inputBg = document.getElementById("input-bg") as HTMLInputElement;
const inputInk = document.getElementById("input-ink") as HTMLInputElement;

const valCols = document.getElementById("val-cols") as HTMLSpanElement;
const valQuality = document.getElementById("val-quality") as HTMLSpanElement;
const valGlobalCrunch = document.getElementById("val-globalCrunch") as HTMLSpanElement;
const valDirectionalCrunch = document.getElementById("val-directionalCrunch") as HTMLSpanElement;

const statGrid = document.getElementById("stat-grid") as HTMLSpanElement;
const statTime = document.getElementById("stat-time") as HTMLSpanElement;
const statFps = document.getElementById("stat-fps") as HTMLSpanElement;

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

interface Options {
  cols: number;
  quality: number;
  globalCrunch: number;
  directionalCrunch: number;
  useColor: boolean;
}

const params: Options = {
  cols: parseInt(inputCols.value, 10),
  quality: parseInt(inputQuality.value, 10),
  globalCrunch: parseFloat(inputGlobalCrunch.value),
  directionalCrunch: parseFloat(inputDirectionalCrunch.value),
  useColor: inputUseColor.checked,
};

let currentFont = selectFont.value;
let alphabet: Alphabet;
let tilemap: AsciiTilemap;

let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;

// Source media state
let currentSource: HTMLImageElement | HTMLVideoElement | null = null;
let isVideo = false;
let videoPlaying = false;
let animFrameId: number | null = null;
let currentObjectURL: string | null = null;

// Offscreen canvas for extracting RGBA frame data
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d", {
  willReadFrequently: true,
}) as CanvasRenderingContext2D;

// FPS tracking
let lastFrameTime = performance.now();
let frameCount = 0;
let currentFps = 0;

/* -------------------------------------------------------------------------- */
/* Initialization & Font Loading                                             */
/* -------------------------------------------------------------------------- */

async function ensureFontLoaded(family: string): Promise<void> {
  try {
    await document.fonts.load(`64px "${family}", monospace`);
    await document.fonts.ready;
  } catch {
    // Fallback if font load fails or is unsupported
  }
}

async function init(): Promise<void> {
  // Load font for alphabet measurement
  await ensureFontLoaded(currentFont);

  // Build alphabet with shape vectors
  alphabet = buildAlexHarriAlphabet({
    font: { family: `"${currentFont}", monospace`, size: 64 },
    chars: charsets.SHAPE_ASCII,
  });

  // Setup Three.js WebGL scene
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  camera.position.z = 10;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Instantiate AsciiTilemap
  tilemap = new AsciiTilemap(alphabet, {
    background: inputBg.value,
    ink: inputInk.value,
    useColor: params.useColor,
  });

  scene.add(tilemap.mesh);

  // Register event listeners
  setupControls();
  setupDragAndDrop();
  window.addEventListener("resize", onWindowResize);

  // Auto-load sample image
  loadSampleImage();
}

async function updateFont(fontFamily: string): Promise<void> {
  currentFont = fontFamily;
  await ensureFontLoaded(fontFamily);

  alphabet = buildAlexHarriAlphabet({
    font: { family: `"${fontFamily}", monospace`, size: 64 },
    chars: charsets.SHAPE_ASCII,
  });

  if (tilemap) {
    tilemap.dispose();
    scene.remove(tilemap.mesh);
  }

  tilemap = new AsciiTilemap(alphabet, {
    background: inputBg.value,
    ink: inputInk.value,
    useColor: params.useColor,
  });

  scene.add(tilemap.mesh);
  triggerSingleRender();
}

/* -------------------------------------------------------------------------- */
/* Three.js Camera & Layout                                                   */
/* -------------------------------------------------------------------------- */

function fitCameraToTilemap(): void {
  if (!container.clientWidth || !container.clientHeight) return;

  const viewAspect = container.clientWidth / container.clientHeight;
  const meshAspect = tilemap.aspect;

  let w = meshAspect;
  let h = 1;
  const margin = 1.15;

  if (meshAspect / viewAspect > 1) {
    // Constrained by view width
    w *= margin;
    h = w / viewAspect;
  } else {
    // Constrained by view height
    h *= margin;
    w = h * viewAspect;
  }

  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(container.clientWidth, container.clientHeight);
}

function onWindowResize(): void {
  fitCameraToTilemap();
  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------- */
/* Frame Processing & Rendering                                              */
/* -------------------------------------------------------------------------- */

function processCurrentFrame(): void {
  if (!currentSource) return;

  const srcWidth = isVideo
    ? (currentSource as HTMLVideoElement).videoWidth
    : (currentSource as HTMLImageElement).naturalWidth || currentSource.width;

  const srcHeight = isVideo
    ? (currentSource as HTMLVideoElement).videoHeight
    : (currentSource as HTMLImageElement).naturalHeight || currentSource.height;

  if (!srcWidth || !srcHeight) return;

  if (offscreenCanvas.width !== srcWidth || offscreenCanvas.height !== srcHeight) {
    offscreenCanvas.width = srcWidth;
    offscreenCanvas.height = srcHeight;
  }

  offscreenCtx.drawImage(currentSource, 0, 0, srcWidth, srcHeight);
  const imageData = offscreenCtx.getImageData(0, 0, srcWidth, srcHeight);

  // Time Harri converter
  const t0 = performance.now();
  const options: AlexHarriOptions = {
    cols: params.cols,
    quality: params.quality,
    globalCrunch: params.globalCrunch,
    directionalCrunch: params.directionalCrunch,
    color: params.useColor,
  };

  const asciiFrame = alexHarriAlgorithm.convert(imageData, alphabet, options);
  const t1 = performance.now();

  // Upload frame to GPU texture quad
  tilemap.update(asciiFrame);

  fitCameraToTilemap();
  renderer.render(scene, camera);

  // Update UI Stats
  const convertMs = (t1 - t0).toFixed(1);
  statGrid.textContent = `${asciiFrame.cols} × ${asciiFrame.rows} (${asciiFrame.cols * asciiFrame.rows} chars)`;
  statTime.textContent = `${convertMs} ms`;

  // Calculate FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFrameTime >= 1000) {
    currentFps = Math.round((frameCount * 1000) / (now - lastFrameTime));
    statFps.textContent = `${currentFps} FPS`;
    frameCount = 0;
    lastFrameTime = now;
  }
}

function renderLoop(): void {
  if (isVideo && videoPlaying) {
    processCurrentFrame();
    animFrameId = requestAnimationFrame(renderLoop);
  }
}

function triggerSingleRender(): void {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  processCurrentFrame();
}

/* -------------------------------------------------------------------------- */
/* Media Loading                                                              */
/* -------------------------------------------------------------------------- */

function loadSampleImage(): void {
  const img = new Image();
  img.src = "/demo_at_frame.png";
  img.onload = () => {
    setMediaSource(img, false);
  };
}

function setMediaSource(media: HTMLImageElement | HTMLVideoElement, isVid: boolean): void {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  if (currentSource && isVideo) {
    (currentSource as HTMLVideoElement).pause();
  }

  currentSource = media;
  isVideo = isVid;

  if (isVid) {
    const video = media as HTMLVideoElement;
    videoControls.classList.add("visible");
    videoPlaying = true;
    btnPlayPause.textContent = "⏸️ Pause";

    video.play().then(() => {
      renderLoop();
    }).catch(() => {
      renderLoop();
    });
  } else {
    videoControls.classList.remove("visible");
    videoPlaying = false;
    triggerSingleRender();
  }
}

function loadFile(file: File): void {
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
  }

  currentObjectURL = URL.createObjectURL(file);
  const isVideoFile = file.type.startsWith("video/") || /\.mp4|\.webm|\.mov$/i.test(file.name);

  if (isVideoFile) {
    const video = document.createElement("video");
    video.src = currentObjectURL;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      setMediaSource(video, true);
    };
  } else {
    const img = new Image();
    img.src = currentObjectURL;
    img.onload = () => {
      setMediaSource(img, false);
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Event Handlers & Controls                                                  */
/* -------------------------------------------------------------------------- */

function setupControls(): void {
  btnUpload.addEventListener("click", () => fileInput.click());
  btnSample.addEventListener("click", () => loadSampleImage());

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      loadFile(fileInput.files[0]);
    }
  });

  btnPlayPause.addEventListener("click", () => {
    if (!isVideo || !currentSource) return;
    const video = currentSource as HTMLVideoElement;
    if (videoPlaying) {
      video.pause();
      videoPlaying = false;
      btnPlayPause.textContent = "▶️ Play";
      if (animFrameId) cancelAnimationFrame(animFrameId);
    } else {
      video.play();
      videoPlaying = true;
      btnPlayPause.textContent = "⏸️ Pause";
      renderLoop();
    }
  });

  // Font Selection dropdown
  selectFont.addEventListener("change", () => {
    void updateFont(selectFont.value);
  });

  // Slider inputs
  inputCols.addEventListener("input", () => {
    params.cols = parseInt(inputCols.value, 10);
    valCols.textContent = String(params.cols);
    triggerSingleRender();
  });

  inputQuality.addEventListener("input", () => {
    params.quality = parseInt(inputQuality.value, 10);
    valQuality.textContent = String(params.quality);
    triggerSingleRender();
  });

  inputGlobalCrunch.addEventListener("input", () => {
    params.globalCrunch = parseFloat(inputGlobalCrunch.value);
    valGlobalCrunch.textContent = params.globalCrunch.toFixed(1);
    triggerSingleRender();
  });

  inputDirectionalCrunch.addEventListener("input", () => {
    params.directionalCrunch = parseFloat(inputDirectionalCrunch.value);
    valDirectionalCrunch.textContent = params.directionalCrunch.toFixed(1);
    triggerSingleRender();
  });

  inputUseColor.addEventListener("change", () => {
    params.useColor = inputUseColor.checked;
    tilemap.setUseColor(params.useColor);
    triggerSingleRender();
  });

  inputBg.addEventListener("input", () => {
    tilemap.setBackground(inputBg.value);
    renderer.render(scene, camera);
  });

  inputInk.addEventListener("input", () => {
    tilemap.setInk(inputInk.value);
    renderer.render(scene, camera);
  });
}

function setupDragAndDrop(): void {
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropOverlay.classList.add("active");
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (e.relatedTarget === null) {
      dropOverlay.classList.remove("active");
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dropOverlay.classList.remove("active");

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadFile(e.dataTransfer.files[0]);
    }
  });
}

/* Initialize application on load */
init();
