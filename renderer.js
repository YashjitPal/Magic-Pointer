/* Googlebook Magic Pointer Renderer — Zero-Latency 120fps+ GPU Pipeline */

// CursorManagerImpl.kthotspot fractions on a 24x24px canvas (scaled 2/3 from 36x36dp to match Windows system cursor size):
// - select: (0.16666667f, 0.16666667f) -> (4px, 4px)
// - crosshair: (0.5f, 0.4722222f) -> (12px, 11.33px)
// - ibeam: (0.3888889f, 0.4722222f) -> (9.33px, 11.33px)
const CURSORS = {
  select: { src: 'extracted_assets/svg/magic_pointer_select_cursor_image.svg', hotX: 4, hotY: 4 },
  crosshair: { src: 'extracted_assets/svg/magic_pointer_crosshair_cursor_image.svg', hotX: 12, hotY: 11.33 },
  ibeam: { src: 'extracted_assets/svg/magic_pointer_ibeam_cursor_image.svg', hotX: 9.33, hotY: 11.33 }
};

// State
const state = {
  active: false,
  expanded: false,
  selectingMoreScreen: false,
  isDarkMode: true,
  sensitivityLevel: 0,
  cursorX: window.innerWidth / 2,
  cursorY: window.innerHeight / 2,
  cursorType: 'crosshair',
  // Spring/Lerp target & current coordinates for 120fps+ zero-lag cursor following
  unclampedX: window.innerWidth / 2 + 10,
  unclampedY: window.innerHeight / 2 + 16,
  anchorX: window.innerWidth / 2 + 10,
  anchorY: window.innerHeight / 2 + 16,
  targetAnchorX: window.innerWidth / 2 + 10,
  targetAnchorY: window.innerHeight / 2 + 16,
  cachedAnchorW: 241,
  cachedAnchorH: 52,
  cachedPbW: 241,
  cachedPbH: 52,
  cachedPbOffsetX: 0,
  cachedPbOffsetY: 0,
  cachedChipOffsets: [], // [{ ox, oy, w, h }]
  scrimDirty: true,
  isDraggingAOI: false,
  isPointerDownOnScrim: false,
  dragStartX: 0,
  dragStartY: 0,
  dragCurrentX: 0,
  dragCurrentY: 0,
  ctrlPressed: false,
  selectedAOIs: [],
  detectedWindows: [], // Non-fullscreen windows (<95% width & height) from GeneralPostProcessor.kt
  raidScreenElementAOIs: [], // AOIs from mobile_raid_v2_2_float32_finetuned_0804.tflite
  ocrTextAOIs: [], // AOIs from OCR text detection + clustering
  segmentedScreenElements: new Map(), // Map<rectKey, Array<AOI>> from mobile_raid_common_object_33_int8_0730_w_metadata.tflite
  segmentingScreenElementTimers: new Map(), // Map<rectKey, timerId> (500ms segmentationDelayMs)
  screenshotCanvas: null,
  screenshotScaleFactor: 1,
  isTextSelecting: false,
  textSelectionAoi: null,
  textSelStartX: 0,
  textSelStartY: 0,
  textSelEndX: 0,
  textSelEndY: 0,
  // Page-wide OCR text selection + floating Copy & Add circle actions
  pageOcrBlock: null,
  pageOcrSymbols: [],
  pendingTextSelection: null, // { text, rect, lineRects }
  textActionCircles: [], // [{ el, contentEl, index, cx, cy, r, scale, scaleVel, alpha, alphaFromTime, startTime, timeOffsetSec, exiting, exitStart, exitFromAlpha, exitFromScale }]
  textActionShaderCircles: [],
  hoveredAoi: null,
  renderedHoverAoi: null,
  hoverCardAlpha: 0,
  hoverEffectStartTime: 0,
  hoverAmbientDelayMs: 400, // FIRST_AOI_HOVER_AMBIENT_TRANSITION_DELAY = 400ms
  hasFirstAoiAmbientTransitionPlayed: false,
  hoverDelayTimer: null,
  scrimCutOutAlpha: 0,
  scrimCutOutStartTime: 0,
  scrimCutOutDelayMs: 0,
  promptText: '',
  aoiSelectionMode: true,
  multiAoiSelectionMode: false,
  isCollapsed: false,
  hasUserEnteredContentBefore: false,
  fanTransitioning: false,
  jumpFading: false,
  lastFollowX: null,
  lastFollowY: null,
  chipsCreatedAt: 0,
  seenAoiIds: new Set(),
  chipMotions: [],
  chipGeneration: 0,
  isExiting: false,
  exitFlightTx: 0,
  exitFlightTy: 0,
  exitFlightScale: 1,
  exitFlightAlpha: 1,
  hasPlayedFirstEntry: false,
  // MainScreenStateFragmentPeer.java:109 & 684: TRIGGER_DISMISSAL_COOLDOWN_MS = 1000
  launchTimestampMs: 0,
  // PromptBoxKt.java:4985: shouldShowSnackbar gate for 1000-char limit
  shouldShowCharLimitSnackbar: true,
  // MainActivityPeer$onAccountChangedInternal$6$1$1.java: 3000ms offline debounce
  hasShownOfflineError: false,
  offlineTimer: null,
  // MainScreenStateFragmentPeer.java:458-505 & ScreenContextRepositoryImpl.java:834-1035:
  hasUserInteractedInSession: false,
  hasShownIdleExitHintInSession: false,
  idleHintTimer: null,
  snackbarHideTimer: null,
  currentSnackbarKind: null,
  snackbarVisible: false,
  snackbarScale: 0.8,
  snackbarScaleVel: 0,
  snackbarAlpha: 0,
  snackbarAlphaVel: 0,
  hasShownMultiSelectSnackbar: false,
  hasPressedCtrlMultiSelect: false,
  // PromptBoxKt.createRowChangeBoundsTransform: previous bounding rects by tile ID
  prevTileBounds: new Map(),
  // ScreenContextRepositoryImpl.java:105 & 2291: TTL_SECONDS = 120 (120,000ms)
  draftSavedAtMs: 0,
  // ShakeInterventionRepository.java & UiFlagsImpl$FeatureModule.smali:
  // MISTRIGGER_WINDOW_MILLIS = 2000ms (0x7d0), INTERVENTION_WINDOW_MILLIS = 60000ms (0xea60),
  // TRIGGER_COUNT_THRESHOLD = 3, COOLDOWN_WINDOW_MILLIS = 21600000ms (6 hours)
  entrySource: 'launch',
  lastShakeTriggerMs: 0,
  mistriggerTimestampsMs: [],
  lastShakeInterventionShownMs: 0,
  fteStep: 'wiggle-adjust',
  lottieInstance: null,
  lottiePaused: false,
  // MagicCue Smart Actions (MagicCueImpl.java & PromptBoxStateFragmentPeer.java:96-97):
  // Bundled with the app (1.2 MB entity classifier pack) and enabled by default!
  magicCueEnabled: true,
  magicCuePackDownloaded: true,
  // Optional On-Device Suggestion LLM (LlmProcessorServiceImpl.java / LaMini-Flan-T5-77M int8 ONNX, ~92 MB):
  // Off by default until downloaded; uses default suggestions when not downloaded!
  llmSuggestionsEnabled: false,
  llmModelDownloaded: false,
  llmDownloading: false,
  llmModelDirUrl: null,
  llmChipsCache: new Map()
};

// DOM Elements
const magicRoot = document.getElementById('magic-root');
const screenshotFreezeImg = document.getElementById('screenshot-freeze-img');
const scrimCanvas = document.getElementById('scrim-canvas');
const energyCanvas = document.getElementById('energy-shader-canvas');
const aoiCardsLayer = document.getElementById('aoi-cards-layer');
const textSelectionActionsEl = document.getElementById('text-selection-actions');
const btnTextSelCopy = document.getElementById('btn-text-sel-copy');
const btnTextSelAdd = document.getElementById('btn-text-sel-add');
const iconTextSelCopy = document.getElementById('icon-text-sel-copy');
const floatingAnchor = document.getElementById('floating-prompt-anchor');
const exitActionsPill = document.getElementById('exit-actions-pill');
const btnCollapseSave = document.getElementById('btn-collapse-save');
const btnClearClose = document.getElementById('btn-clear-close');
const promptBox = document.getElementById('prompt-box');
const expandedStateWrapper = document.getElementById('expanded-state-wrapper');
const contentArea = document.getElementById('content-area');
const contextControls = document.getElementById('context-controls');
const addBtnContainer = document.getElementById('add-btn-container');
const selectedAoisDisplay = document.getElementById('selected-aois-display');
const aoiThumbnailsList = document.getElementById('aoi-thumbnails-list');
const btnAddAoiTile = document.getElementById('btn-add-aoi-tile');
const btnAddContent = document.getElementById('btn-add-content');
const promptInput = document.getElementById('prompt-input');
const promptScrollbarThumb = document.getElementById('prompt-scrollbar-thumb');
const m3PlainTooltip = document.getElementById('m3-plain-tooltip');
const snackbarIcon = document.getElementById('snackbar-icon');
const btnSendPrompt = document.getElementById('btn-send-prompt');
const aoiThumbnailFan = document.getElementById('aoi-thumbnail-fan');
const suggestionChipsContainer = document.getElementById('suggestion-chips-container');
const fteModalBackdrop = document.getElementById('fte-modal-backdrop');
const btnDoneFte = document.getElementById('btn-done-fte');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const btnSliderMinus = document.getElementById('btn-slider-minus');
const btnSliderPlus = document.getElementById('btn-slider-plus');
const wiggleDetectedBanner = document.getElementById('wiggle-detected-banner');
const bottomSnackbar = document.getElementById('bottom-snackbar');
const snackbarMessageText = document.getElementById('snackbar-message-text');
const snackbarActionBtn = document.getElementById('snackbar-action-btn');
const btnFeedback = document.getElementById('btn-feedback');
const shakeBackdrop = document.getElementById('shake-intervention-backdrop');
const btnShakeNoThanks = document.getElementById('btn-shake-no-thanks');
const btnShakeSettings = document.getElementById('btn-shake-settings');
const feedbackBackdrop = document.getElementById('feedback-dialog-backdrop');
const feedbackDialog = document.getElementById('feedback-dialog');
const btnCloseFeedback = document.getElementById('btn-close-feedback');
const feedbackStepRate = document.getElementById('feedback-step-rate');
const feedbackStepDetails = document.getElementById('feedback-step-details');
const btnThumbUp = document.getElementById('btn-thumb-up');
const btnThumbDown = document.getElementById('btn-thumb-down');
const btnSubmitFeedback = document.getElementById('btn-submit-feedback');
const customCursor = document.getElementById('custom-cursor');

const api = window.magicPointerAPI || {
  onActivate() {},
  onDeactivate() {},
  onCursorMove() {},
  onSensitivityChange() {},
  onThemeChange() {},
  dismiss() {},
  setSensitivity() {},
  setTheme() {},
  cropAOI: async () => null,
  getWindows: async () => [],
  pickFiles: async () => [],
  sendToGemini: async () => {},
  triggerChromeShortcut: async () => {}
};
const customCursorImg = document.getElementById('custom-cursor-img');

// ============================================================================
// 1. WebGL2 Port of Google's Decompiled EnergyShader (Scissor-Accelerated)
// ============================================================================
let gl = null;
let shaderProgram = null;
let shaderUniforms = {};
let shaderStartTime = performance.now();
let lastFrameTime = performance.now();

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Direct WebGL2 port of com.google.android.desktop.gpointer.libraries.shaderlib.energyeffects.shader.EnergyShader
const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

uniform float inTime;
uniform vec2 inResolution;
uniform vec2 inCenter;
uniform vec2 inSize;
uniform vec4 inCornerRadii;
uniform float inSpread;

// Panel (SuggestionChipConfig panel, alpha=0 for AoiCardConfig)
uniform float inPanelAlpha;
uniform float inPanelTopBlurRadius;
uniform float inPanelBottomBlurRadius;
uniform vec4 inPanelColor;

// RadialGradient + SpotLight (DefaultCardConfig / DefaultChipConfig / SuggestionChipConfig)
uniform int inRadialGradientDirection;
uniform float inRadialGradientRatio;
uniform float inRadialGradientRadius;
uniform vec4 inRadialGradientInnerColor;
uniform vec4 inRadialGradientOuterColor;
uniform float inSpotLightAlpha;
uniform float inSpotLightTopBlurRadius;
uniform float inSpotLightBottomBlurRadius;

// RimLight & RippleLight (EnergyShader.java:54-62)
uniform float inRimLightAlpha;
uniform float inRimLightStartBlurRadius;
uniform float inRimLightEndBlurRadius;
uniform float inRimLightDistortionAmplitude;
uniform float inRimLightDistortionFrequency;
uniform float inRimLightDistortionSpeed;
uniform float inRimLightWidth;
uniform float inRippleLightAlpha;
uniform float inRippleLightExpansionSpeed;
uniform float inRippleLightFrequency;
uniform float inRippleOscillationDistance;
uniform float inRippleOscillationSpeed;
uniform float inRippleBlurRadius;
uniform vec4 inRippleColor;

// BorderLight 1 & 2 (EnergyShader.BORDER_LIGHT_FUNCTION + rotatingDistortionMask)
uniform float inBorderLightAlpha1;
uniform vec4 inColor1;
uniform float inBorderStroke1;
uniform float inTopBlur1;
uniform float inBottomBlur1;
uniform float inTopIntensity1;
uniform float inBottomIntensity1;
uniform float inBorderDistortionSpeed1;
uniform float inBorderDistortionFreq1;
uniform float inBorderDistortionAmp1;

uniform float inBorderLightAlpha2;
uniform vec4 inColor2;
uniform float inBorderStroke2;
uniform float inTopBlur2;
uniform float inBottomBlur2;
uniform float inTopIntensity2;
uniform float inBottomIntensity2;
uniform float inBorderDistortionSpeed2;
uniform float inBorderDistortionFreq2;
uniform float inBorderDistortionAmp2;

// Dots (EnergyShader.DOTS_VALUE_NOISE + InternalEnergyShaderDotsConfig)
uniform vec4 inDotsColor;
uniform float inDotsAlpha;
uniform float inDotsGridSize;
uniform float inDotsMaxRadius;
uniform float inDotsMinRadius;
uniform float inDotsBlurRadius;
uniform float inDotsMoveStrength;
uniform float inDotsMaskInnerStrokeWidth;
uniform float inDotsMaskOuterStrokeWidth;
uniform float inDotsWaveAmplitude;
uniform float inDotsWaveFrequency;
uniform float inDotsWaveSpeed;
uniform float inDotsYGradientWeight;
uniform vec2 inDotsMotionNoiseScale;
uniform vec3 inDotsMotionNoiseSpeed;
uniform float inDotsNoiseRotationSpeed;
uniform float inDotsNoiseSpatialScale;
uniform float inDotsNoiseManhattanLimit;

out vec4 fragColor;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

vec4 normalBlendPreMulti(vec4 back, vec4 front) {
  return front + back * (1.0 - front.a);
}

float remap(float value, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

vec3 remapToVec3(float value, float inMin, float inMax, vec3 outMin, vec3 outMax) {
  return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

float calculateBlur(float yFract, float topBlur, float bottomBlur) {
  return mix(topBlur, bottomBlur, yFract);
}

float smoothpeak(float v0, float peak, float v1, float v) {
  const float EPS = 0.0001;
  float safe_v0 = min(v0, peak - EPS);
  float safe_v1 = max(v1, peak + EPS);
  float rising = smoothstep(safe_v0, peak, v);
  float falling = 1.0 - smoothstep(peak, safe_v1, v);
  return mix(rising, falling, step(peak, v));
}

float sdCircle(in vec2 p, in float r) {
  return length(p) - r;
}

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

float sdBox(in vec2 p, in vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundedBox(in vec2 p, in vec2 b, in vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x = (p.y > 0.0) ? r.x : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float dots(vec2 p, float r, float blur) {
  float d = sdBox(p, vec2(r));
  float safeBlur = max(blur, 0.0001);
  return 1.0 - smoothstep(-safeBlur, safeBlur, d);
}

float sinWaves(float x) {
  return sin(x * 2.0) + sin((x + 0.2) * 12.0) * 0.12 + sin((x + 13.0) * 2.555) * 0.28;
}

float rotatingDistortionMask(vec2 p, vec2 center, float amp, float freq, float speed) {
  if (amp <= 0.0001) return 0.0;
  float rotationAngle = -inTime * speed;
  mat2 rotationMatrix = rotate2d(rotationAngle);
  vec2 rotatedUv = rotationMatrix * p + center;
  float sinX = sinWaves(rotatedUv.x * freq);
  float sinY = sinWaves(rotatedUv.y * freq);
  float combined = length(vec2(sinX, sinY));
  float remapped = combined / 1.41421356237;
  return amp * remapped;
}

const vec3 trig_hash_multiplier = vec3(12.9898, 78.233, 43758.5453);
float trig_value_hash(vec2 uv) {
  return fract(sin(dot(uv, trig_hash_multiplier.xy)) * trig_hash_multiplier.z);
}

vec3 value_gradient_noise(in vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = trig_value_hash(i + vec2(0.0, 0.0));
  float b = trig_value_hash(i + vec2(1.0, 0.0));
  float c = trig_value_hash(i + vec2(0.0, 1.0));
  float d = trig_value_hash(i + vec2(1.0, 1.0));
  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  float value = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  vec2 gradient = du * vec2(k1 + k3 * u.y, k2 + k3 * u.x);
  return vec3(value, gradient);
}

vec4 calculatePanel(vec4 inColor, float blurredSdfMask) {
  if (inPanelAlpha <= 0.001) return inColor;
  vec4 coloredPanel = vec4(inPanelColor.rgb * blurredSdfMask, blurredSdfMask);
  return normalBlendPreMulti(inColor * inPanelAlpha, coloredPanel * inPanelAlpha);
}

vec4 calculateGradientColor(vec2 size, vec2 center, vec2 fragCoord) {
  float radialGradientDirection = float(inRadialGradientDirection);
  vec2 radialGradientCenter = center + vec2(0.0, radialGradientDirection * size.y * 0.5);
  float radialGradientMask;
  if (inRadialGradientDirection != 0) {
    float radialGradientCircle = sdCircle((fragCoord - radialGradientCenter) * vec2(inRadialGradientRatio, 1.0), inRadialGradientRadius);
    radialGradientMask = clamp(smoothstep(1.0, -inRadialGradientRadius, radialGradientCircle), 0.0, 1.0);
  } else {
    vec2 radialGradientRotated = rotate2d(0.3333 * PI * inTime) * (fragCoord - radialGradientCenter);
    radialGradientMask = 1.0 - smoothstep(0.0, inRadialGradientRadius, radialGradientRotated.x + size.x * 0.5);
  }
  return vec4(remapToVec3(radialGradientMask, 1.0, 0.0, inRadialGradientInnerColor.rgb, inRadialGradientOuterColor.rgb), 1.0) * radialGradientMask;
}

float calculaterRippleBlurRadius(vec2 center, vec2 fragCoord, out float ripple) {
  if (inRippleLightAlpha <= 0.001 && inRippleBlurRadius <= 0.001) {
    ripple = 1.0;
    return 0.0;
  }
  vec2 rippleCenter = center + vec2(sin(inTime * inRippleOscillationSpeed), 0.0) * inRippleOscillationDistance;
  float rippleDistance = length(fragCoord - rippleCenter);
  ripple = sin(rippleDistance * inRippleLightFrequency - inTime * inRippleLightExpansionSpeed);
  ripple = remap(ripple, -1.0, 1.0, 0.0, 1.0);
  return ripple * inRippleBlurRadius;
}

vec4 calculateRippleLight(vec4 inColor, float ripple, float blurredSdfMask) {
  if (inRippleLightAlpha <= 0.001) return inColor;
  vec4 rippleLight = vec4(inRippleColor.rgb, 1.0) * ripple * blurredSdfMask;
  return normalBlendPreMulti(inColor, rippleLight * inRippleLightAlpha);
}

vec4 calculateRimLight(
  vec4 inColor, float mainSdf, vec2 fragCoord, vec2 center, vec2 size,
  vec4 cornerRadius, vec2 p, vec4 radialGradientColor, float blurredSdfMask
) {
  if (inRimLightAlpha <= 0.001) return inColor;
  float radialGradientDirection = float(inRadialGradientDirection);
  float distortionMask = rotatingDistortionMask(p, center, inRimLightDistortionAmplitude, inRimLightDistortionFrequency, inRimLightDistortionSpeed);
  vec2 rimInnerPanelSize = size + vec2(-inRimLightWidth, inRimLightWidth);
  vec2 rimInnerPanelCenter = center + vec2(0.0, -radialGradientDirection * inRimLightWidth * 0.75);
  vec2 rimInnerPanelP = fragCoord - rimInnerPanelCenter;
  float rimInnerPanel = sdRoundedBox(rimInnerPanelP, rimInnerPanelSize * 0.5, cornerRadius);
  vec2 rimOuterPanelCenter = center + vec2(0.0, radialGradientDirection * inRimLightWidth * 0.25);
  vec2 rimOuterPanelP = fragCoord - rimOuterPanelCenter;
  float rimOuterPanel = sdRoundedBox(rimOuterPanelP, size * 0.5, cornerRadius);
  float rimYFract = clamp(remap(p.y, -size.y * 0.5 * radialGradientDirection, size.y * 0.5 * radialGradientDirection, 0.0, 1.0), 0.0, 1.0);
  float rimPanelBlur = calculateBlur(rimYFract, inRimLightStartBlurRadius, inRimLightEndBlurRadius);
  float blurredRimInnerPanel = smoothstep(1.0 + rimPanelBlur, -1.0 - rimPanelBlur, rimInnerPanel + distortionMask);
  float blurredRimOuterPanel = smoothstep(1.0 + rimPanelBlur, -1.0 - rimPanelBlur, rimOuterPanel);
  float rimLightMask = max(0.0, blurredRimOuterPanel - blurredRimInnerPanel);
  vec4 rimLight = radialGradientColor * rimLightMask * blurredSdfMask;
  return normalBlendPreMulti(inColor, rimLight * inRimLightAlpha);
}

vec4 calculateSpotLight(vec4 inColor, float mainSdf, float yFract, vec4 radialGradientColor, float blurredSdfMask) {
  if (inSpotLightAlpha <= 0.001) return inColor;
  float spotBlur = calculateBlur(yFract, inSpotLightTopBlurRadius, inSpotLightBottomBlurRadius);
  float spotLightMask = smoothstep(1.0 + spotBlur, -1.0 - spotBlur, mainSdf);
  vec4 spotLight = radialGradientColor * spotLightMask * blurredSdfMask;
  return normalBlendPreMulti(inColor, spotLight * inSpotLightAlpha);
}

vec4 calculateBorderLight(
  vec4 inColor, float mainSdf, vec2 center, float yFract, vec2 p, float blurredSdfMask,
  float alpha, float topBlur, float bottomBlur, float topIntensity, float bottomIntensity,
  float strokeWidth, float speed, float freq, float amp, vec4 color
) {
  if (alpha <= 0.001 || (topIntensity <= 0.001 && bottomIntensity <= 0.001)) return inColor;
  float distortionOffset = rotatingDistortionMask(p, center, amp, freq, speed);
  float borderBlur = calculateBlur(yFract, topBlur, bottomBlur);
  float borderIntensity = calculateBlur(yFract, topIntensity, bottomIntensity);
  float internalDistance = borderBlur + strokeWidth * 0.5 + distortionOffset;
  float externalDistance = borderBlur + strokeWidth * 0.5;
  float borderSdf = smoothpeak(-internalDistance, 0.0, externalDistance, mainSdf);
  float borderMask = borderSdf * borderIntensity;
  vec4 borderLight = vec4(color.rgb, 1.0) * borderMask * blurredSdfMask;
  return normalBlendPreMulti(inColor, borderLight * alpha);
}

// Exact port of EnergyShader.DOTS_VALUE_NOISE + DEFAULT_INTERNAL_ENERGY_SHADER_DOTS_CONFIG (EnergyShader.java:328 & EnergyShaderNode.smali:5086)
vec4 calculateDots(vec4 inColor, float mainSdf, vec2 fragCoord, vec2 center, vec2 size, float yFract, float blurredSdfMask) {
  if (inDotsAlpha <= 0.001 || inDotsMaxRadius <= 0.001) return inColor;
  float sinX = inDotsWaveAmplitude * sinWaves((fragCoord.x + inTime * inDotsWaveSpeed) * inDotsWaveFrequency);
  float dotAreaMask = clamp(1.0 - max(0.0, inDotsYGradientWeight) + inDotsYGradientWeight * yFract, 0.0, 1.0) *
    smoothpeak(-inDotsMaskInnerStrokeWidth - sinX, 0.0, inDotsMaskOuterStrokeWidth, mainSdf) *
    blurredSdfMask;

  if (dotAreaMask > 0.001) {
    vec2 offsets[5];
    offsets[0] = vec2(0.0, 0.0);
    offsets[1] = vec2(1.0, 0.0);
    offsets[2] = vec2(-1.0, 0.0);
    offsets[3] = vec2(0.0, 1.0);
    offsets[4] = vec2(0.0, -1.0);

    // EnergyShaderNode.smali:5086 sets inResolution = resolvedSize (shape size), and fragCoord - 0.5 * inResolution = fragCoord - center!
    vec2 uv = fragCoord - center;
    uv = 0.70710678118 * vec2(uv.x - uv.y, uv.x + uv.y);
    vec2 p = uv / inDotsGridSize;
    vec2 i = floor(p);
    vec2 f = fract(p);

    float mask = 0.0;
    vec2 drift = inTime * inDotsMotionNoiseSpeed.xy;
    mat2 rotNoise = rotate2d(PI * sin(inTime * inDotsNoiseRotationSpeed));

    for (int k = 0; k < 5; k++) {
      vec2 neighborDir = offsets[k];
      vec2 neighborID = i + neighborDir;
      vec2 cellCenterUV = (neighborID + 0.5) * inDotsGridSize;
      vec2 basePos = cellCenterUV * inDotsNoiseSpatialScale;
      vec2 transformedID = rotNoise * basePos + drift;

      vec3 n = value_gradient_noise(transformedID);
      float noiseVal = n.x;
      vec2 noiseGrad = n.yz;

      float theta = TWO_PI * (noiseVal + inTime * 0.2) * inDotsMotionNoiseSpeed.z;
      vec2 displacement = rotate2d(theta) * (noiseGrad * inDotsMotionNoiseScale);
      float manhattanDist = abs(displacement.x) + abs(displacement.y);
      displacement = displacement / (1.0 + manhattanDist / max(inDotsNoiseManhattanLimit, 0.0001));

      vec2 circleCenter = neighborDir + displacement * inDotsMoveStrength;
      vec2 relPos = f - (0.5 + circleCenter);
      float blur = inDotsBlurRadius * noiseVal;
      float radius = mix(inDotsMinRadius, inDotsMaxRadius, noiseVal);
      float circle = dots(relPos, radius, blur);
      if (circle > 0.0) {
        mask = max(mask, circle);
      }
    }

    vec4 coloredDots = mask * dotAreaMask * vec4(inDotsColor.rgb, 1.0);
    if (inRippleLightAlpha > 0.001) {
      float rippleMix = remap(
        sin(length(fragCoord - (center + vec2(sin(inTime * inRippleOscillationSpeed), 0.0) * inRippleOscillationDistance)) *
            inRippleLightFrequency - inTime * inRippleLightExpansionSpeed),
        -1.0, 1.0, 0.0, 1.0
      );
      coloredDots *= mix(1.0, rippleMix, inRippleLightAlpha);
    }
    return normalBlendPreMulti(inColor, coloredDots * inDotsAlpha);
  }
  return inColor;
}

void main() {
  vec2 fragCoord = vec2(gl_FragCoord.x, inResolution.y - gl_FragCoord.y);
  vec2 p = fragCoord - inCenter;
  float mainSdf = sdRoundedBox(p, inSize * 0.5, inCornerRadii);
  if (mainSdf > 1.0 + inSpread) {
    discard;
  }
  float yFract = clamp(remap(p.y, -inSize.y * 0.5, inSize.y * 0.5, 0.0, 1.0), 0.0, 1.0);
  float panelBlurRadius = calculateBlur(yFract, inPanelTopBlurRadius, inPanelBottomBlurRadius);
  float ripple = 1.0;
  float rippleBlurRadius = calculaterRippleBlurRadius(inCenter, fragCoord, ripple);
  float blurRadius = panelBlurRadius + rippleBlurRadius;
  float blurredSdfMask = smoothstep(blurRadius + 1.0, -blurRadius - 1.0, mainSdf);

  vec4 finalColor = vec4(0.0);
  finalColor = calculatePanel(finalColor, blurredSdfMask);
  finalColor = calculateRippleLight(finalColor, ripple, blurredSdfMask);

  if (inSpotLightAlpha > 0.001 || inRimLightAlpha > 0.001) {
    vec4 gradientColor = calculateGradientColor(inSize, inCenter, fragCoord);
    finalColor = calculateRimLight(finalColor, mainSdf, fragCoord, inCenter, inSize, inCornerRadii, p, gradientColor, blurredSdfMask);
    finalColor = calculateSpotLight(finalColor, mainSdf, yFract, gradientColor, blurredSdfMask);
  }

  finalColor = calculateBorderLight(
    finalColor, mainSdf, inCenter, yFract, p, blurredSdfMask * ripple,
    inBorderLightAlpha1, inTopBlur1, inBottomBlur1, inTopIntensity1, inBottomIntensity1,
    inBorderStroke1, inBorderDistortionSpeed1, inBorderDistortionFreq1, inBorderDistortionAmp1, inColor1
  );

  finalColor = calculateBorderLight(
    finalColor, mainSdf, inCenter, yFract, p, blurredSdfMask * ripple,
    inBorderLightAlpha2, inTopBlur2, inBottomBlur2, inTopIntensity2, inBottomIntensity2,
    inBorderStroke2, inBorderDistortionSpeed2, inBorderDistortionFreq2, inBorderDistortionAmp2, inColor2
  );

  finalColor = calculateDots(finalColor, mainSdf, fragCoord, inCenter, inSize, yFract, blurredSdfMask);

  finalColor *= smoothstep(1.0 + inSpread, 0.0, mainSdf);
  fragColor = finalColor;
}`;

function initWebGLShader() {
  gl = energyCanvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  });
  if (!gl) return;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
  if (!vs || !fs) return;

  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vs);
  gl.attachShader(shaderProgram, fs);
  gl.linkProgram(shaderProgram);

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(shaderProgram, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const names = [
    'inTime', 'inResolution', 'inCenter', 'inSize', 'inCornerRadii', 'inSpread',
    'inPanelAlpha', 'inPanelTopBlurRadius', 'inPanelBottomBlurRadius', 'inPanelColor',
    'inRadialGradientDirection', 'inRadialGradientRatio', 'inRadialGradientRadius',
    'inRadialGradientInnerColor', 'inRadialGradientOuterColor',
    'inSpotLightAlpha', 'inSpotLightTopBlurRadius', 'inSpotLightBottomBlurRadius',
    'inRimLightAlpha', 'inRimLightStartBlurRadius', 'inRimLightEndBlurRadius',
    'inRimLightDistortionAmplitude', 'inRimLightDistortionFrequency', 'inRimLightDistortionSpeed', 'inRimLightWidth',
    'inRippleLightAlpha', 'inRippleLightExpansionSpeed', 'inRippleLightFrequency',
    'inRippleOscillationDistance', 'inRippleOscillationSpeed', 'inRippleBlurRadius', 'inRippleColor',
    'inBorderLightAlpha1', 'inColor1', 'inBorderStroke1', 'inTopBlur1', 'inBottomBlur1',
    'inTopIntensity1', 'inBottomIntensity1', 'inBorderDistortionSpeed1', 'inBorderDistortionFreq1', 'inBorderDistortionAmp1',
    'inBorderLightAlpha2', 'inColor2', 'inBorderStroke2', 'inTopBlur2', 'inBottomBlur2',
    'inTopIntensity2', 'inBottomIntensity2', 'inBorderDistortionSpeed2', 'inBorderDistortionFreq2', 'inBorderDistortionAmp2',
    'inDotsColor', 'inDotsAlpha', 'inDotsGridSize', 'inDotsMaxRadius', 'inDotsMinRadius',
    'inDotsBlurRadius', 'inDotsMoveStrength', 'inDotsMaskInnerStrokeWidth', 'inDotsMaskOuterStrokeWidth',
    'inDotsWaveAmplitude', 'inDotsWaveFrequency', 'inDotsWaveSpeed', 'inDotsYGradientWeight',
    'inDotsMotionNoiseScale', 'inDotsMotionNoiseSpeed', 'inDotsNoiseRotationSpeed',
    'inDotsNoiseSpatialScale', 'inDotsNoiseManhattanLimit'
  ];
  for (const n of names) {
    shaderUniforms[n] = gl.getUniformLocation(shaderProgram, n);
  }
}

function drawEnergyShape(opts) {
  if (!gl || !shaderProgram) return;
  const dpr = window.devicePixelRatio || 1;
  const spread = opts.spread ?? (64.0 * dpr);
  const clipMargin = Math.max(spread, opts.panelTopBlur || 0, opts.panelBottomBlur || 0, 64.0 * dpr);
  // Hardware scissor test so the GPU ONLY shades pixels inside the shape + glow margin!
  const sx = Math.max(0, Math.floor(opts.cx - opts.w * 0.5 - clipMargin - 4));
  const syTop = opts.cy + opts.h * 0.5 + clipMargin + 4;
  const sy = Math.max(0, Math.floor(energyCanvas.height - syTop));
  const sw = Math.min(energyCanvas.width - sx, Math.ceil(opts.w + clipMargin * 2 + 8));
  const sh = Math.min(energyCanvas.height - sy, Math.ceil(opts.h + clipMargin * 2 + 8));
  if (sw <= 0 || sh <= 0) return;

  gl.scissor(sx, sy, sw, sh);
  if (opts.timeOffsetSec !== undefined) {
    gl.uniform1f(shaderUniforms.inTime, opts.baseTimeSec + opts.timeOffsetSec);
  }
  gl.uniform2f(shaderUniforms.inCenter, opts.cx, opts.cy);
  gl.uniform2f(shaderUniforms.inSize, opts.w, opts.h);
  gl.uniform4f(shaderUniforms.inCornerRadii, opts.r, opts.r, opts.r, opts.r);
  gl.uniform1f(shaderUniforms.inSpread, spread);

  gl.uniform1f(shaderUniforms.inPanelAlpha, opts.panelAlpha ?? 0.0);
  gl.uniform1f(shaderUniforms.inPanelTopBlurRadius, opts.panelTopBlur ?? (64.0 * dpr));
  gl.uniform1f(shaderUniforms.inPanelBottomBlurRadius, opts.panelBottomBlur ?? (64.0 * dpr));
  gl.uniform4fv(shaderUniforms.inPanelColor, opts.panelColor || [0.20, 0.208, 0.227, 1.0]);

  gl.uniform1i(shaderUniforms.inRadialGradientDirection, opts.gradDirection ?? -1);
  gl.uniform1f(shaderUniforms.inRadialGradientRatio, opts.gradRatio ?? 0.64);
  gl.uniform1f(shaderUniforms.inRadialGradientRadius, opts.gradRadius ?? (84.0 * dpr));
  gl.uniform4fv(shaderUniforms.inRadialGradientInnerColor, opts.gradInnerColor || [0.16, 0.18, 0.24, 1.0]);
  gl.uniform4fv(shaderUniforms.inRadialGradientOuterColor, opts.gradOuterColor || [0.12, 0.13, 0.16, 1.0]);

  gl.uniform1f(shaderUniforms.inSpotLightAlpha, opts.spotLightAlpha ?? 0.0);
  gl.uniform1f(shaderUniforms.inSpotLightTopBlurRadius, opts.spotLightTopBlur ?? (56.0 * dpr));
  gl.uniform1f(shaderUniforms.inSpotLightBottomBlurRadius, opts.spotLightBottomBlur ?? (32.0 * dpr));

  gl.uniform1f(shaderUniforms.inRimLightAlpha, opts.rimAlpha ?? 0.0);
  gl.uniform1f(shaderUniforms.inRimLightStartBlurRadius, opts.rimStartBlur ?? (10.0 * dpr));
  gl.uniform1f(shaderUniforms.inRimLightEndBlurRadius, opts.rimEndBlur ?? (10.0 * dpr));
  gl.uniform1f(shaderUniforms.inRimLightDistortionAmplitude, opts.rimDistAmp ?? 0.0);
  gl.uniform1f(shaderUniforms.inRimLightDistortionFrequency, opts.rimDistFreq ?? 0.0033);
  gl.uniform1f(shaderUniforms.inRimLightDistortionSpeed, opts.rimDistSpeed ?? 0.45);
  gl.uniform1f(shaderUniforms.inRimLightWidth, opts.rimWidth ?? (4.0 * dpr));

  gl.uniform1f(shaderUniforms.inRippleLightAlpha, opts.rippleAlpha ?? 0.0);
  gl.uniform1f(shaderUniforms.inRippleLightExpansionSpeed, opts.rippleExpSpeed ?? 2.0);
  gl.uniform1f(shaderUniforms.inRippleLightFrequency, opts.rippleFreq ?? 0.03);
  gl.uniform1f(shaderUniforms.inRippleOscillationDistance, opts.rippleOscDist ?? (20.0 * dpr));
  gl.uniform1f(shaderUniforms.inRippleOscillationSpeed, opts.rippleOscSpeed ?? 1.0);
  gl.uniform1f(shaderUniforms.inRippleBlurRadius, opts.rippleBlur ?? 0.0);
  gl.uniform4fv(shaderUniforms.inRippleColor, opts.rippleColor || [0.31, 0.63, 1.0, 1.0]);

  gl.uniform1f(shaderUniforms.inBorderLightAlpha1, opts.borderAlpha1 ?? 1.0);
  gl.uniform4fv(shaderUniforms.inColor1, opts.color1 || [0.31, 0.63, 1.0, 1.0]);
  gl.uniform1f(shaderUniforms.inBorderStroke1, opts.stroke1 ?? (2.0 * dpr));
  gl.uniform1f(shaderUniforms.inTopBlur1, opts.topBlur1 ?? (7.0 * dpr));
  gl.uniform1f(shaderUniforms.inBottomBlur1, opts.bottomBlur1 ?? (7.0 * dpr));
  gl.uniform1f(shaderUniforms.inTopIntensity1, opts.topIntensity1 ?? (opts.intensity1 ?? 0.2));
  gl.uniform1f(shaderUniforms.inBottomIntensity1, opts.bottomIntensity1 ?? (opts.intensity1 ?? 0.2));
  gl.uniform1f(shaderUniforms.inBorderDistortionSpeed1, opts.borderDistSpeed1 ?? 0.0);
  gl.uniform1f(shaderUniforms.inBorderDistortionFreq1, opts.borderDistFreq1 ?? 0.0);
  gl.uniform1f(shaderUniforms.inBorderDistortionAmp1, opts.borderDistAmp1 ?? 0.0);

  gl.uniform1f(shaderUniforms.inBorderLightAlpha2, opts.borderAlpha2 ?? 1.0);
  gl.uniform4fv(shaderUniforms.inColor2, opts.color2 || [0.31, 0.63, 1.0, 1.0]);
  gl.uniform1f(shaderUniforms.inBorderStroke2, opts.stroke2 ?? (3.0 * dpr));
  gl.uniform1f(shaderUniforms.inTopBlur2, opts.topBlur2 ?? (20.0 * dpr));
  gl.uniform1f(shaderUniforms.inBottomBlur2, opts.bottomBlur2 ?? (20.0 * dpr));
  gl.uniform1f(shaderUniforms.inTopIntensity2, opts.topIntensity2 ?? (opts.intensity2 ?? 0.2));
  gl.uniform1f(shaderUniforms.inBottomIntensity2, opts.bottomIntensity2 ?? (opts.intensity2 ?? 0.2));
  gl.uniform1f(shaderUniforms.inBorderDistortionSpeed2, opts.borderDistSpeed2 ?? 0.0);
  gl.uniform1f(shaderUniforms.inBorderDistortionFreq2, opts.borderDistFreq2 ?? 0.0);
  gl.uniform1f(shaderUniforms.inBorderDistortionAmp2, opts.borderDistAmp2 ?? 0.0);

  // Exact DESKTOP_INTERNAL_ENERGY_SHADER_DOTS_CONFIG (MainActivityPeer.java:405 -> DotsConfig.setTargetDeviceType(DeviceType.DESKTOP),
  // InternalEnergyShaderDotsConfig.java:35) + EnergyEffectsBuilder.createAnimationMask (EnergyEffectsBuilder.java:101-145):
  // - In EnergyShader constructor (EnergyShader.java:361-372), updateInternalDotsUniforms sets the unscaled float values directly:
  //   blurRadius = 0.3, moveStrength = 5.0, motionNoiseScale = (0.0, 0.0), motionNoiseSpeed = (0.6, 0.9, -1.79),
  //   noiseRotationSpeed = 0.01, noiseSpatialScale = 0.00277, noiseManhattanLimit = 0.35.
  // - Only uniforms that differ across keyframes (inDotsGridSize, inDotsMaxRadius, inDotsMaskInnerStrokeWidth,
  //   inDotsMaskOuterStrokeWidth, inDotsWaveAmplitude) are in createAnimationMask and resolved via ShaderUniforms!
  // - Moreover, in EnergyShaderNode.smali:3802-3806, inTime is set to `timeOffsetMs + elapsedTimeSeconds` where
  //   timeOffsetMs = TimeUtils.getRandomTimeOffsetMs() (~1500.0), so sin(inTime * 0.01) != 0 and rotates basePos by ~45 deg!
  gl.uniform4fv(shaderUniforms.inDotsColor, opts.dotsColor || [0.66, 0.78, 0.98, 1.0]);
  gl.uniform1f(shaderUniforms.inDotsAlpha, opts.dotsAlpha ?? 1.0);
  gl.uniform1f(shaderUniforms.inDotsGridSize, opts.dotsGrid ?? (4.0 * dpr));
  gl.uniform1f(shaderUniforms.inDotsMaxRadius, opts.dotsMaxRadius ?? 0.4);
  gl.uniform1f(shaderUniforms.inDotsMinRadius, opts.dotsMinRadius ?? -0.07);
  gl.uniform1f(shaderUniforms.inDotsBlurRadius, opts.dotsBlurRadius ?? 0.3);
  gl.uniform1f(shaderUniforms.inDotsMoveStrength, opts.dotsMoveStrength ?? 5.0);
  gl.uniform1f(shaderUniforms.inDotsMaskInnerStrokeWidth, opts.dotsInnerStroke ?? (10.0 * dpr));
  gl.uniform1f(shaderUniforms.inDotsMaskOuterStrokeWidth, opts.dotsOuterStroke ?? (50.0 * dpr));
  gl.uniform1f(shaderUniforms.inDotsWaveAmplitude, opts.dotsWaveAmp ?? 0.0);
  gl.uniform1f(shaderUniforms.inDotsWaveFrequency, opts.dotsWaveFreq ?? 0.02);
  gl.uniform1f(shaderUniforms.inDotsWaveSpeed, opts.dotsWaveSpeed ?? 9.0);
  gl.uniform1f(shaderUniforms.inDotsYGradientWeight, opts.dotsYGradWeight ?? 0.0);
  gl.uniform2f(shaderUniforms.inDotsMotionNoiseScale, opts.dotsMotionNoiseScaleX ?? 0.0, opts.dotsMotionNoiseScaleY ?? 0.0);
  gl.uniform3f(shaderUniforms.inDotsMotionNoiseSpeed, opts.dotsMotionNoiseSpeedX ?? 0.6, opts.dotsMotionNoiseSpeedY ?? 0.9, opts.dotsMotionNoiseSpeedZ ?? -1.79);
  gl.uniform1f(shaderUniforms.inDotsNoiseRotationSpeed, opts.dotsNoiseRotationSpeed ?? 0.01);
  gl.uniform1f(shaderUniforms.inDotsNoiseSpatialScale, opts.dotsNoiseSpatialScale ?? 0.00277);
  gl.uniform1f(shaderUniforms.inDotsNoiseManhattanLimit, opts.dotsNoiseManhattanLimit ?? 0.35);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ============================================================================
// 2. Cached Layout Measurements & Screen-Bounds Clamping
//    (Zero getBoundingClientRect() scale bugs; immune to CSS transform: scale)
// ============================================================================
function clampPromptBoxToScreenBounds(snap = false) {
  const margin = 16; // PROMPT_BOX_SCREEN_BOUNDS_OFFSET_DP = 16dp
  const boxW = state.cachedAnchorW || 241;
  const boxH = state.cachedAnchorH || 52;
  const maxX = Math.max(margin, window.innerWidth - boxW - margin);
  const maxY = Math.max(margin, window.innerHeight - boxH - margin);
  state.targetAnchorX = Math.max(margin, Math.min(state.unclampedX, maxX));
  state.targetAnchorY = Math.max(margin, Math.min(state.unclampedY, maxY));

  // MainScreenKt.java:55775: `$promptBoxOffsetRef.setValue(clampedPromptBoxOffset)`!
  // On the real Googlebook, `promptBoxOffsetRef` is overwritten with the clamped offset every frame!
  // That means once the PromptBox is pushed up/left by screen-bounds clamping when it expands,
  // `unclampedX/Y` IS updated to that clamped coordinate so it NEVER shifts back down when an image
  // or suggestion chip is temporarily removed!
  if (!state.isExiting && !state.jumpFading) {
    state.unclampedX = state.targetAnchorX;
    state.unclampedY = state.targetAnchorY;
  }

  // MainScreenKt.java:55786-55796 & MainScreenKt$MainScreen$10$1.java:70-85:
  // On the real Googlebook, `hasAnimatedCursorFollowPosition` is TRUE during cursor following,
  // so `translationX/Y` is set DIRECTLY to `clampedPromptBoxOffset` at 1:1 natural cursor speed!
  if (!state.isExiting) {
    state.anchorX = state.targetAnchorX;
    state.anchorY = state.targetAnchorY;
    floatingAnchor.style.transform = `translate3d(${state.anchorX.toFixed(1)}px, ${state.anchorY.toFixed(1)}px, 0)`;
  }
}

function refreshCachedLayoutMetrics() {
  // Use unscaled layout dimensions (offsetWidth / offsetHeight) so CSS transform: scale(0.8)
  // during CollapsedToExpandedAnimationConfig never corrupts clamping or WebGL chip offsets!
  let anchorW = 241;
  let anchorH = 52;
  if (state.isCollapsed && !aoiThumbnailFan.classList.contains('hidden')) {
    anchorW = aoiThumbnailFan.offsetWidth || 64;
    anchorH = aoiThumbnailFan.offsetHeight || 64;
  } else {
    const pbW = promptBox.offsetWidth || 241;
    const pbH = promptBox.offsetHeight || 52;
    state.cachedPbW = pbW;
    state.cachedPbH = pbH;
    state.cachedPbOffsetX = 0;
    state.cachedPbOffsetY = 0;

    let chipsW = 0;
    let chipsH = 0;
    if (!suggestionChipsContainer.classList.contains('hidden') && state.chipMotions.length > 0) {
      chipsW = suggestionChipsContainer.offsetWidth || 0;
      chipsH = (state.chipMotions.length - 1) * CHIP_STRIDE + CHIP_HEIGHT;
    } else if (state.expanded && !state.isCollapsed && state.selectedAOIs.length > 0) {
      // Reserve vertical space for the 3 suggestion chips immediately when expanded with selected AOIs,
      // even while the On-Device AI model is still generating them, so the PromptBox appears directly
      // at its final clamped position and NEVER jumps upward once the chips finish generating!
      chipsW = Math.max(pbW, 280);
      chipsH = 2 * CHIP_STRIDE + CHIP_HEIGHT; // 3 chips * 48dp + 2 gaps * 8dp = 160px
    }
    anchorW = Math.max(pbW, chipsW);
    anchorH = chipsH > 0 ? pbH + 8 + chipsH : pbH; // PROMPT_BOX_SUGGESTION_CHIPS_SPACING = 8dp

    if (state.chipMotions.length) {
      const ox = 0;
      const oy = pbH + 8;
      state.chipMotions.forEach((motion) => {
        motion.ox = ox;
        motion.oy = oy;
      });
    }
  }
  state.cachedAnchorW = anchorW;
  state.cachedAnchorH = anchorH;
  if (!state.isExiting && !state.jumpFading) {
    clampPromptBoxToScreenBounds();
  }
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    if (state.active) refreshCachedLayoutMetrics();
  });
  if (promptBox) ro.observe(promptBox);
  if (expandedStateWrapper) ro.observe(expandedStateWrapper);
}

// ============================================================================
// 2b. Official MobileRaid TFLite Vision Models + GeneralPostProcessor + EdgeSnapPostProcessor
//     Exact port of MobileRaidSegmenterImpl.java, GeneralPostProcessor.java,
//     EdgeSnapPostProcessor.java, and AOIDetectorImpl.java
//     Runs inside a dedicated background Web Worker (`vision_worker.js`) so the 120fps UI thread
//     NEVER blocks for even 1ms during model loading, XNNPACK inference, or Sobel edge snapping!
// ============================================================================
let visionWorker = null;
let visionWorkerSeq = 0;

function getOrCreateVisionWorker() {
  if (visionWorker) return visionWorker;
  try {
    visionWorker = new Worker('vision_worker.js');
    visionWorker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'screen_aois') {
        if (msg.seq === visionWorkerSeq) {
          state.raidScreenElementAOIs = Array.isArray(msg.aois) ? msg.aois : [];
          if (state.active) {
            updateHoveredAoiForCursor(state.cursorX, state.cursorY);
          }
        }
      } else if (msg.type === 'subelement_aois') {
        const raw = Array.isArray(msg.subAois) ? msg.subAois : [];
        const subAois = raw.map((sub) => {
          const gx = sub.rect.x + msg.safeL;
          const gy = sub.rect.y + msg.safeT;
          return {
            ...sub,
            x: gx,
            y: gy,
            rect: { x: gx, y: gy, width: sub.rect.width, height: sub.rect.height },
            parentAoi: msg.parentAoi
          };
        });
        state.segmentedScreenElements.set(msg.key, subAois);
        if (state.active) {
          updateHoveredAoiForCursor(state.cursorX, state.cursorY);
        }
      }
    };
  } catch (err) {
    console.warn('Vision Worker creation error:', err);
  }
  return visionWorker;
}

// Start and pre-warm the background Vision Worker immediately at startup
getOrCreateVisionWorker();

async function processScreenshotForMobileRaid(screenshotInfo) {
  if (!screenshotInfo || !screenshotInfo.path) return;
  const worker = getOrCreateVisionWorker();
  const srcUrl = `file:///${screenshotInfo.path.replace(/\\/g, '/')}?t=${screenshotInfo.timestamp || Date.now()}`;

  // Exact port of MainScreenKt.java:55623:
  // Render the captured screenshot full-screen behind AoiOverlayCanvas so the screen freezes
  // visually at the exact frame Magic Pointer was triggered!
  if (screenshotFreezeImg) {
    screenshotFreezeImg.onload = () => {
      if (state.active) {
        screenshotFreezeImg.classList.remove('hidden');
      }
    };
    screenshotFreezeImg.src = srcUrl;
  }

  if (!worker) return;

  const img = new Image();
  img.onload = async () => {
    const dipW = window.innerWidth;
    const dipH = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = dipW;
    canvas.height = dipH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, dipW, dipH);

    state.screenshotCanvas = canvas;
    state.segmentedScreenElements.clear();
    for (const timerId of state.segmentingScreenElementTimers.values()) {
      clearTimeout(timerId);
    }
    state.segmentingScreenElementTimers.clear();

    try {
      const seq = ++visionWorkerSeq;
      const bitmap = await createImageBitmap(canvas);
      const ocrBoxes = state.ocrTextAOIs.map((a) => ({
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        rect: a.rect,
        category: 'TEXT'
      }));
      worker.postMessage({ type: 'segment_screen', seq, bitmap, ocrAois: ocrBoxes }, [bitmap]);
    } catch (err) {
      console.warn('processScreenshotForMobileRaid bitmap transfer error:', err);
    }
  };
  img.src = srcUrl;
}

// Exact port of AOIDetectorImpl.triggerScreenElementSegmentation (AOIDetectorImpl.java:293, 1343-1560):
// After hovering inside a window/interactable screenElementAoi for segmentationDelayMs = 500ms,
// crops that element and runs MOBILE_RAID_COMMON_OBJECT + GeneralPostProcessor + EdgeSnapPostProcessor in the background Worker!
function rectKey(r) {
  return `${r.x},${r.y},${r.width},${r.height}`;
}

function triggerScreenElementSegmentation(screenElementAoi) {
  if (!screenElementAoi || !screenElementAoi.rect || !state.screenshotCanvas) return;
  const worker = getOrCreateVisionWorker();
  if (!worker) return;
  const r = screenElementAoi.rect;
  const key = rectKey(r);
  if (state.segmentedScreenElements.has(key) || state.segmentingScreenElementTimers.has(key)) return;

  const timerId = setTimeout(async () => {
    state.segmentingScreenElementTimers.delete(key);
    if (!state.active || !state.screenshotCanvas) return;
    const safeL = Math.max(0, Math.round(r.x));
    const safeT = Math.max(0, Math.round(r.y));
    const safeR = Math.min(state.screenshotCanvas.width, Math.round(r.x + r.width));
    const safeB = Math.min(state.screenshotCanvas.height, Math.round(r.y + r.height));
    const cw = safeR - safeL;
    const ch = safeB - safeT;
    if (cw <= 40 || ch <= 40) {
      state.segmentedScreenElements.set(key, []);
      return;
    }

    try {
      const bitmap = await createImageBitmap(state.screenshotCanvas, safeL, safeT, cw, ch);
      worker.postMessage(
        {
          type: 'segment_subelement',
          key,
          safeL,
          safeT,
          parentAoi: {
            x: screenElementAoi.x,
            y: screenElementAoi.y,
            width: screenElementAoi.width,
            height: screenElementAoi.height,
            rect: screenElementAoi.rect,
            category: screenElementAoi.category,
            title: screenElementAoi.title || '',
            label: screenElementAoi.label || ''
          },
          bitmap
        },
        [bitmap]
      );
    } catch (err) {
      console.warn('triggerScreenElementSegmentation bitmap transfer error:', err);
    }
  }, 500); // segmentationDelayMs = 500L (AOIDetectorImpl.java:293)

  state.segmentingScreenElementTimers.set(key, timerId);
}

// ============================================================================
// 2b-2. OCR Text Clustering, Symbol Hierarchy, TextSelectionCanvas, & generateTextBitmap
//       Exact port of OcrRectRetriever.java, LineSplitRule.java, PqHeuristicClusteringRule.java,
//       BottomBoundaryFilter.java, TextSelectionKt.java, and ScreenContextRepositoryKt.java
// ============================================================================
function processOcrResultIntoTextAOIs(ocrData) {
  if (!ocrData || !Array.isArray(ocrData.lines)) {
    state.ocrTextAOIs = [];
    state.pageOcrBlock = null;
    state.pageOcrSymbols = [];
    return;
  }
  const screenH = window.innerHeight;
  const rawLines = [];

  for (const rawLine of ocrData.lines) {
    if (!rawLine || !Array.isArray(rawLine.words) || rawLine.words.length === 0) continue;
    // Exact port of LineSplitRule.java:46 & 273-295:
    // lineSplitThresholdMultiplier = 4.0f * max(dim1, avgCharDim)
    const sortedWords = [...rawLine.words].sort((a, b) => a.x - b.x);
    let totalCharW = 0;
    let totalChars = 0;
    for (const w of sortedWords) {
      const len = Math.max(1, Array.from(w.text || '').length);
      totalCharW += Math.max(2, w.w);
      totalChars += len;
    }
    const avgCharDim = totalChars > 0 ? totalCharW / totalChars : 10;

    let currentGroup = [sortedWords[0]];
    const splitLineGroups = [currentGroup];

    for (let i = 1; i < sortedWords.length; i++) {
      const prev = sortedWords[i - 1];
      const curr = sortedWords[i];
      const prevChars = Math.max(1, Array.from(prev.text || '').length);
      const dim1 = Math.max(2, prev.w) / prevChars;
      const gap = curr.x - (prev.x + prev.w);
      const splitThreshold = 4.0 * Math.max(dim1, avgCharDim);
      if (gap > splitThreshold) {
        currentGroup = [curr];
        splitLineGroups.push(currentGroup);
      } else {
        currentGroup.push(curr);
      }
    }

    for (const wordGroup of splitLineGroups) {
      const elements = [];
      let lLeft = Infinity, lTop = Infinity, lRight = -Infinity, lBottom = -Infinity;
      for (const w of wordGroup) {
        if (!w.text) continue;
        const wx = w.x, wy = w.y, ww = Math.max(2, w.w), wh = Math.max(2, w.h);
        lLeft = Math.min(lLeft, wx);
        lTop = Math.min(lTop, wy);
        lRight = Math.max(lRight, wx + ww);
        lBottom = Math.max(lBottom, wy + wh);

        // Subdivide word into character OcrTextSymbols
        const chars = Array.from(w.text);
        const charW = ww / Math.max(1, chars.length);
        const symbols = chars.map((ch, idx) => {
          const sx = Math.round(wx + idx * charW);
          const sr = Math.round(wx + (idx + 1) * charW);
          return {
            text: ch,
            boundingBox: {
              left: sx,
              top: wy,
              right: Math.max(sx + 1, sr),
              bottom: wy + wh,
              x: sx,
              y: wy,
              width: Math.max(1, sr - sx),
              height: wh
            }
          };
        });
        elements.push({
          text: w.text,
          boundingBox: { left: wx, top: wy, right: wx + ww, bottom: wy + wh, x: wx, y: wy, width: ww, height: wh },
          symbols
        });
      }
      if (elements.length === 0) continue;
      // BottomBoundaryFilter.java:24-40 & 162-177:
      // Only filters out lines where boundingBox.bottom >= screenHeight and confidence < 0.8f
      if (lBottom >= screenH) continue;
      rawLines.push({
        text: elements.map((e) => e.text).join(' '),
        boundingBox: {
          left: lLeft,
          top: lTop,
          right: lRight,
          bottom: lBottom,
          x: lLeft,
          y: lTop,
          width: lRight - lLeft,
          height: lBottom - lTop
        },
        elements
      });
    }
  }

  // Exact 1:1 port of HeuristicClusteringRule.java (lines 48-58, 271-460) + OcrClusterConfig.java (lines 9-21):
  // - ALIGNMENT_HEIGHT_RATIO = 0.5f
  // - OVERLAP_THRESHOLD = 0.1f
  // - ALIGNMENT_TOLERANCE = 0.05f
  // - VERT_GAP_LIMIT = 1.5f
  const ALIGNMENT_HEIGHT_RATIO = 0.5;
  const OVERLAP_THRESHOLD = 0.1;
  const ALIGNMENT_TOLERANCE = 0.05;
  const VERT_GAP_LIMIT = 1.5;

  let activeGroups = rawLines.map((line, idx) => ({
    indices: new Set([idx]),
    rect: { ...line.boundingBox },
    meanCharHeight: Math.max(2, line.boundingBox.height)
  }));

  activeGroups.sort((a, b) => a.rect.top - b.rect.top);

  function canMergePairwise(g1, g2) {
    const h1 = g1.meanCharHeight;
    const h2 = g2.meanCharHeight;
    if (Math.min(h1, h2) / Math.max(h1, h2) < ALIGNMENT_HEIGHT_RATIO) return false;
    const r1 = g1.rect;
    const r2 = g2.rect;
    if (r1.left > r2.right || r2.left > r1.right) return false;
    const centerX1 = (r1.left + r1.right) * 0.5;
    const centerX2 = (r2.left + r2.right) * 0.5;
    const xAlignDiff = Math.min(
      Math.abs(r1.left - r2.left),
      Math.min(Math.round(Math.abs(centerX1 - centerX2)), Math.abs(r1.right - r2.right))
    );
    const maxAllowedAlignDiff = Math.max(r1.width, r2.width) * ALIGNMENT_TOLERANCE;
    if (xAlignDiff >= maxAllowedAlignDiff) return false;
    const gapY = Math.max(0, Math.max(r1.top, r2.top) - Math.min(r1.bottom, r2.bottom));
    return gapY < Math.max(h1, h2) * VERT_GAP_LIMIT;
  }

  function unionRects(r1, r2) {
    const left = Math.min(r1.left, r2.left);
    const top = Math.min(r1.top, r2.top);
    const right = Math.max(r1.right, r2.right);
    const bottom = Math.max(r1.bottom, r2.bottom);
    return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top };
  }

  function overlapsWithOtherGroups(newRect, newIndices, list, skipI, skipJ) {
    for (let k = 0; k < list.length; k++) {
      if (k === skipI || k === skipJ) continue;
      const other = list[k];
      let sharesIdx = false;
      for (const idx of other.indices) {
        if (newIndices.has(idx)) {
          sharesIdx = true;
          break;
        }
      }
      if (sharesIdx) continue;
      const il = Math.max(newRect.left, other.rect.left);
      const it = Math.max(newRect.top, other.rect.top);
      const ir = Math.min(newRect.right, other.rect.right);
      const ib = Math.min(newRect.bottom, other.rect.bottom);
      if (ir > il && ib > it) {
        const interArea = (ir - il) * (ib - it);
        const otherArea = other.rect.width * other.rect.height;
        if (otherArea > 0 && interArea / otherArea > OVERLAP_THRESHOLD) {
          return true;
        }
      }
    }
    return false;
  }

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    const nextList = [];
    const mergedIndices = new Set();
    const numElements = activeGroups.length;
    for (let i = 0; i < numElements; i++) {
      if (mergedIndices.has(i)) continue;
      const lhs = activeGroups[i];
      const gapLimit = (VERT_GAP_LIMIT / ALIGNMENT_TOLERANCE) * lhs.meanCharHeight;
      let lhsMerged = false;
      for (let j = i + 1; j < numElements; j++) {
        if (mergedIndices.has(j)) continue;
        const rhs = activeGroups[j];
        const gap = rhs.rect.top - lhs.rect.bottom;
        if (gap <= gapLimit && canMergePairwise(lhs, rhs)) {
          const newIndices = new Set([...lhs.indices, ...rhs.indices]);
          const unionR = unionRects(lhs.rect, rhs.rect);
          if (!overlapsWithOtherGroups(unionR, newIndices, activeGroups, i, j)) {
            const newMeanCharHeight =
              (lhs.indices.size * lhs.meanCharHeight + rhs.indices.size * rhs.meanCharHeight) / newIndices.size;
            nextList.push({
              indices: newIndices,
              rect: unionR,
              meanCharHeight: newMeanCharHeight
            });
            mergedIndices.add(i);
            mergedIndices.add(j);
            lhsMerged = true;
            mergedAny = true;
            break;
          }
        }
      }
      if (!lhsMerged) {
        nextList.push(lhs);
      }
    }
    activeGroups = nextList;
  }

  const blocks = [];
  for (const grp of activeGroups) {
    const groupLines = Array.from(grp.indices)
      .map((idx) => rawLines[idx])
      .filter(Boolean)
      .sort((a, b) => a.boundingBox.top - b.boundingBox.top);
    if (groupLines.length === 0) continue;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const l of groupLines) {
      left = Math.min(left, l.boundingBox.left);
      top = Math.min(top, l.boundingBox.top);
      right = Math.max(right, l.boundingBox.right);
      bottom = Math.max(bottom, l.boundingBox.bottom);
    }
    blocks.push({
      text: groupLines.map((l) => l.text).join('\n'),
      boundingBox: {
        left,
        top,
        right,
        bottom,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      },
      lines: groupLines
    });
  }

  state.ocrTextAOIs = blocks.map((block) => ({
    x: block.boundingBox.x,
    y: block.boundingBox.y,
    width: block.boundingBox.width,
    height: block.boundingBox.height,
    rect: {
      x: block.boundingBox.x,
      y: block.boundingBox.y,
      width: block.boundingBox.width,
      height: block.boundingBox.height
    },
    category: 'TEXT',
    text: block.text,
    parsedText: block
  }));

  // Build unified full-page reading-order OcrTextBlock so the user can drag-select text
  // indefinitely across the entire page (spanning multiple paragraphs/columns)!
  const sortedBlocks = [...blocks].sort((a, b) => {
    const ab = a.boundingBox;
    const bb = b.boundingBox;
    const vOverlap = Math.min(ab.bottom, bb.bottom) - Math.max(ab.top, bb.top);
    if (vOverlap > Math.min(ab.height, bb.height) * 0.25) {
      return ab.left - bb.left;
    }
    return ab.top - bb.top || ab.left - bb.left;
  });
  const allPageLines = [];
  for (const blk of sortedBlocks) {
    if (Array.isArray(blk.lines)) {
      allPageLines.push(...blk.lines);
    }
  }
  state.pageOcrBlock = {
    text: sortedBlocks.map((b) => b.text).join('\n'),
    lines: allPageLines
  };
  state.pageOcrSymbols = flattenOcrSymbols(state.pageOcrBlock);

  // Exact port of AOIDetectorImpl$init$processedAllDeferred$1.java:78-83:
  // Send OCR TEXT bounding boxes to visionWorker so EdgeSnapPostProcessor.sideClamps
  // clamps INTERACTABLE boxes from expanding into adjacent OCR text blocks!
  const worker = getOrCreateVisionWorker();
  if (worker && state.ocrTextAOIs.length > 0) {
    const ocrBoxes = state.ocrTextAOIs.map((a) => ({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height,
      rect: a.rect,
      category: 'TEXT'
    }));
    worker.postMessage({
      type: 'reprocess_with_ocr',
      seq: visionWorkerSeq,
      ocrAois: ocrBoxes
    });
  }

  if (state.active) {
    if (!state.isDraggingAOI && !state.isTextSelecting) {
      updateHoveredAoiForCursor(state.cursorX, state.cursorY);
      const hitEl = document.elementFromPoint(state.cursorX, state.cursorY);
      updateCursorTypeForTarget(hitEl);
    }
    // Backfill ocrText on any already-selected screen AOIs from the CURRENT session whose OCR hadn't arrived yet!
    // (Skip saved-draft AOIs from a previous session so new-screen OCR never wipes out cached suggestions!)
    let backfilled = false;
    for (const aoi of state.selectedAOIs) {
      if (aoi.type === 'screen' && aoi.rect && !aoi.ocrText && !aoi.fromSavedDraft) {
        const contained = fetchContainedOcrTextForRect(aoi.rect);
        if (contained) {
          aoi.ocrText = contained;
          state.llmChipsCache.clear();
          backfilled = true;
        }
      }
    }
    if (backfilled && state.expanded && !state.isCollapsed) {
      renderSuggestionChips();
    }
  }
}

// Exact port of TextSelectionKt.flattenSymbols, getInsertionPointIndex, & getSelectedText (TextSelectionKt.java:234-375)
function flattenOcrSymbols(textBlock) {
  if (!textBlock || !Array.isArray(textBlock.lines)) return [];
  const out = [];
  for (let lIdx = 0; lIdx < textBlock.lines.length; lIdx++) {
    const line = textBlock.lines[lIdx];
    const elems = line.elements || [];
    for (let eIdx = 0; eIdx < elems.length; eIdx++) {
      const el = elems[eIdx];
      const syms = el.symbols || [];
      for (const sym of syms) {
        out.push({ symbol: sym, element: el, line });
      }
    }
  }
  return out;
}

function getInsertionPointIndexForOcr(symbols, px, py) {
  if (!symbols.length) return 0;
  let minDist = Infinity;
  let closestIdx = -1;
  for (let i = 0; i < symbols.length; i++) {
    const r = symbols[i].symbol.boundingBox;
    if (!r) continue;
    const cx = (r.left + r.right) * 0.5;
    const cy = (r.top + r.bottom) * 0.5;
    const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (d < minDist) {
      minDist = d;
      closestIdx = i;
    }
  }
  if (closestIdx === -1) return 0;
  const r = symbols[closestIdx].symbol.boundingBox;
  const cx = (r.left + r.right) * 0.5;
  return px <= cx ? closestIdx : closestIdx + 1;
}

function reconstructSelectedOcrText(wrappers) {
  let sb = '';
  for (let i = 0; i < wrappers.length; i++) {
    const curr = wrappers[i];
    sb += curr.symbol.text;
    if (i < wrappers.length - 1) {
      const next = wrappers[i + 1];
      if (curr.line !== next.line) {
        sb += '\n';
      } else if (curr.element !== next.element) {
        sb += ' ';
      }
    }
  }
  return sb;
}

function getSelectedTextAndGeometryFromPage(startX, startY, endX, endY) {
  const startBlock = state.textSelectionAoi && state.textSelectionAoi.parsedText;
  const pageBlock = state.pageOcrBlock || startBlock;
  if (!pageBlock || !Array.isArray(pageBlock.lines) || !pageBlock.lines.length) return null;

  // Filter page lines so we only select lines in the SAME column (horizontally overlapping with the starting text block
  // or the user's horizontal drag span). This prevents sidebar items or adjacent columns from ever stretching the
  // selection rectangle across the entire horizontal width of the screen!
  let colMinX = Math.min(startX, endX) - 24;
  let colMaxX = Math.max(startX, endX) + 24;
  if (startBlock && startBlock.boundingBox) {
    colMinX = Math.min(colMinX, startBlock.boundingBox.left - 24);
    colMaxX = Math.max(colMaxX, startBlock.boundingBox.right + 24);
  }

  const columnLines = pageBlock.lines.filter((line) => {
    const lb = line && line.boundingBox;
    if (!lb) return false;
    return lb.right >= colMinX && lb.left <= colMaxX;
  });

  const activeBlock = columnLines.length > 0 ? { lines: columnLines } : (startBlock || pageBlock);
  const symbols = flattenOcrSymbols(activeBlock);
  if (!symbols.length) return null;
  const sIdx = getInsertionPointIndexForOcr(symbols, startX, startY);
  const eIdx = getInsertionPointIndexForOcr(symbols, endX, endY);
  if (sIdx === eIdx) return null;
  const minIdx = Math.min(sIdx, eIdx);
  const maxIdx = Math.max(sIdx, eIdx) - 1;
  const text = reconstructSelectedOcrText(symbols.slice(minIdx, maxIdx + 1));
  if (!text || !text.trim()) return null;

  const lineRects = [];
  let uLeft = Infinity, uTop = Infinity, uRight = -Infinity, uBottom = -Infinity;
  let lineStartIdx = 0;

  for (const line of activeBlock.lines) {
    const lineSymbols = [];
    for (const el of line.elements || []) {
      for (const sym of el.symbols || []) {
        lineSymbols.push(sym);
      }
    }
    const lineEndIdx = lineStartIdx + lineSymbols.length - 1;
    const iStart = Math.max(lineStartIdx, minIdx);
    const iEnd = Math.min(lineEndIdx, maxIdx);
    if (iStart <= iEnd) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let k = iStart - lineStartIdx; k <= iEnd - lineStartIdx; k++) {
        const sr = lineSymbols[k] && lineSymbols[k].boundingBox;
        if (sr) {
          if (sr.left < left) left = sr.left;
          if (sr.top < top) top = sr.top;
          if (sr.right > right) right = sr.right;
          if (sr.bottom > bottom) bottom = sr.bottom;
        }
      }
      if (left < right && top < bottom) {
        lineRects.push({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top });
        if (left < uLeft) uLeft = left;
        if (top < uTop) uTop = top;
        if (right > uRight) uRight = right;
        if (bottom > uBottom) uBottom = bottom;
      }
    }
    lineStartIdx += lineSymbols.length;
  }

  if (!lineRects.length || uLeft >= uRight || uTop >= uBottom) return null;
  const rawUnion = {
    x: uLeft,
    y: uTop,
    width: Math.max(8, uRight - uLeft),
    height: Math.max(8, uBottom - uTop)
  };
  const rect = constrainAoiRectToScreen(rawUnion) || rawUnion;
  return { text, rect, lineRects };
}

function getSelectedTextFromAoi(aoi, startX, startY, endX, endY) {
  const pageSel = getSelectedTextAndGeometryFromPage(startX, startY, endX, endY);
  if (pageSel && pageSel.text) return pageSel.text;
  const textBlock = aoi && aoi.parsedText;
  if (!textBlock) return null;
  const symbols = flattenOcrSymbols(textBlock);
  if (!symbols.length) return null;
  const sIdx = getInsertionPointIndexForOcr(symbols, startX, startY);
  const eIdx = getInsertionPointIndexForOcr(symbols, endX, endY);
  if (sIdx === eIdx) return null;
  const min = Math.min(sIdx, eIdx);
  const max = Math.max(sIdx, eIdx);
  return reconstructSelectedOcrText(symbols.slice(min, max));
}

// Exact port of TextSelectionKt.getTextWithinBounds & MainScreenStateFragmentPeer.fetchContainedText (MainScreenStateFragmentPeer.java:602-674)
function fetchContainedOcrTextForRect(rect) {
  if (!rect || !state.ocrTextAOIs.length) return null;
  const rLeft = rect.x, rTop = rect.y, rRight = rect.x + rect.width, rBottom = rect.y + rect.height;
  const parts = [];
  for (const ocrAoi of state.ocrTextAOIs) {
    const or = ocrAoi.rect;
    if (!or) continue;
    const intersects = !(or.x + or.width < rLeft || or.x > rRight || or.y + or.height < rTop || or.y > rBottom);
    if (!intersects) continue;
    if (ocrAoi.parsedText) {
      const wrappers = flattenOcrSymbols(ocrAoi.parsedText).filter((w) => {
        const b = w.symbol.boundingBox;
        if (!b) return false;
        const cx = (b.left + b.right) * 0.5;
        const cy = (b.top + b.bottom) * 0.5;
        return cx >= rLeft && cx <= rRight && cy >= rTop && cy <= rBottom;
      });
      const txt = reconstructSelectedOcrText(wrappers).trim();
      if (txt) parts.push(txt);
    } else if (ocrAoi.text && ocrAoi.text.trim()) {
      parts.push(ocrAoi.text.trim());
    }
  }
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

// Exact port of ScreenContextRepositoryKt.generateTextBitmap (ScreenContextRepositoryKt.java:16-70):
// Renders an 80x80px white card (#FFFFFF) with black text (#000000), 8px padding (64px available width/height),
// auto-sized from 25px down to 14px so it fits within <= 4 lines (with ellipsis on line 4 if still longer),
// centered horizontally if 1 line and vertically centered across all lines!
function generateTextBitmapDataUrl(text) {
  const size = 80;
  const pad = 8;
  const avail = size - pad * 2; // 64px
  const dpr = 2; // Render at 2x for crisp HiDPI thumbnail display
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // TEXT_BITMAP_BACKGROUND_COLOR = -1 (#FFFFFF), TEXT_BITMAP_TEXT_COLOR = -16777216 (#000000)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return canvas.toDataURL('image/png');

  function wrapLines(fontPx, maxLines, ellipsize) {
    ctx.font = `400 ${fontPx}px "Google Sans", "Segoe UI", Roboto, sans-serif`;
    const words = cleanText.split(' ');
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width <= avail) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        // If a single word is wider than avail, break character by character
        if (ctx.measureText(word).width > avail) {
          let chunk = '';
          for (const ch of Array.from(word)) {
            if (ctx.measureText(chunk + ch).width <= avail) {
              chunk += ch;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);

    if (ellipsize && lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 0 && ctx.measureText(last + '…').width > avail) {
        last = last.slice(0, -1);
      }
      kept[maxLines - 1] = last + '…';
      return kept;
    }
    return lines;
  }

  let chosenFont = 14;
  let chosenLines = null;
  for (let fontSize = 25; fontSize >= 14; fontSize--) {
    const lines = wrapLines(fontSize, 4, false);
    const lineHeight = fontSize * 1.15;
    const totalH = lines.length * lineHeight;
    if (lines.length <= 4 && totalH <= avail) {
      chosenFont = fontSize;
      chosenLines = lines;
      break;
    }
  }
  if (!chosenLines) {
    chosenFont = 14;
    chosenLines = wrapLines(14, 4, true);
  }

  ctx.font = `400 ${chosenFont}px "Google Sans", "Segoe UI", Roboto, sans-serif`;
  const lineH = chosenFont * 1.15;
  const blockH = chosenLines.length * lineH;
  const startY = Math.max(pad, (size - blockH) / 2);

  if (chosenLines.length === 1) {
    const w = ctx.measureText(chosenLines[0]).width;
    const startX = pad + Math.max(0, (avail - w) / 2);
    ctx.fillText(chosenLines[0], startX, startY);
  } else {
    for (let i = 0; i < chosenLines.length; i++) {
      ctx.fillText(chosenLines[i], pad, startY + i * lineH);
    }
  }

  return canvas.toDataURL('image/png');
}

// ============================================================================
// 2c. Hovered AOI Detection & AoiCard State Machine
//     Exact port of AOIDetectorImpl.getConsensusAOI + MainScreenKt.rememberAoiCardState
// ============================================================================
function constrainAoiRectToScreen(rect) {
  if (!rect) return null;
  const edgeMargin = 16; // MainScreenKt.java:57154: edgeMarginPx = density.toPx(16.dp)
  const left = Math.max(rect.x, edgeMargin);
  const top = Math.max(rect.y, edgeMargin);
  const right = Math.min(rect.x + rect.width, window.innerWidth - edgeMargin);
  const bottom = Math.min(rect.y + rect.height, window.innerHeight - edgeMargin);
  if (left >= right || top >= bottom) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function rectContains(outer, inner) {
  if (!outer || !inner) return false;
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

// Exact port of AOIDetectorImpl.updateAoiFlowForCurrentCursor & getConsensusAOI (AOIDetectorImpl.java:782-833 & 1264-1330)
function getConsensusWindowAoiAt(cx, cy) {
  const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen;
  if (!inSelection || state.isDraggingAOI) return null;

  // Exact port of AOIDetectorImpl.getBaseAOIs (AOIDetectorImpl.java:1224-1260) &
  // RectRetrieverType.java:10 (ONLY 3 sources exist in Googlebook: ML_KIT_OCR + MOBILE_RAID_SCREEN_ELEMENT + MOBILE_RAID_COMMON_OBJECT;
  // OS EnumWindows is NOT part of Googlebook's AOIDetectorImpl, as classId 704 of mobile_raid_v2_2_float32_finetuned_0804.tflite
  // already detects WINDOW AOIs visually!):
  const baseAois = [
    ...state.ocrTextAOIs,
    ...state.raidScreenElementAOIs
  ];

  // 1. Default Phenotype flag 45823749 (CommonObjectFlagsImpl$FeatureModule.smali:51):
  //    enableCommonObjectAoi = FALSE by default in Googlebook APK!
  const enableCommonObjectAoi = false;
  const subAois = [];
  if (enableCommonObjectAoi) {
    const containingScreenElements = baseAois
      .filter((a) => (a.category === 'WINDOW' || a.category === 'INTERACTABLE') && a.rect &&
        cx >= a.rect.x && cx <= a.rect.x + a.rect.width && cy >= a.rect.y && cy <= a.rect.y + a.rect.height)
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));

    const activeKeys = new Set(containingScreenElements.map((a) => rectKey(a.rect)));
    for (const [k, timerId] of state.segmentingScreenElementTimers.entries()) {
      if (!activeKeys.has(k)) {
        clearTimeout(timerId);
        state.segmentingScreenElementTimers.delete(k);
      }
    }
    if (containingScreenElements.length > 0) {
      triggerScreenElementSegmentation(containingScreenElements[0]);
    }

    for (const [k, list] of state.segmentedScreenElements.entries()) {
      const [rx, ry, rw, rh] = k.split(',').map(Number);
      if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) {
        subAois.push(...list);
      }
    }
  }

  // 3. Pick the smallest-area AOI containing the cursor across baseAois + subAois
  const allAois = [...baseAois, ...subAois];
  let best = null;
  let bestArea = Infinity;
  for (const aoi of allAois) {
    const r = aoi.rect || aoi;
    if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = aoi;
      }
    }
  }
  if (!best) return null;
  const constrained = constrainAoiRectToScreen(best.rect || best);
  return constrained ? { ...best, rect: constrained } : null;
}

function updateHoveredAoiForCursor(cx, cy) {
  const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen;
  if (!inSelection) {
    if (state.renderedHoverAoi || state.hoveredAoi) {
      clearTimeout(state.hoverDelayTimer);
      state.hoveredAoi = null;
      state.renderedHoverAoi = null;
      state.hoverCardAlpha = 0;
      state.scrimCutOutAlpha = 0;
      state.hasFirstAoiAmbientTransitionPlayed = false;
      state.scrimDirty = true;
    }
    return;
  }
  if (state.isDraggingAOI) return;

  const nextAoi = getConsensusWindowAoiAt(cx, cy);
  const lastAoi = state.hoveredAoi;
  if (rectEquals(nextAoi ? nextAoi.rect : null, lastAoi ? lastAoi.rect : null)) {
    return;
  }

  state.hoveredAoi = nextAoi;
  clearTimeout(state.hoverDelayTimer);
  const now = performance.now();

  // MainScreenKt$scrimCutOutAlpha$1$1.java & MainScreenKt$rememberAoiCardState$2$1.java:
  // If moving from an inner AOI to a parent WINDOW AOI that contains lastAoi, delay by WINDOW_AOI_HIGHLIGHT_DELAY_MS = 300ms
  const isParentWindowTransition = nextAoi && lastAoi && rectContains(nextAoi.rect, lastAoi.rect);

  if (nextAoi) {
    state.scrimCutOutAlpha = 0;
    state.scrimCutOutStartTime = now;
    state.scrimCutOutDelayMs = isParentWindowTransition ? 300 : 0;
    state.hoverAmbientDelayMs = state.hasFirstAoiAmbientTransitionPlayed ? 0 : 400; // FIRST_AOI_HOVER_AMBIENT_TRANSITION_DELAY = 400ms
    state.hoverEffectStartTime = now;

    if (isParentWindowTransition) {
      state.hoverCardAlpha = 0;
      state.renderedHoverAoi = nextAoi;
      state.hoverDelayTimer = setTimeout(() => {
        state.hoverCardAlpha = 1;
        state.scrimDirty = true;
      }, 300);
    } else {
      state.renderedHoverAoi = nextAoi;
      state.hoverCardAlpha = 1;
    }

    if (!state.hasFirstAoiAmbientTransitionPlayed) {
      setTimeout(() => {
        if (state.aoiSelectionMode && state.renderedHoverAoi) {
          state.hasFirstAoiAmbientTransitionPlayed = true;
        }
      }, 400);
    }
  } else {
    state.hoverCardAlpha = 0;
    state.scrimCutOutAlpha = 0;
    state.hoverDelayTimer = setTimeout(() => {
      if (!state.hoveredAoi) {
        state.renderedHoverAoi = null;
        state.scrimDirty = true;
      }
    }, 300);
  }
  state.scrimDirty = true;
}

// ============================================================================
// 3. Scrim Canvas + EnergyShader + 120fps Spring Follow Loop
// ============================================================================
function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  scrimCanvas.width = window.innerWidth * dpr;
  scrimCanvas.height = window.innerHeight * dpr;
  energyCanvas.width = window.innerWidth * dpr;
  energyCanvas.height = window.innerHeight * dpr;
  state.scrimDirty = true;
  refreshCachedLayoutMetrics();
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
initWebGLShader();
redrawScrimCanvas();

function redrawScrimCanvas() {
  state.scrimDirty = false;
  const dpr = window.devicePixelRatio || 1;
  const ctx = scrimCanvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // AoiOverlayCanvas (MainScreen.kt:1371): always draws scrimColor = Color.Black.copy(alpha = 0.32f)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // Cutout is drawn when in selection mode OR while a screen AOI crop is in-flight (`state.croppingAoiRect`)
  const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen || state.isDraggingAOI || !!state.croppingAoiRect;
  if (inSelection) {
    const activeDragRect = state.isDraggingAOI
      ? constrainAoiRectToScreen(getNormalizedDragRect())
      : state.croppingAoiRect
        ? constrainAoiRectToScreen(state.croppingAoiRect)
        : null;
    const livePageSel = state.isTextSelecting
      ? getSelectedTextAndGeometryFromPage(state.textSelStartX, state.textSelStartY, state.textSelEndX, state.textSelEndY)
      : state.pendingTextSelection;

    if (activeDragRect && activeDragRect.width > 6 && activeDragRect.height > 6) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      drawRoundedRectPath(
        ctx,
        activeDragRect.x - 8,
        activeDragRect.y - 8,
        activeDragRect.width + 16,
        activeDragRect.height + 16,
        12
      );
      ctx.fill();
    } else if (state.isTextSelecting) {
      // Point 1: While dragging to select text on the page, cut out ONLY the tight individual word boxes
      // directly (without any padded region or paragraph block box around them), so only the words themselves
      // are exempt from the dark background tint!
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      if (state.pageOcrBlock && Array.isArray(state.pageOcrBlock.lines)) {
        for (const line of state.pageOcrBlock.lines) {
          if (!line || !Array.isArray(line.elements)) continue;
          for (const el of line.elements) {
            const b = el && el.boundingBox;
            if (!b || b.width <= 0 || b.height <= 0) continue;
            drawRoundedRectPath(ctx, b.left, b.top, b.width, b.height, 2);
            ctx.fill();
          }
        }
      }
    } else if (state.pendingTextSelection && state.pendingTextSelection.rect) {
      // Once text selection finishes, cutout & highlight the selected text area!
      const sr = state.pendingTextSelection.rect;
      const elapsedSel = Math.max(0, performance.now() - (state.pendingTextSelection.createdAt || performance.now()));
      const cutoutAlpha = Math.min(1, elapsedSel / 250);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${cutoutAlpha.toFixed(3)})`;
      drawRoundedRectPath(
        ctx,
        sr.x - 8,
        sr.y - 8,
        sr.width + 16,
        sr.height + 16,
        12
      );
      ctx.fill();
    } else if (state.hoveredAoi && state.hoveredAoi.rect && state.scrimCutOutAlpha > 0.005) {
      const hr = state.hoveredAoi.rect;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${state.scrimCutOutAlpha.toFixed(3)})`;
      drawRoundedRectPath(
        ctx,
        hr.x - 8,
        hr.y - 8,
        hr.width + 16,
        hr.height + 16,
        12
      );
      ctx.fill();
    }

    // TextSelectionOverlay (MainScreenKt.java:57435 & TextSelectionKt.java:80-225):
    // Draws per-line character highlight boxes across the entire page with TEXT_SELECTION_COLOR = primary.copy(alpha = 0.3f)
    if (livePageSel && Array.isArray(livePageSel.lineRects) && livePageSel.lineRects.length > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = state.isDarkMode ? 'rgba(168, 199, 250, 0.30)' : 'rgba(11, 87, 208, 0.30)';
      for (const lr of livePageSel.lineRects) {
        ctx.fillRect(lr.left, lr.top, lr.width, lr.height);
      }
    }
  }
  ctx.restore();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function renderFrame(now) {
  const dt = Math.min(50, Math.max(1, now - lastFrameTime));
  lastFrameTime = now;

  if (!state.active) {
    requestAnimationFrame(renderFrame);
    return;
  }

  // 1. Keep Floating PromptBox locked 1:1 to targetAnchorX/Y at natural OS cursor speed
  //    (Skip while exiting so we never overwrite the saveDraftAndExit flight transform!)
  if (!state.isExiting) {
    if (state.anchorX !== state.targetAnchorX || state.anchorY !== state.targetAnchorY) {
      state.anchorX = state.targetAnchorX;
      state.anchorY = state.targetAnchorY;
      floatingAnchor.style.transform = `translate3d(${state.anchorX.toFixed(1)}px, ${state.anchorY.toFixed(1)}px, 0)`;
    }
  }

  tickChipMotions(dt, now);
  tickTextActionCircles(dt, now);
  tickSnackbarMotion(dt);

  // Animate scrimCutOutAlpha (MainScreenKt$scrimCutOutAlpha$1$1.java: tween(300ms, delay = 0 or 300ms, LinearEasing))
  if (state.hoveredAoi && !state.isDraggingAOI) {
    const elapsedCutout = now - state.scrimCutOutStartTime - state.scrimCutOutDelayMs;
    const nextCutoutAlpha = elapsedCutout <= 0 ? 0 : Math.min(1, elapsedCutout / 300);
    if (Math.abs(nextCutoutAlpha - state.scrimCutOutAlpha) > 0.005) {
      state.scrimCutOutAlpha = nextCutoutAlpha;
      state.scrimDirty = true;
    }
  }

    // 2. AoiOverlayCanvas scrim is visible whenever Magic Pointer is active (fades in 160ms, fades out on exit)
  if (!state.isExiting) {
    scrimCanvas.classList.add('visible');
  }
  const hasAnimatingPendingSel =
    state.pendingTextSelection &&
    performance.now() - (state.pendingTextSelection.createdAt || 0) < 320;
  if (state.scrimDirty || state.isDraggingAOI || state.isTextSelecting || hasAnimatingPendingSel) {
    redrawScrimCanvas();
  }

  // 3. Render WebGL2 EnergyShader using Scissor-accelerated regions
  if (gl && shaderProgram) {
    const dpr = window.devicePixelRatio || 1;
    gl.viewport(0, 0, energyCanvas.width, energyCanvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(shaderProgram);

    const t = (now - shaderStartTime) / 1000.0;
    gl.uniform1f(shaderUniforms.inTime, t);
    gl.uniform2f(shaderUniforms.inResolution, energyCanvas.width, energyCanvas.height);

    const isDark = state.isDarkMode;
    // Exact Material 3 & EnergyColors tokens from AoiCardKt & SuggestionChipsKt
    const panelCol = isDark ? [0.20, 0.208, 0.227, 1.0] : [0.886, 0.886, 0.914, 1.0]; // surfaceContainerHighest
    const borderSurfaceCol = isDark ? [0.35, 0.52, 0.86, 1.0] : [0.25, 0.45, 0.85, 1.0]; // resolvedSurfaceEnergyColor
    const primaryDotsCol = isDark ? [0.659, 0.780, 0.980, 1.0] : [0.043, 0.341, 0.816, 1.0]; // primary (#a8c7fa / #0b57d0)
    const inversePrimaryCol = [0.26, 0.52, 0.96, 1.0]; // eInversePrimaryColors
    const baseDotsColor = [0.659, 0.443, 0.961, 1.0]; // InternalEnergyShaderDotsConfig.DOTS_COLOR = Color.argb(168, 168, 113, 245)

    // 3a. AoiCard (AoiCardKt.java & AoiCardConfig.java):
    //     - While actively text-selecting (`state.isTextSelecting`), the rectangular shader is HIDDEN!
    //     - Once text selection finishes (`state.pendingTextSelection`), the rectangular shader reappears
    //       over the selected text area with its 500ms in-animation (`entryP`: 0 -> 1), and then the Copy & Plus circles appear!
    const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen || !!state.croppingAoiRect;
    const activeDragRect = state.isDraggingAOI
      ? constrainAoiRectToScreen(getNormalizedDragRect())
      : state.croppingAoiRect
        ? constrainAoiRectToScreen(state.croppingAoiRect)
        : null;

    if (activeDragRect && activeDragRect.width > 6 && activeDragRect.height > 6) {
      drawEnergyShape({
        baseTimeSec: t,
        timeOffsetSec: 1500.0,
        cx: (activeDragRect.x + activeDragRect.width * 0.5) * dpr,
        cy: (activeDragRect.y + activeDragRect.height * 0.5) * dpr,
        w: (activeDragRect.width + 16) * dpr,
        h: (activeDragRect.height + 16) * dpr,
        r: 12.0 * dpr,
        spread: 64.0 * dpr,
        panelAlpha: 0.0,
        panelTopBlur: 64.0 * dpr,
        panelBottomBlur: 64.0 * dpr,
        spotLightAlpha: 0.0,
        borderAlpha1: 1.0,
        color1: inversePrimaryCol,
        stroke1: 2.0 * dpr,
        topBlur1: 7.0 * dpr,
        bottomBlur1: 7.0 * dpr,
        topIntensity1: 0.2,
        bottomIntensity1: 0.2,
        borderDistSpeed1: 0.0,
        borderDistFreq1: 0.0,
        borderDistAmp1: 0.0,
        borderAlpha2: 1.0,
        color2: inversePrimaryCol,
        stroke2: 3.0 * dpr,
        topBlur2: 20.0 * dpr,
        bottomBlur2: 20.0 * dpr,
        topIntensity2: 0.2,
        bottomIntensity2: 0.2,
        borderDistSpeed2: 0.0,
        borderDistFreq2: 0.0,
        borderDistAmp2: 0.0,
        dotsColor: primaryDotsCol,
        dotsAlpha: 1.0,
        dotsGrid: 4.0 * dpr,
        dotsMaxRadius: 0.4,
        dotsMinRadius: -0.07,
        dotsBlurRadius: 0.3,
        dotsMoveStrength: 5.0,
        dotsInnerStroke: 10.0 * dpr,
        dotsOuterStroke: 50.0 * dpr,
        dotsWaveAmp: 0.0,
        dotsWaveFreq: 0.02,
        dotsWaveSpeed: 9.0,
        dotsYGradWeight: 0.0
      });
    } else if (!state.isTextSelecting && state.pendingTextSelection && state.pendingTextSelection.rect) {
      // Point 1: After finishing text selection, reappear the rectangular AoiCard shader with its 500ms in-animation!
      const sr = state.pendingTextSelection.rect;
      const elapsedEntry = Math.max(0, now - (state.pendingTextSelection.createdAt || now));
      const entryP = Math.min(1, elapsedEntry / 500);
      const aMul = entryP;
      if (aMul > 0.005) {
        drawEnergyShape({
          baseTimeSec: t,
          timeOffsetSec: 1500.0,
          cx: (sr.x + sr.width * 0.5) * dpr,
          cy: (sr.y + sr.height * 0.5) * dpr,
          w: (sr.width + 16) * dpr,
          h: (sr.height + 16) * dpr,
          r: 12.0 * dpr,
          spread: 64.0 * dpr,
          panelAlpha: 0.0,
          panelTopBlur: 64.0 * dpr,
          panelBottomBlur: 64.0 * dpr,
          spotLightAlpha: 0.0,
          borderAlpha1: aMul,
          color1: inversePrimaryCol,
          stroke1: 2.0 * dpr,
          topBlur1: 7.0 * dpr,
          bottomBlur1: 7.0 * dpr,
          topIntensity1: 0.2,
          bottomIntensity1: 0.2,
          borderDistSpeed1: 0.0,
          borderDistFreq1: 0.0,
          borderDistAmp1: 0.0,
          borderAlpha2: aMul,
          color2: inversePrimaryCol,
          stroke2: 3.0 * dpr,
          topBlur2: 20.0 * dpr,
          bottomBlur2: 20.0 * dpr,
          topIntensity2: 0.2,
          bottomIntensity2: 0.2,
          borderDistSpeed2: 0.0,
          borderDistFreq2: 0.0,
          borderDistAmp2: 0.0,
          dotsColor: primaryDotsCol,
          dotsAlpha: aMul,
          dotsGrid: lerp(4.5, 4.0, entryP) * dpr,
          dotsMaxRadius: lerp(0.0, 0.4, entryP),
          dotsMinRadius: -0.07,
          dotsBlurRadius: 0.3,
          dotsMoveStrength: 5.0,
          dotsInnerStroke: lerp(0.0, 10.0, entryP) * dpr,
          dotsOuterStroke: lerp(60.0, 50.0, entryP) * dpr,
          dotsWaveAmp: 0.0,
          dotsWaveFreq: 0.02,
          dotsWaveSpeed: 9.0,
          dotsYGradWeight: 0.0
        });
      }
    } else if (!state.isTextSelecting && inSelection && state.renderedHoverAoi && state.renderedHoverAoi.rect && state.hoverCardAlpha > 0.01) {
      const hr = state.renderedHoverAoi.rect;
      const elapsedEntry = now - state.hoverEffectStartTime - state.hoverAmbientDelayMs;
      const entryP = elapsedEntry <= 0 ? 0 : Math.min(1, elapsedEntry / 500);
      const aMul = state.hoverCardAlpha * entryP;
      if (aMul > 0.005) {
        // Exact AoiCardConfig.java:112-212:
        drawEnergyShape({
          baseTimeSec: t,
          timeOffsetSec: 1500.0,
          cx: (hr.x + hr.width * 0.5) * dpr,
          cy: (hr.y + hr.height * 0.5) * dpr,
          w: (hr.width + 16) * dpr,
          h: (hr.height + 16) * dpr,
          r: 12.0 * dpr,
          spread: 64.0 * dpr,
          panelAlpha: 0.0,
          panelTopBlur: 64.0 * dpr,
          panelBottomBlur: 64.0 * dpr,
          spotLightAlpha: 0.0,
          borderAlpha1: aMul,
          color1: inversePrimaryCol,
          stroke1: 2.0 * dpr,
          topBlur1: 7.0 * dpr,
          bottomBlur1: 7.0 * dpr,
          topIntensity1: 0.2,
          bottomIntensity1: 0.2,
          borderDistSpeed1: 0.0,
          borderDistFreq1: 0.0,
          borderDistAmp1: 0.0,
          borderAlpha2: aMul,
          color2: inversePrimaryCol,
          stroke2: 3.0 * dpr,
          topBlur2: 20.0 * dpr,
          bottomBlur2: 20.0 * dpr,
          topIntensity2: 0.2,
          bottomIntensity2: 0.2,
          borderDistSpeed2: 0.0,
          borderDistFreq2: 0.0,
          borderDistAmp2: 0.0,
          dotsColor: primaryDotsCol,
          dotsAlpha: aMul,
          dotsGrid: lerp(4.5, 4.0, entryP) * dpr,
          dotsMaxRadius: lerp(0.0, 0.4, entryP),
          dotsMinRadius: -0.07,
          dotsBlurRadius: 0.3,
          dotsMoveStrength: 5.0,
          dotsInnerStroke: lerp(0.0, 10.0, entryP) * dpr,
          dotsOuterStroke: lerp(60.0, 50.0, entryP) * dpr,
          dotsWaveAmp: 0.0,
          dotsWaveFreq: 0.02,
          dotsWaveSpeed: 9.0,
          dotsYGradWeight: 0.0
        });
      }
    }

    // 3b. Suggestion Chips (SuggestionChipsKt.java & SuggestionChipConfig.java):
    //     3-stage KeyframeSequence (EffectState.ENTRY):
    //     - Stage 0 (t = 0): chipEntryConfig
    //     - Transition 1 (0 -> 800ms, LinearEasing, duration=1400ms with delay=-600ms -> starts at p=600/1400=3/7):
    //       chipEntryConfig -> chipAmbientConfig
    //     - Transition 2 (800ms -> 2000ms, LinearEasing): chipAmbientConfig -> chipCrystallizedConfig
    //     - Hold (> 2000ms): chipCrystallizedConfig (renders the crisp chip surface + subtle bottom borderLight!)
    //     NOTE: In SuggestionChipConfig.java:74,136,190,281, radialGradient is explicitly set to `null` in all configs,
    //     so EnergyShader.buildShaderSource sets `needsSpotLightFunc = false` (EnergyShader.java:201)!
    if (state.expanded && !state.isCollapsed && !state.isDraggingAOI) {
      for (const chip of state.cachedChipOffsets) {
        const age = Math.max(0, now - (chip.startTime || state.chipsCreatedAt || now));
        let spread, panelTopBlur, panelBottomBlur;
        let borderAlpha1, topBlur1, bottomBlur1, topIntensity1, bottomIntensity1;
        let dotsAlpha, dotsMaxRadius, dotsInnerStroke, dotsOuterStroke, dotsWaveAmp, dotsYGrad;

        if (age <= 800) {
          // SuggestionChipConfig.java:383: delay = -600ms, duration = 1400ms -> elapsed starts at 600ms!
          // In SuggestionChipConfig, borderLight is null in chipEntryConfig, so its initialConfig comes from
          // chipAmbientConfig with makeHidden() (alpha = 0, strokeWidth = 2dp, topBlur = 35dp, bottomBlur = 10dp,
          // topIntensity = 0.25, bottomIntensity = 0.25)!
          const p = (age + 600.0) / 1400.0;
          spread = 64.0;
          panelTopBlur = lerp(38.0, 0.0, p);
          panelBottomBlur = lerp(3.0, 0.0, p);
          borderAlpha1 = lerp(0.0, 1.0, p);
          topBlur1 = 35.0;
          bottomBlur1 = 10.0;
          topIntensity1 = 0.25;
          bottomIntensity1 = 0.25;
          dotsAlpha = lerp(1.0, 0.4, p);
          dotsMaxRadius = lerp(0.3, 0.4, p);
          dotsInnerStroke = lerp(20.0, 16.2, p);
          dotsOuterStroke = 50.0;
          dotsWaveAmp = lerp(3.0, 0.0, p);
          dotsYGrad = lerp(-0.25, -1.0, p);
        } else {
          const p = Math.min(1.0, (age - 800.0) / 1200.0);
          spread = lerp(64.0, 0.0, p);
          panelTopBlur = 0.0;
          panelBottomBlur = 0.0;
          borderAlpha1 = 1.0;
          topBlur1 = lerp(35.0, 7.0, p);
          bottomBlur1 = lerp(10.0, 35.0, p);
          topIntensity1 = lerp(0.25, 0.0, p);
          bottomIntensity1 = lerp(0.25, 0.15, p);
          dotsAlpha = lerp(0.4, 0.0, p);
          dotsMaxRadius = lerp(0.4, 0.0, p);
          dotsInnerStroke = lerp(16.2, 0.0, p);
          dotsOuterStroke = lerp(50.0, 0.0, p);
          dotsWaveAmp = 0.0;
          dotsYGrad = lerp(-1.0, 0.0, p);
        }

        let cx = state.anchorX + chip.ox + chip.w * 0.5;
        let cy = state.anchorY + chip.oy + chip.h * 0.5;
        let cw = chip.w;
        let ch = chip.h;
        let cr = 24.0;
        let alphaMul = chip.alpha ?? 1.0;

        if (state.isExiting && floatingAnchor.classList.contains('exiting-saving-draft')) {
          const s = state.exitFlightScale;
          const a = state.exitFlightAlpha;
          alphaMul *= a;
          if (s <= 0.005 || alphaMul <= 0.005) continue;
          const boxW = state.cachedAnchorW || 320;
          const boxH = state.cachedAnchorH || 140;
          const anchorCX = state.exitFlightTx + boxW * 0.5;
          const anchorCY = state.exitFlightTy + boxH * 0.5;
          const relCX = (chip.ox + chip.w * 0.5) - boxW * 0.5;
          const relCY = (chip.oy + chip.h * 0.5) - boxH * 0.5;
          cx = anchorCX + relCX * s;
          cy = anchorCY + relCY * s;
          cw = chip.w * s;
          ch = chip.h * s;
          cr = 24.0 * s;
        }

        drawEnergyShape({
          baseTimeSec: t,
          timeOffsetSec: 1500.0 + (chip.timeOffsetSec || 0.0) * 100.0,
          cx: cx * dpr,
          cy: cy * dpr,
          w: cw * dpr,
          h: ch * dpr,
          r: cr * dpr,
          spread: spread * dpr,
          panelAlpha: alphaMul,
          panelTopBlur: panelTopBlur * dpr,
          panelBottomBlur: panelBottomBlur * dpr,
          panelColor: panelCol,
          spotLightAlpha: 0.0,
          borderAlpha1: borderAlpha1 * alphaMul,
          color1: borderSurfaceCol,
          stroke1: 2.0 * dpr,
          topBlur1: topBlur1 * dpr,
          bottomBlur1: bottomBlur1 * dpr,
          topIntensity1: topIntensity1,
          bottomIntensity1: bottomIntensity1,
          borderDistSpeed1: 0.0,
          borderDistFreq1: 0.0,
          borderDistAmp1: 0.0,
          borderAlpha2: 0.0,
          color2: borderSurfaceCol,
          stroke2: 0.0,
          topBlur2: 1.0,
          bottomBlur2: 1.0,
          topIntensity2: 0.0,
          bottomIntensity2: 0.0,
          dotsColor: primaryDotsCol,
          dotsAlpha: dotsAlpha * alphaMul,
          dotsGrid: 3.0 * dpr,
          dotsMaxRadius: dotsMaxRadius,
          dotsMinRadius: -0.07,
          dotsBlurRadius: 0.3,
          dotsMoveStrength: 5.0,
          dotsInnerStroke: dotsInnerStroke * dpr,
          dotsOuterStroke: dotsOuterStroke * dpr,
          dotsWaveAmp: dotsWaveAmp * dpr,
          dotsWaveFreq: 0.02,
          dotsWaveSpeed: 9.0,
          dotsYGradWeight: dotsYGrad
        });
      }
    }

    // 3c. Page-Wide Text Selection Action Circles (Copy & Add to Gemini):
    //     Uses the exact same 3-stage SuggestionChipConfig EnergyShader as suggestion chips,
    //     rendered on 48x48dp perfect circles (r = 24dp)!
    if (state.textActionShaderCircles && state.textActionShaderCircles.length > 0) {
      for (const circle of state.textActionShaderCircles) {
        const age = Math.max(0, now - (circle.startTime || now));
        let spread, panelTopBlur, panelBottomBlur;
        let borderAlpha1, topBlur1, bottomBlur1, topIntensity1, bottomIntensity1;
        let dotsAlpha, dotsMaxRadius, dotsInnerStroke, dotsOuterStroke, dotsWaveAmp, dotsYGrad;

        if (age <= 800) {
          const p = (age + 600.0) / 1400.0;
          spread = 64.0;
          panelTopBlur = lerp(38.0, 0.0, p);
          panelBottomBlur = lerp(3.0, 0.0, p);
          borderAlpha1 = lerp(0.0, 1.0, p);
          topBlur1 = 35.0;
          bottomBlur1 = 10.0;
          topIntensity1 = 0.25;
          bottomIntensity1 = 0.25;
          dotsAlpha = lerp(1.0, 0.4, p);
          dotsMaxRadius = lerp(0.3, 0.4, p);
          dotsInnerStroke = lerp(20.0, 16.2, p);
          dotsOuterStroke = 50.0;
          dotsWaveAmp = lerp(3.0, 0.0, p);
          dotsYGrad = lerp(-0.25, -1.0, p);
        } else {
          const p = Math.min(1.0, (age - 800.0) / 1200.0);
          spread = lerp(64.0, 0.0, p);
          panelTopBlur = 0.0;
          panelBottomBlur = 0.0;
          borderAlpha1 = 1.0;
          topBlur1 = lerp(35.0, 7.0, p);
          bottomBlur1 = lerp(10.0, 35.0, p);
          topIntensity1 = lerp(0.25, 0.0, p);
          bottomIntensity1 = lerp(0.25, 0.15, p);
          dotsAlpha = lerp(0.4, 0.0, p);
          dotsMaxRadius = lerp(0.4, 0.0, p);
          dotsInnerStroke = lerp(16.2, 0.0, p);
          dotsOuterStroke = lerp(50.0, 0.0, p);
          dotsWaveAmp = 0.0;
          dotsYGrad = lerp(-1.0, 0.0, p);
        }

        const alphaMul = circle.alpha ?? 1.0;
        drawEnergyShape({
          baseTimeSec: t,
          timeOffsetSec: 1500.0 + (circle.timeOffsetSec || 0.0) * 100.0,
          cx: circle.cx * dpr,
          cy: circle.cy * dpr,
          w: circle.w * dpr,
          h: circle.h * dpr,
          r: circle.r * dpr,
          spread: spread * dpr,
          panelAlpha: alphaMul,
          panelTopBlur: panelTopBlur * dpr,
          panelBottomBlur: panelBottomBlur * dpr,
          panelColor: panelCol,
          spotLightAlpha: 0.0,
          borderAlpha1: borderAlpha1 * alphaMul,
          color1: borderSurfaceCol,
          stroke1: 2.0 * dpr,
          topBlur1: topBlur1 * dpr,
          bottomBlur1: bottomBlur1 * dpr,
          topIntensity1: topIntensity1,
          bottomIntensity1: bottomIntensity1,
          borderDistSpeed1: 0.0,
          borderDistFreq1: 0.0,
          borderDistAmp1: 0.0,
          borderAlpha2: 0.0,
          color2: borderSurfaceCol,
          stroke2: 0.0,
          topBlur2: 1.0,
          bottomBlur2: 1.0,
          topIntensity2: 0.0,
          bottomIntensity2: 0.0,
          dotsColor: primaryDotsCol,
          dotsAlpha: dotsAlpha * alphaMul,
          dotsGrid: 3.0 * dpr,
          dotsMaxRadius: dotsMaxRadius,
          dotsMinRadius: -0.07,
          dotsBlurRadius: 0.3,
          dotsMoveStrength: 5.0,
          dotsInnerStroke: dotsInnerStroke * dpr,
          dotsOuterStroke: dotsOuterStroke * dpr,
          dotsWaveAmp: dotsWaveAmp * dpr,
          dotsWaveFreq: 0.02,
          dotsWaveSpeed: 9.0,
          dotsYGradWeight: dotsYGrad
        });
      }
    }
  }

  requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ============================================================================
// 4. Cursor Position & Clamped Floating PromptBox Positioning
// ============================================================================
function setCursorType(type) {
  if (state.cursorType === type) return;
  state.cursorType = type;
  const cfg = CURSORS[type] || CURSORS.crosshair;
  customCursorImg.src = cfg.src;
  updateCustomCursorTransform();
}

function updateCustomCursorTransform() {
  const cfg = CURSORS[state.cursorType] || CURSORS.crosshair;
  customCursor.style.transform = `translate3d(${state.cursorX - cfg.hotX}px, ${state.cursorY - cfg.hotY}px, 0)`;
}

// Port of MainScreenKt.calculateClampedPromptBoxOffset
function updateFloatingPromptBoxPosition(targetCursorX, targetCursorY, snapImmediately = false) {
  if (state.isExiting || state.fanTransitioning) return;
  if ((state.isTextSelecting || state.pendingTextSelection) && !snapImmediately) return;
  if ((state.expanded && !state.isCollapsed) && !state.selectingMoreScreen && !snapImmediately) return;
  if (!snapImmediately && state.lastFollowX !== null && !state.jumpFading) {
    const dist = Math.hypot(targetCursorX - state.lastFollowX, targetCursorY - state.lastFollowY);
    if (dist > 200) {
      state.jumpFading = true;
      floatingAnchor.style.transition = 'opacity 50ms linear';
      floatingAnchor.style.opacity = '0';
      const tx = targetCursorX, ty = targetCursorY;
      setTimeout(() => {
        updateFloatingPromptBoxPosition(tx, ty, true);
        floatingAnchor.style.transition = 'opacity 150ms linear';
        floatingAnchor.style.opacity = '1';
        setTimeout(() => { floatingAnchor.style.transition = ''; state.jumpFading = false; }, 160);
      }, 55);
      state.lastFollowX = targetCursorX; state.lastFollowY = targetCursorY;
      return;
    }
  }
  state.lastFollowX = targetCursorX; state.lastFollowY = targetCursorY;

  const isSelectCursor = state.cursorType === 'select';
  const offsetX = isSelectCursor ? 20 : 10; // PROMPT_BOX_SELECT_CURSOR_X_OFFSET_DP = 20dp, PROMPT_BOX_CURSOR_X_OFFSET_DP = 10dp
  const offsetY = isSelectCursor ? 26 : 16; // PROMPT_BOX_SELECT_CURSOR_Y_OFFSET_DP = 26dp, PROMPT_BOX_CURSOR_Y_OFFSET_DP = 16dp

  state.unclampedX = targetCursorX + offsetX;
  state.unclampedY = targetCursorY + offsetY;
  clampPromptBoxToScreenBounds(snapImmediately);
}

// ============================================================================
// 5. PromptBox State Machine (Collapsed <-> Expanded, AOIs, Fan, Chips)
//    Motion values from SuggestionChipsKt / PromptBoxKt / ExpressiveMotionScheme
// ============================================================================
const CHIP_HEIGHT = 48;
const CHIP_SPACING = 8;
const CHIP_STRIDE = CHIP_HEIGHT + CHIP_SPACING;
const CHIP_ALPHA_MIN_H = 28;
const SLOW_SPATIAL = { damping: 0.8, stiffness: 200 };
const DEFAULT_SPATIAL = { damping: 0.8, stiffness: 380 };
const FAST_SPATIAL = { damping: 0.6, stiffness: 800 };
const FAST_EFFECTS = { damping: 1.0, stiffness: 3800 };

function emphasizedAccelerate(t) {
  const x1 = 0.3;
  const y1 = 0.0;
  const x2 = 0.8;
  const y2 = 0.15;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const inv = 1 - u;
    const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    const dx = 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-5) break;
    u = Math.min(1, Math.max(0, u - (x - t) / dx));
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
}

function stepSpring(value, velocity, target, dtSec, dampingRatio, stiffness) {
  const omega = Math.sqrt(stiffness);
  const gamma = dampingRatio * omega;
  const x0 = value - target;
  const v0 = velocity;
  const wd = omega * Math.sqrt(Math.max(0, 1 - dampingRatio * dampingRatio));
  const exp = Math.exp(-gamma * dtSec);
  const cos = Math.cos(wd * dtSec);
  const sin = Math.sin(wd * dtSec);
  const c2 = wd > 1e-4 ? (v0 + gamma * x0) / wd : 0;
  const x = exp * (x0 * cos + c2 * sin);
  const vel = exp * ((c2 * wd - x0 * gamma) * cos - (x0 * wd + c2 * gamma) * sin);
  return { value: target + x, velocity: vel };
}

function selectedAoiStaggerDelay(index, total) {
  if (total <= 1) return 50;
  return Math.min(index * 50, 150);
}

function addAoiButtonDelay(total) {
  if (total <= 1) return 100;
  return Math.min(selectedAoiStaggerDelay(total - 1, total) + 50, 150);
}

function syncPromptBoxMode() {
  const hasAOIs = state.selectedAOIs.length > 0;
  const hasText = state.promptText.trim().length > 0;
  const hasContent = (hasAOIs || hasText) && !state.multiAoiSelectionMode;
  // Exact condition from PromptBoxKt.java:1927:
  // showAddIcon = (!hasContent || hasUserEnteredContentBefore) && !aoiSelectionMode
  const showAddIcon = (!hasContent || state.hasUserEnteredContentBefore) && !state.aoiSelectionMode && !hasAOIs;
  const showSendIcon = hasContent;
  promptBox.classList.remove('state-collapsed','state-expanded','state-collapsed-empty','state-expanded-empty','state-expanded-content');
  if (hasContent) {
    promptBox.classList.add('state-expanded-content');
  } else if (!state.hasUserEnteredContentBefore || state.aoiSelectionMode) {
    promptBox.classList.add('state-collapsed-empty');
  } else {
    promptBox.classList.add('state-expanded-empty');
  }
  if (contentArea) contentArea.classList.toggle('hidden', !hasAOIs || state.multiAoiSelectionMode);
  if (contextControls) {
    contextControls.classList.toggle('has-add-icon', showAddIcon);
    contextControls.classList.toggle('has-send-icon', showSendIcon);
  }
  if (addBtnContainer) addBtnContainer.classList.toggle('hidden', !showAddIcon);
  if (btnSendPrompt) btnSendPrompt.classList.toggle('hidden', !(state.expanded && !state.isCollapsed && showSendIcon));
  promptInput.placeholder = state.aoiSelectionMode ? 'Point and select to ask Gemini' : 'Ask Gemini';
}

function playPromptExpandEnter() {
  promptBox.classList.remove('no-transition');
  promptBox.classList.remove('anim-expand-enter');
  void promptBox.offsetWidth;
  promptBox.classList.add('anim-expand-enter');
  setTimeout(() => promptBox.classList.remove('anim-expand-enter'), 220);
}

// ============================================================================
// 5b. Exact Snackbar & Idle Hint State Machine
//     (MainScreenStateFragmentPeer.java:458-505, MainScreenKt$MainScreen$3$1.java,
//      MainScreenKt$MainScreen$4$1.java, ScreenContextRepositoryImpl.java:834-1035,
//      SnackbarHostKt.smali:337-420 FadeInFadeOutWithScale + ExpressiveMotionSchemeImpl)
// ============================================================================
function hideSnackbar(immediate = false) {
  clearTimeout(state.snackbarHideTimer);
  state.currentSnackbarKind = null;
  state.snackbarVisible = false;
  if (immediate && bottomSnackbar) {
    state.snackbarScale = 0.8;
    state.snackbarScaleVel = 0;
    state.snackbarAlpha = 0;
    state.snackbarAlphaVel = 0;
    bottomSnackbar.classList.add('hidden');
  }
}

function showSnackbar(kind, durationMs = 4000) {
  if (!bottomSnackbar || !snackbarMessageText) return;
  clearTimeout(state.snackbarHideTimer);
  const wasHidden = bottomSnackbar.classList.contains('hidden');
  state.currentSnackbarKind = kind;

  // Reset icon state by default (ComposableSingletons$MainScreenKt.java:138-142)
  if (snackbarIcon) snackbarIcon.classList.add('hidden');
  bottomSnackbar.classList.remove('has-icon');

  if (kind === 'multi') {
    snackbarMessageText.innerHTML = 'Hold <kbd class="keycap">ctrl</kbd> to select multiple objects';
  } else if (kind === 'char-limit') {
    // PromptBoxStateFragmentPeer.java:210: showCharacterLimitSnackbar() -> "Only the first 1,000 characters are accepted"
    const formattedLimit = (1000).toLocaleString();
    snackbarMessageText.textContent = `Only the first ${formattedLimit} characters are accepted`;
  } else if (kind === 'offline') {
    // ErrorsKt.java:156: showConnectivityError() -> gs_wifi_off_rond100_vd_theme_24 + "Check your internet connection and try again"
    if (snackbarIcon) {
      snackbarIcon.src = 'extracted_assets/svg/gs_wifi_off_rond100_vd_theme_24.svg';
      snackbarIcon.classList.remove('hidden');
    }
    bottomSnackbar.classList.add('has-icon');
    snackbarMessageText.textContent = 'Check your internet connection and try again';
  } else {
    snackbarMessageText.innerHTML = 'Press <kbd class="keycap">esc</kbd> to exit';
  }
  if (wasHidden) {
    // SnackbarHostKt.smali:3565 & 3300: initial state when entering is scale = 0.8f, alpha = 0.0f
    state.snackbarScale = 0.8;
    state.snackbarScaleVel = 0;
    state.snackbarAlpha = 0;
    state.snackbarAlphaVel = 0;
    bottomSnackbar.style.opacity = '0';
    bottomSnackbar.style.transform = 'translateX(-50%) scale(0.8)';
    bottomSnackbar.classList.remove('hidden');
  }
  state.snackbarVisible = true;
  if (durationMs > 0) {
    state.snackbarHideTimer = setTimeout(() => {
      if (state.currentSnackbarKind === kind) {
        hideSnackbar(false);
      }
    }, durationMs);
  }
}

function tickSnackbarMotion(dtMs) {
  if (!bottomSnackbar || bottomSnackbar.classList.contains('hidden')) return;
  const dt = Math.min(0.05, dtMs / 1000);
  const targetScale = state.snackbarVisible ? 1.0 : 0.8;
  const targetAlpha = state.snackbarVisible ? 1.0 : 0.0;

  // SnackbarHostKt.animatedScale uses MotionSchemeKeyTokens.FastSpatial (damping=0.6, stiffness=800)
  const sc = stepSpring(state.snackbarScale, state.snackbarScaleVel, targetScale, dt, FAST_SPATIAL.damping, FAST_SPATIAL.stiffness);
  state.snackbarScale = sc.value;
  state.snackbarScaleVel = sc.velocity;

  // SnackbarHostKt.animatedOpacity uses MotionSchemeKeyTokens.FastEffects (damping=1.0, stiffness=3800)
  const op = stepSpring(state.snackbarAlpha, state.snackbarAlphaVel, targetAlpha, dt, FAST_EFFECTS.damping, FAST_EFFECTS.stiffness);
  state.snackbarAlpha = Math.max(0, Math.min(1, op.value));
  state.snackbarAlphaVel = op.velocity;

  bottomSnackbar.style.opacity = state.snackbarAlpha.toFixed(3);
  bottomSnackbar.style.transform = `translateX(-50%) scale(${state.snackbarScale.toFixed(4)})`;

  // SnackbarHostKt$animatedOpacity$2$1.smali:295: onAnimationFinish removes item when fade-out completes
  if (!state.snackbarVisible && state.snackbarAlpha < 0.01 && Math.abs(state.snackbarScale - 0.8) < 0.02) {
    bottomSnackbar.classList.add('hidden');
  }
}

function setSnackbarMessage(kind) {
  // MainScreenKt$MainScreen$4$1.java:53-60:
  // If multiAoiSelectionMode || !aoiSelectionMode, dismiss multi-select toast if currently shown
  if (state.multiAoiSelectionMode || !state.aoiSelectionMode) {
    if (state.currentSnackbarKind === 'multi') {
      hideSnackbar();
    }
  }
}

function triggerMultiSelectSnackbarIfEligible() {
  // ScreenContextRepositoryImpl.java:834-965:
  // When updateAoiSelectionMode(true) is called while selectedAOIs is not empty,
  // if !hasShown && !hasPressedCtrl -> mark hasShown = true and show multi_select_toast_message
  if (
    state.aoiSelectionMode &&
    state.selectedAOIs.length > 0 &&
    !state.hasShownMultiSelectSnackbar &&
    !state.hasPressedCtrlMultiSelect
  ) {
    state.hasShownMultiSelectSnackbar = true;
    showSnackbar('multi', 4000);
  }
}

function syncIdleExitHintTimer() {
  // MainScreenStateFragmentPeer$isInitialStateFlow$1.java & MainScreenStateFragmentPeer.java:450-505:
  // isInitialState = aoiSelectionMode && selectedAOIs.isEmpty() && userPrompt.isBlank() && !hasUserInteracted
  const isInitialState =
    state.active &&
    state.aoiSelectionMode &&
    state.selectedAOIs.length === 0 &&
    state.promptText.trim().length === 0 &&
    !state.hasUserInteractedInSession;

  if (!isInitialState) {
    clearTimeout(state.idleHintTimer);
    state.idleHintTimer = null;
    if (state.currentSnackbarKind === 'exit') {
      hideSnackbar();
    }
  } else if (!state.hasShownIdleExitHintInSession && !state.idleHintTimer) {
    state.idleHintTimer = setTimeout(() => {
      state.idleHintTimer = null;
      if (
        state.active &&
        state.aoiSelectionMode &&
        state.selectedAOIs.length === 0 &&
        state.promptText.trim().length === 0 &&
        !state.hasUserInteractedInSession
      ) {
        state.hasShownIdleExitHintInSession = true;
        showSnackbar('exit', 4000); // SnackbarDuration.Short = 4000ms
      }
    }, 3000); // DelayKt.delay(3000L) in MainScreenStateFragmentPeer.java:492
  }
}

function onUserInteraction() {
  // MainScreenKt.java:55586: $peer.onUserInteraction(); currentSnackbarData?.dismiss()
  state.hasUserInteractedInSession = true;
  clearTimeout(state.idleHintTimer);
  state.idleHintTimer = null;
  hideSnackbar();
}

// ============================================================================
// 5c. Exact ShakeInterventionController & ShakeInterventionRepository
//     (ShakeInterventionController.java, ShakeInterventionRepository.java,
//      UiFlagsImpl$FeatureModule.smali:190-211)
// ============================================================================
const SHAKE_MISTRIGGER_WINDOW_MS = 2000;      // flag 45789378 = 0x7d0 (2000ms)
const SHAKE_INTERVENTION_WINDOW_MS = 60000;   // flag 45789379 = 0xea60 (60000ms)
const SHAKE_TRIGGER_COUNT_THRESHOLD = 3;      // flag 45787409 = 3
const SHAKE_COOLDOWN_WINDOW_MS = 21600000;    // COOLDOWN_WINDOW_MILLIS = 6 hours

function recordShakeTrigger() {
  state.lastShakeTriggerMs = Date.now();
}

function shouldShowShakeInterventionNow() {
  const now = Date.now();
  if (
    state.lastShakeInterventionShownMs > 0 &&
    now >= state.lastShakeInterventionShownMs &&
    now - state.lastShakeInterventionShownMs < SHAKE_COOLDOWN_WINDOW_MS
  ) {
    return false;
  }
  const cutoff = now - SHAKE_INTERVENTION_WINDOW_MS;
  state.mistriggerTimestampsMs = state.mistriggerTimestampsMs.filter((t) => t >= cutoff);
  const activeTriggerCount = state.lastShakeTriggerMs > 0 ? 1 : 0;
  const totalCount = state.mistriggerTimestampsMs.length + activeTriggerCount;
  return totalCount >= SHAKE_TRIGGER_COUNT_THRESHOLD;
}

function recordShakeInterventionShown() {
  state.mistriggerTimestampsMs = [];
  state.lastShakeTriggerMs = 0;
  state.lastShakeInterventionShownMs = Date.now();
}

function recordShakeDismissOnFinish() {
  // MainActivityPeer.java:1405-1411 & MainActivityPeer$finishActivity$2$1.java:46-48:
  // Called in finishActivity() when entryPoint == CURSOR_SHAKE
  if (state.entrySource !== 'shake') return;
  const now = Date.now();
  const cutoff = now - SHAKE_INTERVENTION_WINDOW_MS;
  state.mistriggerTimestampsMs = state.mistriggerTimestampsMs.filter((t) => t >= cutoff);
  const userInteracted = state.selectedAOIs.length > 0 || state.promptText.trim().length > 0;
  const lastTrigger = state.lastShakeTriggerMs;
  if (!userInteracted && lastTrigger > 0 && now >= lastTrigger && now - lastTrigger <= SHAKE_MISTRIGGER_WINDOW_MS) {
    state.mistriggerTimestampsMs.push(now);
  }
  state.lastShakeTriggerMs = 0;
}

function clearSuggestionChips() {
  state.lastRenderedSuggestionsSig = '';
  state.chipMotions = [];
  state.cachedChipOffsets = [];
  suggestionChipsContainer.innerHTML = '';
  suggestionChipsContainer.style.height = '0px';
  suggestionChipsContainer.style.width = '0px';
  suggestionChipsContainer.classList.add('hidden');
}

function beginChipExit() {
  const now = performance.now();
  if (!state.chipMotions.length) {
    clearSuggestionChips();
    return;
  }
  const gen = state.chipGeneration;
  for (const motion of state.chipMotions) {
    motion.exiting = true;
    motion.exitStart = now;
    motion.exitFromY = motion.transY;
    motion.exitFromAlpha = motion.alpha;
  }
  setTimeout(() => {
    if (state.expanded || state.chipGeneration !== gen) return;
    clearSuggestionChips();
  }, 150);
}

function applyChipMotion(motion) {
  motion.el.style.opacity = String(motion.alpha);
  motion.el.style.transform = `translate3d(0px, ${motion.transY.toFixed(2)}px, 0) scaleY(${motion.scaleY.toFixed(4)})`;
  const visualH = motion.scaleY * CHIP_HEIGHT;
  let textAlpha = 0;
  if (visualH >= CHIP_HEIGHT) textAlpha = 1;
  else if (visualH > CHIP_ALPHA_MIN_H) textAlpha = (visualH - CHIP_ALPHA_MIN_H) / (CHIP_HEIGHT - CHIP_ALPHA_MIN_H);
  motion.contentEl.style.opacity = String(textAlpha);
}

function tickChipMotions(dtMs, now) {
  const motions = state.chipMotions;
  if (!motions.length) return;
  const dt = Math.min(0.05, dtMs / 1000);
  const glow = [];
  for (let i = 0; i < motions.length; i++) {
    const motion = motions[i];
    if (motion.exiting) {
      const p = Math.min(1, (now - motion.exitStart) / 150);
      motion.transY = motion.exitFromY * (1 - emphasizedAccelerate(p));
      const fadeP = Math.min(1, (now - motion.exitStart) / 100);
      motion.alpha = motion.exitFromAlpha * (1 - fadeP);
    } else if (now < motion.delayUntil) {
      motion.alpha = 0;
      motion.scaleY = 0.25;
    } else {
      if (!motion.started) {
        motion.started = true;
        motion.scaleY = 0.25;
        motion.scaleYVel = 0;
        motion.alpha = 0;
        motion.alphaFromTime = now;
        if (i === 0) {
          motion.transY = -CHIP_SPACING;
        } else {
          const prev = motions[i - 1];
          motion.transY = prev.transY + prev.scaleY * CHIP_HEIGHT;
        }
        motion.transVel = 0;
      }
      const scale = stepSpring(motion.scaleY, motion.scaleYVel, 1, dt, SLOW_SPATIAL.damping, SLOW_SPATIAL.stiffness);
      motion.scaleY = scale.value;
      motion.scaleYVel = scale.velocity;
      const slide = stepSpring(motion.transY, motion.transVel, i * CHIP_STRIDE, dt, DEFAULT_SPATIAL.damping, DEFAULT_SPATIAL.stiffness);
      motion.transY = slide.value;
      motion.transVel = slide.velocity;
      motion.alpha = Math.min(1, (now - motion.alphaFromTime) / 50);
    }
    applyChipMotion(motion);
    if (motion.alpha > 0.04) {
      const pbH = promptBox.offsetHeight || state.cachedPbH || 52;
      motion.ox = 0;
      motion.oy = pbH + 8; // PROMPT_BOX_SUGGESTION_CHIPS_SPACING = 8dp
      glow.push({
        ox: motion.ox,
        oy: motion.oy + motion.transY,
        w: motion.w,
        h: Math.max(4, CHIP_HEIGHT * motion.scaleY),
        alpha: motion.alpha,
        startTime: motion.alphaFromTime,
        timeOffsetSec: motion.timeOffsetSec || 0.0
      });
    }
  }
  state.cachedChipOffsets = glow;
}

// ============================================================================
// 5d. Page-Wide Text Selection Action Circles (Copy & Add to Gemini)
//     - 48dp x 48dp perfect circles backed by SuggestionChipConfig EnergyShader
//     - Smartly placed side-by-side (8dp gap) either below or to the right of the selection
//     - Smooth spring/fade-in entry and 150ms fade-out exit
// ============================================================================
const COPY_ICON_PATH_DEFAULT = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
const COPY_ICON_PATH_CHECK = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

function clearTextSelectionActionsImmediate() {
  const hadPending = !!state.pendingTextSelection;
  state.pendingTextSelection = null;
  state.textActionCircles = [];
  state.textActionShaderCircles = [];
  if (textSelectionActionsEl) {
    textSelectionActionsEl.classList.add('hidden');
  }
  if (iconTextSelCopy) {
    const p = iconTextSelCopy.querySelector('path');
    if (p) p.setAttribute('d', COPY_ICON_PATH_DEFAULT);
  }
  if (hadPending && !state.isDraggingAOI && !state.isTextSelecting) {
    floatingAnchor.classList.remove('dragging-active');
    updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, true);
  }
  state.scrimDirty = true;
}

function dismissTextSelectionActions(animated = true, onDone = null) {
  if (!state.textActionCircles.length) {
    clearTextSelectionActionsImmediate();
    if (onDone) onDone();
    return;
  }
  if (!animated) {
    clearTextSelectionActionsImmediate();
    if (onDone) onDone();
    return;
  }
  const now = performance.now();
  for (const c of state.textActionCircles) {
    if (!c.exiting) {
      c.exiting = true;
      c.exitStart = now;
      c.exitFromScale = c.scale;
      c.exitFromAlpha = c.alpha;
    }
  }
  setTimeout(() => {
    clearTextSelectionActionsImmediate();
    if (onDone) onDone();
  }, 150);
}

function showTextSelectionActions(selectionObj) {
  if (!selectionObj || !selectionObj.rect || !selectionObj.text || !textSelectionActionsEl) return;
  const now = performance.now();
  state.pendingTextSelection = { ...selectionObj, createdAt: now };
  state.scrimDirty = true;

  if (iconTextSelCopy) {
    const p = iconTextSelCopy.querySelector('path');
    if (p) p.setAttribute('d', COPY_ICON_PATH_DEFAULT);
  }

  const r = selectionObj.rect;
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const margin = 16;
  const gap = 8;
  const circleSize = 48;
  const groupW = circleSize * 2 + gap; // 104px
  const groupH = circleSize;           // 48px
  // Card visual border has 8px padding outside `r`
  const cardRight = r.x + r.width + 8;
  const cardBottom = r.y + r.height + 8;
  const cardTop = r.y - 8;

  const spaceBelow = screenH - margin - cardBottom;
  const spaceRight = screenW - margin - cardRight;

  let groupX, groupY;
  // Smartly place either below the selected text or to the right of the selected text based on available space
  if (spaceBelow >= groupH + 14 || spaceRight < groupW + 14) {
    if (spaceBelow >= groupH + 14) {
      // Below the selected text, right-aligned with the selection (or clamped within screen bounds)
      groupX = Math.max(margin, Math.min(r.x + r.width - groupW, screenW - margin - groupW));
      groupY = Math.min(screenH - margin - groupH, cardBottom + 12);
    } else if (cardTop - margin >= groupH + 14) {
      // Above the selected text if near bottom of screen and no room on right
      groupX = Math.max(margin, Math.min(r.x + r.width - groupW, screenW - margin - groupW));
      groupY = Math.max(margin, cardTop - 12 - groupH);
    } else {
      groupX = Math.max(margin, Math.min(r.x + r.width - groupW, screenW - margin - groupW));
      groupY = Math.max(margin, Math.min(cardBottom - groupH - 8, screenH - margin - groupH));
    }
  } else {
    // To the right of the selected text, vertically aligned with the bottom of the selection
    groupX = Math.min(screenW - margin - groupW, cardRight + 12);
    groupY = Math.max(margin, Math.min(r.y + r.height - groupH, screenH - margin - groupH));
  }

  textSelectionActionsEl.style.transform = `translate3d(${groupX.toFixed(1)}px, ${groupY.toFixed(1)}px, 0)`;
  textSelectionActionsEl.classList.remove('hidden');

  // Point 1: First let the rectangular AoiCard shader play its in-animation (starting at t=0),
  // and then stagger the Copy & Plus circles in right after (starting at +180ms)!
  const btns = [btnTextSelCopy, btnTextSelAdd];
  state.textActionCircles = btns.map((btn, i) => {
    const contentEl = btn.querySelector('.text-sel-circle-content');
    btn.style.opacity = '0';
    btn.style.transform = 'scale(0.25)';
    if (contentEl) contentEl.style.opacity = '0';
    return {
      el: btn,
      contentEl,
      index: i,
      baseX: groupX + i * (circleSize + gap),
      baseY: groupY,
      size: circleSize,
      delayUntil: now + 180 + i * 50,
      started: false,
      exiting: false,
      scale: 0.25,
      scaleVel: 0,
      alpha: 0,
      alphaFromTime: now + 180 + i * 50,
      timeOffsetSec: ((i * 4.13 + Math.random() * 5.87) % 10.0)
    };
  });

  // Point 2: Keep the PromptBox hidden while the Copy & Plus circles are waiting to be clicked!
  floatingAnchor.classList.add('dragging-active');
}

function tickTextActionCircles(dtMs, now) {
  const circles = state.textActionCircles;
  if (!circles || !circles.length) {
    state.textActionShaderCircles = [];
    return;
  }
  const dt = Math.min(0.05, dtMs / 1000);
  const shaderList = [];
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    if (c.exiting) {
      const p = Math.min(1, (now - c.exitStart) / 150);
      const easeP = emphasizedAccelerate(p);
      c.scale = c.exitFromScale * (1 - 0.75 * easeP);
      const fadeP = Math.min(1, (now - c.exitStart) / 120);
      c.alpha = c.exitFromAlpha * (1 - fadeP);
    } else if (now < c.delayUntil) {
      c.alpha = 0;
      c.scale = 0.25;
    } else {
      if (!c.started) {
        c.started = true;
        c.scale = 0.25;
        c.scaleVel = 0;
        c.alpha = 0;
        c.alphaFromTime = now;
      }
      const sp = stepSpring(c.scale, c.scaleVel, 1, dt, SLOW_SPATIAL.damping, SLOW_SPATIAL.stiffness);
      c.scale = sp.value;
      c.scaleVel = sp.velocity;
      c.alpha = Math.min(1, (now - c.alphaFromTime) / 90);
    }

    if (c.el) {
      c.el.style.opacity = String(c.alpha);
      c.el.style.transform = `scale(${c.scale.toFixed(4)})`;
    }
    if (c.contentEl) {
      const visualD = c.scale * c.size;
      let iconAlpha = 0;
      if (visualD >= c.size) iconAlpha = 1;
      else if (visualD > CHIP_ALPHA_MIN_H) iconAlpha = (visualD - CHIP_ALPHA_MIN_H) / (c.size - CHIP_ALPHA_MIN_H);
      c.contentEl.style.opacity = String(iconAlpha * c.alpha);
    }

    if (c.alpha > 0.03) {
      const curSize = Math.max(8, c.size * c.scale);
      shaderList.push({
        cx: c.baseX + c.size * 0.5,
        cy: c.baseY + c.size * 0.5,
        w: curSize,
        h: curSize,
        r: curSize * 0.5,
        alpha: c.alpha,
        startTime: c.alphaFromTime,
        timeOffsetSec: c.timeOffsetSec || 0.0
      });
    }
  }
  state.textActionShaderCircles = shaderList;
}

function setExpandedState(expanded, opts = {}) {
  const wasExpanded = state.expanded;
  if (expanded) {
    state.aoiSelectionMode = false;
    state.selectingMoreScreen = false;
    setSnackbarMessage();
    syncIdleExitHintTimer();
    updateHoveredAoiForCursor(state.cursorX, state.cursorY);
    // Fan -> Expanded: fan exits 100ms (scale .9/fade), then Expanded scales 0.8->1 over 200ms
    if (state.isCollapsed && !opts.skipFanAnim) {
      if (state.fanTransitioning) return;
      state.fanTransitioning = true;
      aoiThumbnailFan.classList.add('exiting');
      setTimeout(() => {
        state.isCollapsed = false;
        state.fanTransitioning = false;
        aoiThumbnailFan.classList.add('hidden');
        aoiThumbnailFan.classList.remove('exiting');
        expandedStateWrapper.classList.remove('hidden','collapsing-to-fan');
        state.expanded = true;
        // Disable width/height CSS transitions during mount so refreshCachedLayoutMetrics()
        // measures the exact final expanded width/height immediately on frame 0!
        promptBox.classList.add('no-transition');
        syncPromptBoxMode();
        renderSelectedAOIsAndChips();
        refreshCachedLayoutMetrics();
        expandedStateWrapper.classList.remove('expanding-from-fan');
        void expandedStateWrapper.offsetWidth;
        promptBox.classList.remove('no-transition');
        expandedStateWrapper.classList.add('expanding-from-fan');
        setTimeout(() => expandedStateWrapper.classList.remove('expanding-from-fan'), 210);
        requestAnimationFrame(() => {
      refreshCachedLayoutMetrics();
      if (api.focusOverlay) api.focusOverlay();
      promptInput.focus();
    });
        setTimeout(refreshCachedLayoutMetrics, 220);
      }, 100);
      return;
    }
    state.expanded = true;
    state.isCollapsed = false;
    aoiThumbnailFan.classList.add('hidden');
    expandedStateWrapper.classList.remove('hidden','collapsing-to-fan');
    if (!wasExpanded) {
      // Snap to final expanded width/height before playing the scale(0.8 -> 1.0) entry animation
      // so the box appears in-place at its clamped coordinate without sliding!
      promptBox.classList.add('no-transition');
      syncPromptBoxMode();
      renderSelectedAOIsAndChips();
      refreshCachedLayoutMetrics();
      void promptBox.offsetWidth;
      playPromptExpandEnter();
    } else {
      syncPromptBoxMode();
      renderSelectedAOIsAndChips();
      refreshCachedLayoutMetrics();
    }
    requestAnimationFrame(() => {
      refreshCachedLayoutMetrics();
      if (api.focusOverlay) api.focusOverlay();
      promptInput.focus();
    });
    setTimeout(refreshCachedLayoutMetrics, 220);
  } else {
    state.expanded = false;
    state.aoiSelectionMode = true;
    setCursorType('crosshair');
    updateHoveredAoiForCursor(state.cursorX, state.cursorY);
    triggerMultiSelectSnackbarIfEligible();
    syncIdleExitHintTimer();
    // Expanded -> Fan ONLY when we already have AOIs (collapse-and-save / add-more / Ctrl)
    if (state.selectedAOIs.length > 0 && (opts.toFan || state.selectingMoreScreen || opts.collapseSave)) {
      if (state.fanTransitioning) return;
      state.fanTransitioning = true;
      expandedStateWrapper.classList.add('collapsing-to-fan');
      setTimeout(() => {
        state.fanTransitioning = false;
        state.isCollapsed = true;
        expandedStateWrapper.classList.add('hidden');
        expandedStateWrapper.classList.remove('collapsing-to-fan');
        clearSuggestionChips();
        syncPromptBoxMode();
        renderCollapsedThumbnailFan();
        refreshCachedLayoutMetrics();
        updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, true);
      }, 100);
    } else {
      state.isCollapsed = false;
      aoiThumbnailFan.classList.add('hidden');
      expandedStateWrapper.classList.remove('hidden','collapsing-to-fan');
      syncPromptBoxMode();
      if (wasExpanded) beginChipExit(); else clearSuggestionChips();
    }
    updateSendButtonVisibility();
    requestAnimationFrame(refreshCachedLayoutMetrics);
    setTimeout(refreshCachedLayoutMetrics, 220);
  }
  state.scrimDirty = true;
}

function renderCollapsedThumbnailFan() {
  const count = state.selectedAOIs.length;
  if (!state.isCollapsed || count === 0) {
    aoiThumbnailFan.classList.add('hidden');
    aoiThumbnailFan.innerHTML = '';
    return;
  }
  aoiThumbnailFan.classList.remove('hidden');
  aoiThumbnailFan.innerHTML = '';
  const visible = state.selectedAOIs.slice(-3);
  const n = visible.length;
  // Exact port of AoiThumbnailFanKt.java:
  // Outer Box has Modifier.padding(8.dp) and contentAlignment = Alignment.TopStart!
  // Every thumbnail is placed at top-left (8px, 8px) and offset by:
  // - 1 item (AoiFanOneThumbnail:885): Middle (44dp) at offset(0dp, 0dp), rot = 0deg
  // - 2 items (AoiFanTwoThumbnails:957-958 & 1243-1271):
  //     selectedAoi1 = Middle (44dp) at offset(0dp, 1dp), rot = 0deg
  //     selectedAoi2 = Front (48dp) at offset(-16dp, 0dp), rot = -8deg (AOI_THUMBNAIL_FAN_THUMBNAIL_X_OFFSET = 16dp!)
  // - 3 items (AoiFanThreeThumbnails:1441-1444 & 2063-2093):
  //     selectedAoi1 = Back (40dp) at offset(+16dp, 4dp), rot = +8deg
  //     selectedAoi2 = Middle (44dp) at offset(0dp, 1dp), rot = 0deg
  //     selectedAoi3 = Front (48dp) at offset(-16dp, 0dp), rot = -8deg
  const place = (card, dx, dy, rot) => {
    card.style.left = '8px';
    card.style.top = '8px';
    card.style.transform = `translate3d(0px, ${dy}px, 0) rotate(0deg)`;
    card.dataset.targetTransform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg)`;
  };
  visible.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'fan-card';
    if (n === 1) { card.classList.add('pos-middle'); place(card, 0, 0, 0); }
    else if (n === 2) {
      if (idx === 0) { card.classList.add('pos-middle'); place(card, 0, 1, 0); }
      else { card.classList.add('pos-front'); place(card, -16, 0, -8); }
    } else {
      if (idx === 0) { card.classList.add('pos-back'); place(card, 16, 4, 8); }
      else if (idx === 1) { card.classList.add('pos-middle'); place(card, 0, 1, 0); }
      else { card.classList.add('pos-front'); place(card, -16, 0, -8); }
    }
    if (item.dataUrl) {
      const img = document.createElement('img'); img.src = item.dataUrl; card.appendChild(img);
    } else {
      const badge = document.createElement('div'); badge.className = 'aoi-file-badge'; badge.textContent = item.fileName || 'File'; card.appendChild(badge);
    }
    aoiThumbnailFan.appendChild(card);
  });
  // FanVisualState.Entering -> FanVisualState.Visible (100ms STANDARD_EASING = cubic-bezier(0.2, 0, 0, 1))
  requestAnimationFrame(() => {
    aoiThumbnailFan.querySelectorAll('.fan-card').forEach((card) => {
      if (card.dataset.targetTransform) {
        card.style.transform = card.dataset.targetTransform;
      }
    });
  });
}

function renderScreenAOICards() {
  state.scrimDirty = true;
  // Redraw scrimCanvas synchronously so removing or updating DOM children inside aoiCardsLayer
  // NEVER causes a 1-frame transparent flicker in Chromium's compositor!
  redrawScrimCanvas();
  aoiCardsLayer.innerHTML = '';
  const screenAOIs = state.selectedAOIs.filter((a) => a.type === 'screen' && a.rect);
  screenAOIs.forEach((aoi, idx) => {
    const div = document.createElement('div');
    div.className = 'aoi-screen-card';
    div.style.left = `${aoi.rect.x}px`;
    div.style.top = `${aoi.rect.y}px`;
    div.style.width = `${aoi.rect.width}px`;
    div.style.height = `${aoi.rect.height}px`;

    aoiCardsLayer.appendChild(div);
  });
}

function renderSelectedAOIsAndChips(opts = {}) {
  renderScreenAOICards();

  if (!state.expanded) {
    renderCollapsedThumbnailFan();
    requestAnimationFrame(refreshCachedLayoutMetrics);
    return;
  }

  // Record previous bounding boxes of existing tiles + AddAoiThumbnail relative to #selected-aois-display
  // BEFORE DOM update so we can apply PromptBoxKt.createRowChangeBoundsTransform (PromptBoxKt.java:2196-2231)
  // only when an actual tile is deleted/reordered (never when initially expanding the PromptBox from 0.8 -> 1.0 scale)!
  const shouldAnimateTileReflow = opts && opts.animateReflow === true;
  const oldBounds = new Map();
  if (shouldAnimateTileReflow) {
    if (aoiThumbnailsList) {
      aoiThumbnailsList.querySelectorAll('.aoi-thumbnail-item[data-aoi-id]').forEach((el) => {
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          oldBounds.set(el.dataset.aoiId, { left: el.offsetLeft, top: el.offsetTop });
        }
      });
    }
    const addWrapEl0 = document.getElementById('add-aoi-tile-wrapper');
    if (addWrapEl0 && !addWrapEl0.classList.contains('hidden')) {
      if (addWrapEl0.offsetWidth > 0 && addWrapEl0.offsetHeight > 0) {
        oldBounds.set('__add_aoi_btn__', { left: addWrapEl0.offsetLeft, top: addWrapEl0.offsetTop });
      }
    }
  }
  const addWrapEl = document.getElementById('add-aoi-tile-wrapper');

  if (state.selectedAOIs.length > 0) {
    aoiThumbnailsList.innerHTML = '';

    const total = state.selectedAOIs.length;
    state.selectedAOIs.forEach((item, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'aoi-thumbnail-item';
      thumb.dataset.aoiId = item.id;
      if (state.seenAoiIds.has(item.id)) {
        thumb.style.animation = 'none';
      } else {
        thumb.style.animationDelay = `${selectedAoiStaggerDelay(index, total)}ms`;
        state.seenAoiIds.add(item.id);
      }

      if (item.dataUrl) {
        const img = document.createElement('img');
        img.decoding = 'sync';
        img.src = item.dataUrl;
        thumb.appendChild(img);
      } else {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'aoi-file-badge';
        fileDiv.textContent = item.fileName || 'Attached file';
        thumb.appendChild(fileDiv);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'aoi-remove-btn';
      removeBtn.setAttribute('aria-label', 'Remove');
      const rmIcon = document.createElement('img');
      rmIcon.src = 'extracted_assets/svg/gs_close_wght500rond100_18.svg';
      rmIcon.className = 'icon-svg';
      rmIcon.style.width = '14px';
      rmIcon.style.height = '14px';
      removeBtn.appendChild(rmIcon);

      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (thumb.classList.contains('deleting')) return;
        thumb.classList.add('deleting');
        // PromptBoxStateFragmentPeer.java:1045: removeSelectedAOI immediately calls clearSuggestions()!
        clearSuggestionChips();
        const id = item.id;
        setTimeout(() => {
          state.selectedAOIs = state.selectedAOIs.filter((a) => a.id !== id);
          state.seenAoiIds.delete(id);
          // PromptBoxKt.java:1927: deleting an AOI sets hasUserEnteredContentBefore = true so if 0 AOIs remain,
          // the PromptBox stays in expanded-empty mode (260dp with the inline + icon) and does NOT show suggestions!
          state.hasUserEnteredContentBefore = true;
          renderSelectedAOIsAndChips({ animateReflow: true });
          updateSendButtonVisibility();
          setSnackbarMessage(state.selectedAOIs.length === 1 ? 'multi' : 'exit');
        }, 100);
      });

      thumb.appendChild(removeBtn);
      aoiThumbnailsList.appendChild(thumb);
    });

    const addWrap = document.getElementById('add-aoi-tile-wrapper');
    if (addWrap) {
      addWrap.classList.toggle('hidden', state.selectedAOIs.length >= 10);
      if (state.seenAoiIds.has('__add_aoi_btn__')) {
        addWrap.style.animation = 'none';
      } else {
        addWrap.style.animationDelay = `${addAoiButtonDelay(state.selectedAOIs.length)}ms`;
        state.seenAoiIds.add('__add_aoi_btn__');
      }
    }
  }

  syncPromptBoxMode();

  // Apply PromptBoxKt.createRowChangeBoundsTransform (PromptBoxKt.java:2205-2231):
  // - If |startBounds.top - targetBounds.top| > 20px (row changed):
  //   hold at startBounds for 100ms while fading alpha 1 -> 0 (100ms Linear),
  //   then jump to targetBounds at 101ms and fade alpha 0 -> 1 over 250ms (350ms total)!
  // - Otherwise (same row): animate bounds smoothly over 250ms CROS_STANDARD_EASING!
  if (oldBounds.size > 0 && state.selectedAOIs.length > 0) {
    const animateTileReflow = (el, prev) => {
      if (!el || !prev) return;
      const dx = prev.left - el.offsetLeft;
      const dy = prev.top - el.offsetTop;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const rowChanged = Math.abs(dy) > 20;
      if (!rowChanged) {
        el.animate(
          [
            { transform: `translate3d(${dx}px, ${dy}px, 0)` },
            { transform: 'translate3d(0px, 0px, 0)' }
          ],
          { duration: 250, easing: 'cubic-bezier(0.4, 0.0, 0.0, 0.97)' }
        );
      } else {
        el.animate(
          [
            { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: 1, offset: 0 },
            { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: 0, offset: 100 / 350 },
            { transform: 'translate3d(0px, 0px, 0)', opacity: 0, offset: 101 / 350 },
            { transform: 'translate3d(0px, 0px, 0)', opacity: 1, offset: 1 }
          ],
          { duration: 350, easing: 'linear' }
        );
      }
    };
    aoiThumbnailsList.querySelectorAll('.aoi-thumbnail-item[data-aoi-id]').forEach((el) => {
      animateTileReflow(el, oldBounds.get(el.dataset.aoiId));
    });
    if (addWrapEl && !addWrapEl.classList.contains('hidden')) {
      animateTileReflow(addWrapEl, oldBounds.get('__add_aoi_btn__'));
    }
  }

  setSnackbarMessage(state.selectedAOIs.length === 1 ? 'multi' : 'exit');
  renderSuggestionChips();
  updateSendButtonVisibility();
  requestAnimationFrame(refreshCachedLayoutMetrics);
}

// ============================================================================
// 5d. MagicCueImpl Entity Classifier (Bundled) + Optional On-Device Suggestion LLM
//     Exact port of MagicCueImpl.java, LlmProcessorServiceImpl.java,
//     Suggestion.java (Suggestion.MagicCue vs Suggestion.Gemini), and
//     PromptBoxStateFragmentPeer.java (lines 96-97, 519-537, 590-641):
//     - MagicCue (1.2 MB entity classifier) is bundled with the app and active by default!
//     - Optional Lightweight Suggestion LLM (~92 MB LaMini-Flan-T5-77M int8 ONNX):
//       when downloaded & enabled, generates AI suggestion chips in `llm_worker.js`;
//       when not downloaded (or while inferring), displays the default hardcoded suggestions!
// ============================================================================
let llmWorker = null;
let llmReqCounter = 0;

function getOrCreateLlmWorker() {
  if (llmWorker) return llmWorker;
  try {
    llmWorker = new Worker('llm_worker.js', { type: 'module' });
    llmWorker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'suggestions_ready' && Array.isArray(msg.chips) && msg.chips.length > 0) {
        if (state.inflightLlmKey === msg.reqId) {
          state.inflightLlmKey = null;
        }
        state.llmChipsCache.set(msg.reqId, msg.chips);
        if (state.active && state.expanded && !state.isCollapsed && state.currentLlmCacheKey === msg.reqId) {
          renderSuggestionChips();
        }
      }
    };
  } catch (err) {
    console.warn('LLM Worker creation warning:', err);
  }
  return llmWorker;
}

const MAGIC_CUE_ICONS = {
  email: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`,
  maps: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>`,
  flight: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>`
};

function getMagicCueSuggestionsForOcrText(rawText) {
  // Bundled MagicCue entity classifier (enabled by default; can be toggled in Tray)
  // Exact port of MagicCueImpl.java + TextClassifier RemoteActions (email, url, address, datetime, flight, phone)
  if (!state.magicCueEnabled) return [];
  const text = (rawText || '').trim();
  if (!text) return [];

  // Normalize common WinRT OCR spacing/character artifacts in URLs & emails:
  // - spaces around "://", "www.", "@", "/", and ".tld"
  const TLDS = 'com|org|net|edu|gov|mil|io|dev|ai|co|app|me|gg|tv|xyz|info|biz|tech|cloud|page|site|store|online|live|pro|design|studio|us|uk|in|ca|de|fr|jp|au|eu|nl|ch|se|es|it|br|kr|tw|sg|hk|nz';
  const normalizedUrlText = text
    .replace(/(https?)\s*[:;]\s*\/\s*\/\s*/gi, '$1://')
    .replace(/\b(www)\s*\.\s*/gi, 'www.')
    .replace(/([a-z0-9._%+-]+)\s*@\s*([a-z0-9.-]+)\s*\.\s*([a-z]{2,})/gi, '$1@$2.$3')
    .replace(new RegExp(`([a-z0-9-]+)\\s*\\.\\s*(${TLDS})(?=\\b|\\/|\\s|$)`, 'gi'), '$1.$2')
    .replace(new RegExp(`(\\.(?:${TLDS}))\\s*\\/\\s*([a-z0-9_@~.-]+)`, 'gi'), '$1/$2')
    .replace(/((?:https?:\/\/|www\.)[^\s]+?)\s*\/\s*([a-z0-9_@~.-]+)/gi, '$1/$2');

  const cues = [];
  const seenPrompts = new Set();
  const addCue = (prompt, iconType, url) => {
    if (cues.length >= 2 || seenPrompts.has(prompt)) return; // MAX_MAGIC_CUE_SUGGESTIONS = 2
    seenPrompts.add(prompt);
    cues.push({
      kind: 'magic-cue',
      prompt,
      iconSvg: MAGIC_CUE_ICONS[iconType] || MAGIC_CUE_ICONS.link,
      url
    });
  };

  // 1. Email detection (strings.xml:33: "Open <Email>")
  const emailRegex = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,12})\b/g;
  let emailMatch;
  while ((emailMatch = emailRegex.exec(normalizedUrlText)) !== null) {
    const email = emailMatch[1].replace(/[.,;:!?)'"\]]+$/, '');
    if (email.length >= 5 && !/\.(png|jpg|jpeg|webp|svg|gif|css|js|ts|json)$/i.test(email)) {
      const shortEmail = email.length > 28 ? email.slice(0, 26) + '…' : email;
      addCue(`Open ${shortEmail}`, 'email', `mailto:${email}`);
      break;
    }
  }

  // 2. URL / Website detection (supports https://, www., and bare domains/paths like github.com/user/repo, x.com/home, etc.)
  const urlRegex = new RegExp(
    `\\b((?:https?:\\/\\/|www\\.)[^\\s<>()"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?:\\/[^\\s<>()"']*)?)`,
    'gi'
  );
  let urlMatch;
  while ((urlMatch = urlRegex.exec(normalizedUrlText)) !== null) {
    const candidate = urlMatch[1].replace(/[.,;:!?)'"\]>]+$/, '');
    const beforeChar = urlMatch.index > 0 ? normalizedUrlText[urlMatch.index - 1] : '';
    if (beforeChar === '@' || candidate.includes('@')) continue;
    // Skip code property accesses or filenames like console.log, main.js, package.json
    if (/^(console|window|document|math|object|array|string|number|json|system|process|state|this|self|nav|app|fs|os|path)\./i.test(candidate)) continue;
    if (/\.(js|ts|jsx|tsx|py|cs|java|kt|cpp|c|h|css|scss|html|json|xml|yaml|yml|md|txt|sh|bat|exe|dll|png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|tar|gz)$/i.test(candidate) && !/^https?:\/\//i.test(candidate) && !candidate.includes('/')) continue;

    const fullUrl = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    let displayTarget = candidate.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
    if (displayTarget.length > 26) {
      const hostOnly = displayTarget.split('/')[0];
      displayTarget = hostOnly.length <= 26 ? hostOnly : hostOnly.slice(0, 24) + '…';
    }
    addCue(`Open ${displayTarget}`, 'link', fullUrl);
    break;
  }

  // 3. Street Address / Location detection (strings.xml:33: "Open in Maps")
  const addressMatch = text.match(/\b(\d{1,6}\s+[A-Z0-9][A-Za-z0-9.#-]{1,22}(?:\s+[A-Za-z0-9.#-]{1,22}){0,4}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Parkway|Pkwy\.?|Way|Place|Pl\.?|Plaza|Square|Sq\.?|Highway|Hwy\.?|Terrace|Ter\.?|Trail|Trl\.?|Circle|Cir\.?)\b(?:,?\s*[A-Z][A-Za-z\s]{2,20})?(?:,?\s*[A-Z]{2}\s+\d{5})?)/i);
  if (addressMatch) {
    const addr = addressMatch[1].trim();
    addCue('Open in Maps', 'maps', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
  }

  // 4. Date / Time / Calendar Event detection (strings.xml:33: "Add to Calendar")
  // STRICT: Require an actual event/schedule date or time (never bare social-media "Nov 3" post timestamps or lowercase "may")!
  const hasDateWithYearOrTime = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4}|\s+(?:at\s+|@\s*)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))\b/.test(text);
  const hasNumericDate = /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:20\d{2}|\d{2})\b/.test(text);
  const hasDayWithTime = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Tomorrow|Tonight)\b[^.!?\n]{0,25}?\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\b/i.test(text);
  const hasEventKeywordWithDateOrTime = /\b(?:meeting|appointment|call|webinar|conference|dinner|lunch|party|flight|event|session|interview|deadline|reminder|concert|show|workshop| reservation|rsvp|schedule)\b[^.!?\n]{0,50}?\b(?:\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?|\d{1,2}\s*(?:AM|PM|am|pm)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Tomorrow)\b)/i.test(text);
  const isLogOrCodeTimestamp = /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}|\b(?:commit|author:|date:|pid:|exit_code|elapsed_ms)\b/i.test(text);

  if ((hasDateWithYearOrTime || hasNumericDate || hasDayWithTime || hasEventKeywordWithDateOrTime) && !isLogOrCodeTimestamp) {
    const firstNonEmptyLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2) || 'Event';
    const eventTitle = firstNonEmptyLine.slice(0, 60);
    addCue('Add to Calendar', 'calendar', `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventTitle)}`);
  }

  // 5. Flight Number detection (strings.xml:33 Example 5: "UA 456", "DL 1204", "BA 283")
  const flightMatch = text.match(/\b(UA|AA|DL|BA|LH|AF|EK|QF|SQ|WN|AS|B6|AC|NH|JL|CX|TK|QR|VS|KL|IB|AZ|AI|EY|BR|CI|OZ|KE)\s?(\d{2,4})\b/);
  if (flightMatch) {
    const airlineCode = flightMatch[1].toUpperCase();
    const flightNum = flightMatch[2];
    const hasFlightContext = /\b(flight|airline|airport|terminal|gate|depart|arriv|boarding|nonstop|layover|seat|pnr|booking)\b/i.test(text) || /^[A-Z]{2}\s?\d{2,4}$/i.test(text.trim());
    if (hasFlightContext) {
      const flightCode = `${airlineCode} ${flightNum}`;
      addCue(`Check flight ${flightCode}`, 'flight', `https://www.google.com/search?q=${encodeURIComponent(flightCode + ' flight status')}`);
    }
  }

  // 6. Phone Number detection (supports (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567, 1-800-555-1234)
  const phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}\b|(?:\+\d{1,3}[\s.-]?)?\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/);
  if (phoneMatch) {
    const phone = phoneMatch[0].trim();
    // Ensure it's not a date or IP-like number
    if (!/^\d{4}-\d{2}-\d{2}/.test(phone)) {
      addCue(`Call ${phone}`, 'phone', `tel:${phone.replace(/[^\d+]/g, '')}`);
    }
  }

  return cues.slice(0, 2); // MAX_MAGIC_CUE_SUGGESTIONS = 2
}

// Instant local context-aware suggestion engine based on Google's 20 domain examples in `action_suggestions_prompt` (strings.xml:33)
function buildInstantContextualGeminiPrompts(ocrText, visualLabels, count, hasFiles, hasTextAoi) {
  const ocr = (ocrText || '').trim();
  const ocrLower = ocr.toLowerCase();
  const cleanLabel = (l) => String(l || '').split(',')[0].replace(/_/g, ' ').trim();
  const topVisual = cleanLabel(visualLabels && visualLabels[0]);
  const allVisualText = (visualLabels || []).map(cleanLabel).join(' ').toLowerCase();
  const pool = [];
  const add = (s) => {
    if (!s || s.length < 6 || s.length > 45) return;
    if (!pool.some((x) => x.toLowerCase() === s.toLowerCase())) pool.push(s);
  };

  if (count > 1) {
    if (topVisual && !ocr) {
      add(`Compare these ${topVisual}s`);
      add('Which of these is the best option?');
      add('Visualize how these look together');
    } else if (/[$€£¥₹]\s*\d+|\b(price|buy|cart|review|rating)\b/i.test(ocrLower)) {
      add('Compare these products');
      add('Get recommendation based on reviews');
      add('Which one is the best value?');
    } else if (/\b(resume|cv|experience|role|job|candidate)\b/i.test(ocrLower)) {
      add('Compare my resume to this role');
      add('Suggest resume improvements');
      add('Draft a cover letter for this job');
    } else {
      add(`Compare and synthesize these ${count} items`);
      add('Summarize common themes across these');
      add('Create an action plan combining these');
    }
    return pool.slice(0, 3);
  }

  if (hasFiles) {
    return [
      'Summarize key takeaways from this file',
      'Extract action items and important details',
      'Rewrite or format this into a clean table'
    ];
  }

  // 1. Code / Terminal / Error Stack Trace (Example 18)
  if (/\b(error|exception|traceback|syntaxerror|typeerror|referenceerror|nullpointer|failed|enoent|ebusy|err_)\b/i.test(ocrLower)) {
    add('Help me fix this error');
    add('Explain what caused this bug');
    add('Rewrite this code without errors');
  } else if (
    /\b(function|const |let |var |import |export |class |interface |def |return |async |await |public |private |console\.|print\(|SELECT |FROM |WHERE )\b/.test(ocr) ||
    /[{};()=>]{2,}/.test(ocr)
  ) {
    add('Explain what this code does');
    add('Suggest improvements to this code');
    add('Write documentation for this code');
  }

  // 2. Math / Equations / Study / Exam Prep / Textbooks (e.g. ICSE, ISC, CBSE, ML Aggarwal, Class 12)
  if (/\b(exam|board|icse|isc|cbse|jee|neet|sat|textbook|chapter|exercise|solved example|syllabus|grade|topper|study|homework)\b/i.test(ocrLower)) {
    add('Create a study plan from this');
    add('Give me key practice questions');
    add('Summarize the core study tips');
  } else if (/[=+\-*/^]{2,}|\b(solve|equation|integral|derivative|matrix|theorem|calculus|algebra|physics|chemistry)\b/i.test(ocrLower)) {
    add('Solve this step by step');
    add('Explain the formula used here');
    add('Give me similar practice problems');
  }

  // 2b. Gaming / Controllers / Consoles / Video Games
  if (/\b(joystick|gamepad|controller|playstation|ps5|xbox|nintendo|console|gaming|steam|gameplay)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    add('Identify this controller model');
    add('Compare features and compatibility');
    add('Where can I buy this controller?');
  }

  // 3. System Notification / Warning / Troubleshooting (Example 6)
  if (/\b(not connected|disconnected|unavailable|warning|update required|permission denied|offline|bluetooth|wi-fi)\b/i.test(ocrLower)) {
    add('Help me fix this issue');
    add('Why is this happening?');
    add('Show troubleshooting steps');
  }

  // 4. Shopping / Retail / Fashion / Footwear (Examples 3, 11, 17)
  if (/\b(shoe|sneaker|boot|sandal|shirt|sweatshirt|hoodie|jacket|coat|dress|suit|jean|sunglass|watch|bag|backpack)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    const itemWord = topVisual && topVisual.length <= 18 ? topVisual : 'item';
    add(`Where can I buy this ${itemWord}?`);
    add('Compare with similar products');
    add('Build an outfit around this');
  } else if (/[$€£¥₹]\s*\d+|\b(add to cart|buy now|in stock|free shipping|customer reviews|best seller|discount)\b/i.test(ocrLower)) {
    add('Is this a good price?');
    add('Compare with similar products');
    add('Summarize the product reviews');
  }

  // 5. Food / Recipes / Restaurants (Examples 8, 15)
  if (/\b(pizza|burger|sushi|ramen|pasta|salad|soup|stew|steak|cake|cookie|bread|coffee|espresso|ice cream|burrito|taco|curry|dish|recipe|ingredients|menu|restaurant|cafe|bistro|tablespoon|teaspoon|calories)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    if (/\b(restaurant|menu|reviews|rating|reservations|bistro|cafe)\b/i.test(ocrLower)) {
      add('What are their signature dishes?');
      add('Summarize restaurant reviews');
      add('Plan a night out around this spot');
    } else {
      add('How do I make this dish?');
      add('Brainstorm similar recipes');
      add('Estimate calories and nutrition');
    }
  }

  // 6. Plants & Animals (Example 14)
  if (/\b(plant|flower|daisy|rose|orchid|fern|succulent|cactus|tree|mushroom|leaf|botanical|garden)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    add('Identify this plant');
    add('How do I care for this?');
    add('Is this plant pet-safe?');
  }
  if (/\b(dog|cat|puppy|kitten|retriever|terrier|poodle|shepherd|husky|pug|tabby|siamese|bird|parrot|eagle|owl|fish|turtle|rabbit|hamster|wildlife)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    const animalName = topVisual && topVisual.length <= 18 ? topVisual : 'animal';
    add(`Tell me about this ${animalName}`);
    add('What are its key traits?');
    add('Create an illustration of this');
  }

  // 7. Data / Charts / Tables / Finance (Example 4)
  if (/\b(\d+(\.\d+)?%|q[1-4]\b|revenue|profit|traffic|analytics|chart|graph|histogram|plot|dataset|median|average|yoy|roi|stocks?)\b/i.test(ocrLower)) {
    add('Explain the trends shown here');
    add('Turn these stats into a table');
    add('Create a summary of this data');
  }

  // 8. Email / Chat / Social Post / Message Thread (Examples 1, 7)
  if (/\b(dear |hi |hey |hello |sincerely|regards|subject:|inbox|reply|re:|fwd:|thread|posted by|@[\w_]+|retweet|likes)\b/i.test(ocrLower)) {
    add('Summarize key points here');
    add('Help me draft a reply');
    add('Extract action items from this');
  }

  // 9. Travel / Places / Flights (Examples 5, 7, 16)
  if (/\b(flight|airport|airline|terminal|hotel|resort|beach|plaza|castle|palace|mountain|trail|hike|itinerary|vacation|museum|stadium)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    add('Give travel tips for this spot');
    add('Suggest a trip itinerary');
    add('What are good places nearby?');
  }

  // 10. Music / Media / Videos / Articles (Examples 2, 9)
  if (/\b(song|playlist|album|track|artist|spotify|concert|festival|movie|film|episode|trailer|subscribe|views)\b/i.test(ocrLower)) {
    add('Tell me more about this');
    add('Recommend similar titles');
    add('Summarize the main highlights');
  }

  // 11. Text / Article / Short Phrase Fallbacks
  if (pool.length < 3) {
    if (ocr.length > 100) {
      add('Summarize the key points here');
      add('Turn this into a bulleted checklist');
      add('Explain the main concepts simply');
    } else if (ocr.length > 0) {
      const cleanWords = ocr.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean);
      const preview = cleanWords.slice(0, 4).join(' ') + (cleanWords.length > 4 ? '…' : '');
      if (preview.length >= 2) {
        add(`Explain "${preview}" in simple terms`);
      }
      if (hasTextAoi) {
        add('Rewrite or polish this selected text');
        add('Translate or summarize key points');
      } else {
        add('Explain this selection in detail');
        add('Answer questions about this');
      }
    }
  }

  if (topVisual && pool.length < 3) {
    add(`Identify this ${topVisual}`);
    add(`Tell me more about ${topVisual}`);
    add(`Find similar ${topVisual}s`);
  }

  const defaults = [
    'Explain this selection in detail',
    'Identify objects and key details here',
    'Suggest next steps based on this'
  ];
  for (const d of defaults) {
    if (pool.length >= 3) break;
    add(d);
  }
  return pool.slice(0, 3);
}

function getContextualSuggestions() {
  const count = state.selectedAOIs.length;
  const hasFiles = state.selectedAOIs.some((a) => a.type === 'file');
  const hasTextAoi = state.selectedAOIs.some((a) => a.type === 'text' || a.category === 'TEXT');
  // PromptBoxStateFragmentPeer.java:835-840:
  // Joins all non-null ocrText across selectedAOIs with " "
  const combinedOcrText = state.selectedAOIs
    .map((a) => (a.ocrText && a.ocrText.trim()) || '')
    .filter(Boolean)
    .join(' ');
  const existingLabels = state.selectedAOIs
    .map((a) => a.label || a.title || '')
    .filter((l) => l && !/^(window|interactable|manual|text|screen)$/i.test(l));

  // PromptBoxStateFragmentPeer.java:762 & MainScreenKt$MainScreen$6$1.java:51:
  // If selectedAOIs is empty, clearSuggestions() -> 0 suggestion chips!
  if (count === 0) {
    return [];
  }

  // 1. MagicCue Chips (up to MAX_MAGIC_CUE_SUGGESTIONS = 2, bundled with the app!)
  const magicCueChips = getMagicCueSuggestionsForOcrText(combinedOcrText);

  // 2. Gemini Chips (PromptBoxStateFragmentPeer.java:852-884):
  //    - In Googlebook, `updateSuggestions` awaits `llmDeferred.await()` BEFORE emitting to `geminiSuggestionsFlow`!
  //    - When the On-Device Vision + 248M LLM is enabled, we wait until the AI finishes generating the suggestions
  //      before showing the Gemini chips (so they NEVER pop in twice or get replaced mid-animation!).
  //    - When the AI model is Off / not downloaded, instant hardcoded contextual suggestions appear immediately!
  const aoiIdsKey = state.selectedAOIs.map((a) => `${a.id}:${(a.ocrText || '').length}`).join('|');
  state.currentLlmCacheKey = aoiIdsKey;
  let geminiPrompts = [];

  if (state.llmSuggestionsEnabled && state.llmModelDownloaded) {
    if (state.llmChipsCache.has(aoiIdsKey)) {
      geminiPrompts = state.llmChipsCache.get(aoiIdsKey);
    } else {
      if (state.inflightLlmKey !== aoiIdsKey) {
        state.inflightLlmKey = aoiIdsKey;
        const worker = getOrCreateLlmWorker();
        if (worker) {
          const firstImageAoi = state.selectedAOIs.find((a) => a.dataUrl && a.type !== 'text');
          worker.postMessage({
            type: 'generate_suggestions',
            reqId: aoiIdsKey,
            ocrText: combinedOcrText,
            imageDataUrl: firstImageAoi ? firstImageAoi.dataUrl : null,
            aoiCount: count,
            hasFiles,
            modelDirUrl: state.llmModelDirUrl
          });
        }
      }
      // Return only MagicCue chips (if any) while the AI is generating; once the AI finishes,
      // `suggestions_ready` renders the final chips once cleanly!
      return magicCueChips;
    }
  } else {
    geminiPrompts = buildInstantContextualGeminiPrompts(combinedOcrText, existingLabels, count, hasFiles, hasTextAoi);
  }

  const remainingCapacity = Math.max(0, 3 - magicCueChips.length);
  const geminiChips = geminiPrompts.slice(0, remainingCapacity).map((prompt) => ({
    kind: 'gemini',
    prompt
  }));

  return [...magicCueChips, ...geminiChips];
}

function executeMagicCueSuggestion(suggestion) {
  // Exact port of PromptBoxStateFragmentPeer.onSuggestionClicked (PromptBoxStateFragmentPeer.java:606-612 & 633-641):
  // Executes the MagicCue action intent and calls clearSelectionAndFinish(false)!
  state.selectedAOIs = [];
  state.promptText = '';
  state.draftSavedAtMs = 0;
  promptInput.value = '';
  promptInput.style.height = 'auto';
  renderScreenAOICards();
  if (api.executeMagicCue) {
    api.executeMagicCue({ prompt: suggestion.prompt, url: suggestion.url });
  }
}

function renderSuggestionChips() {
  const suggestions = getContextualSuggestions();
  if (!state.expanded || suggestions.length === 0) {
    state.lastRenderedSuggestionsSig = '';
    clearSuggestionChips();
    return;
  }

  // Deduplicate: if the exact same suggestion chips are already rendered & visible,
  // do NOT destroy and re-animate them a second time!
  const sig = suggestions.map((item) => (typeof item === 'string' ? item : `${item.kind}:${item.prompt}`)).join('||');
  if (
    state.lastRenderedSuggestionsSig === sig &&
    !suggestionChipsContainer.classList.contains('hidden') &&
    state.chipMotions.length === suggestions.length &&
    !state.chipMotions.some((m) => m.exiting)
  ) {
    return;
  }
  state.lastRenderedSuggestionsSig = sig;

  state.chipGeneration += 1;
  state.chipsCreatedAt = performance.now();

  const total = suggestions.length;
  const now = performance.now();
  suggestionChipsContainer.innerHTML = '';
  suggestionChipsContainer.classList.remove('hidden');
  suggestionChipsContainer.style.height = `${(total - 1) * CHIP_STRIDE + CHIP_HEIGHT}px`;

  const motions = [];
  suggestions.forEach((item, i) => {
    const isMagicCue = item && item.kind === 'magic-cue';
    const text = typeof item === 'string' ? item : item.prompt;
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip' + (isMagicCue ? ' magic-cue-chip' : '');
    chip.dataset.testid = `suggestion-chip-${i}`;
    chip.style.opacity = '0';
    chip.style.transform = 'translate3d(0px, 0px, 0) scaleY(0.25)';

    const content = document.createElement('span');
    content.className = 'suggestion-chip-content';
    content.style.opacity = '0';

    // SuggestionChipsKt.java:1599-1616:
    // If suggestion.getIcon() != null (MagicCue RemoteAction icon), render that icon;
    // otherwise render fallbackIcon (gs_prompt_suggestion_rond100_vd_theme_20.svg)!
    if (isMagicCue && item.iconSvg) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'suggestion-chip-magic-cue-icon';
      iconWrap.innerHTML = item.iconSvg;
      content.appendChild(iconWrap);
    } else {
      const icon = document.createElement('img');
      icon.src = 'extracted_assets/svg/gs_prompt_suggestion_rond100_vd_theme_20.svg';
      icon.className = 'suggestion-chip-icon';
      content.appendChild(icon);
    }

    const span = document.createElement('span');
    span.textContent = text;
    content.appendChild(span);
    chip.appendChild(content);

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isMagicCue) {
        executeMagicCueSuggestion(item);
      } else {
        submitPromptToGemini(text);
      }
    });

    // SuggestionChipsKt.java:1770-1780: Secondary click (right-click) opens SuggestionFeedbackDialog!
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFeedback();
    });

    suggestionChipsContainer.appendChild(chip);
    // TimeUtils.getRandomTimeOffsetMs() -> 0..10s per EnergyShaderNode instance
    const randomTimeOffsetSec = ((i * 3.71 + Math.random() * 6.29) % 10.0);
    motions.push({
      el: chip,
      contentEl: content,
      index: i,
      delayUntil: now + i * 50,
      started: false,
      exiting: false,
      scaleY: 0.25,
      scaleYVel: 0,
      transY: 0,
      transVel: 0,
      alpha: 0,
      alphaFromTime: now,
      timeOffsetSec: randomTimeOffsetSec,
      ox: 0,
      oy: 0,
      w: 0
    });
  });

  let maxW = 0;
  motions.forEach((motion) => {
    motion.w = motion.el.offsetWidth;
    maxW = Math.max(maxW, motion.w);
  });
  suggestionChipsContainer.style.width = `${Math.max(maxW, 1)}px`;

  // Use unscaled layout offsets (0, promptBox.offsetHeight + 8) so CSS scale(0.8 -> 1.0)
  // on #expanded-state-wrapper or #prompt-box NEVER shifts the WebGL EnergyShader pills!
  const ox = 0;
  const oy = (promptBox.offsetHeight || state.cachedPbH || 52) + 8; // PROMPT_BOX_SUGGESTION_CHIPS_SPACING = 8dp
  motions.forEach((motion) => {
    motion.ox = ox;
    motion.oy = oy;
  });
  state.chipMotions = motions;
  refreshCachedLayoutMetrics();
}

function updateSendButtonVisibility() {
  const hasContent = state.expanded && !state.isCollapsed && (state.promptText.trim().length > 0 || state.selectedAOIs.length > 0);
  if (hasContent) {
    btnSendPrompt.classList.remove('hidden');
  } else {
    btnSendPrompt.classList.add('hidden');
  }
}

async function submitPromptToGemini(overridePrompt = null) {
  const finalPrompt = (overridePrompt !== null ? overridePrompt : promptInput.value).trim();
  if (!finalPrompt && state.selectedAOIs.length === 0) return;

  const attachments = state.selectedAOIs
    .filter((a) => a.filePath)
    .map((a) => ({
      filePath: a.filePath,
      fileName: a.fileName || 'selection.png',
      isImage: a.isImage !== false
    }));

  state.selectedAOIs = [];
  state.promptText = '';
  state.draftSavedAtMs = 0;
  promptInput.value = '';
  promptInput.style.height = 'auto';

  await api.sendToGemini({
    prompt: finalPrompt,
    attachments
  });
}

// ============================================================================
// 6. Screen Drag-Selection (AOI) & Mouse/Cursor Events
// ============================================================================
function getNormalizedDragRect() {
  const x = Math.min(state.dragStartX, state.dragCurrentX);
  const y = Math.min(state.dragStartY, state.dragCurrentY);
  const width = Math.abs(state.dragCurrentX - state.dragStartX);
  const height = Math.abs(state.dragCurrentY - state.dragStartY);
  return { x, y, width, height };
}

function updateCursorTypeForTarget(target) {
  const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen;
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    setCursorType('ibeam');
  } else if (
    target &&
    (target.closest('#floating-prompt-anchor') ||
      target.closest('#text-selection-actions') ||
      target.closest('#bottom-snackbar') ||
      target.closest('.bottom-left-feedback-wrap') ||
      target.closest('#shake-intervention-backdrop') ||
      target.closest('#feedback-dialog-backdrop') ||
      target.closest('#fte-modal-backdrop'))
  ) {
    setCursorType('select');
  } else if (inSelection) {
    // Exact port of MainScreenStateFragmentPeer$cursorTypeFlow$1.java:46-57:
    // - If hoveredAoi?.parsedText != null (or actively text-selecting) -> CursorType.IBEAM
    // - Else if hoveredAoi == null || isDragging -> CursorType.CROSSHAIR
    // - Else (hovered over a detected window / interactable object) -> CursorType.SELECT
    if (state.isTextSelecting || (state.hoveredAoi && state.hoveredAoi.parsedText)) {
      setCursorType('ibeam');
    } else if (!state.hoveredAoi || state.isDraggingAOI) {
      setCursorType('crosshair');
    } else {
      setCursorType('select');
    }
  } else {
    setCursorType('select');
  }
}

function findNearestOcrTextAoiAt(cx, cy, maxPad = 14) {
  let best = null;
  let bestDist = Infinity;
  for (const aoi of state.ocrTextAOIs) {
    if (!aoi || !aoi.parsedText || !aoi.rect) continue;
    const r = aoi.rect;
    const dx = Math.max(0, r.x - cx, cx - (r.x + r.width));
    const dy = Math.max(0, r.y - cy, cy - (r.y + r.height));
    if (dx <= maxPad && dy <= maxPad) {
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        best = aoi;
      }
    }
  }
  return best;
}

function handleLocalPointerMove(e) {
  state.lastLocalPointerMoveMs = performance.now();
  state.cursorX = e.clientX;
  state.cursorY = e.clientY;
  state.ctrlPressed = e.ctrlKey;

  updateHoveredAoiForCursor(e.clientX, e.clientY);
  updateCursorTypeForTarget(e.target);
  updateCustomCursorTransform();

  if (state.isPointerDownOnScrim) {
    state.dragCurrentX = e.clientX;
    state.dragCurrentY = e.clientY;
    const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen;
    if (inSelection && !state.isDraggingAOI && !state.isTextSelecting) {
      const dist = Math.hypot(e.clientX - state.dragStartX, e.clientY - state.dragStartY);
      if (dist >= 4) {
        // Use the text AOI captured at mousedown (or current/nearby text AOI) so moving 4px out of a word
        // NEVER drops text-selection mode into rectangle-crop mode!
        const startTextAoi =
          (state.dragStartTextAoi && state.dragStartTextAoi.parsedText ? state.dragStartTextAoi : null) ||
          (state.hoveredAoi && state.hoveredAoi.parsedText ? state.hoveredAoi : null) ||
          findNearestOcrTextAoiAt(state.dragStartX, state.dragStartY, 18) ||
          findNearestOcrTextAoiAt(e.clientX, e.clientY, 14);
        if (startTextAoi) {
          state.isTextSelecting = true;
          state.textSelectionAoi = startTextAoi;
          state.textSelStartX = state.dragStartX;
          state.textSelStartY = state.dragStartY;
          state.textSelEndX = e.clientX;
          state.textSelEndY = e.clientY;
          setCursorType('ibeam');
          // Point 2: Hide the PromptBox while drag-selecting text!
          floatingAnchor.classList.add('dragging-active');
        } else {
          state.isDraggingAOI = true;
          setCursorType('crosshair');
          floatingAnchor.classList.add('dragging-active');
        }
      }
    }
    if (state.isTextSelecting) {
      state.textSelEndX = e.clientX;
      state.textSelEndY = e.clientY;
      state.scrimDirty = true;
      updateFloatingPromptBoxPosition(e.clientX, e.clientY, false);
      return;
    }
    if (state.isDraggingAOI) {
      // MainScreenKt$mainScreenPointerInput$1$1.smali:1344:
      // detectedCursorPositionState is updated continuously even while dragging!
      updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
      return;
    }
  }

  if (!state.expanded || state.selectingMoreScreen || state.isCollapsed) {
    updateFloatingPromptBoxPosition(e.clientX, e.clientY, false);
  }
}

window.addEventListener('pointerrawupdate', handleLocalPointerMove, { passive: true });
window.addEventListener('pointermove', handleLocalPointerMove, { passive: true });

scrimCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  onUserInteraction();
  if (state.pendingTextSelection) {
    dismissTextSelectionActions(true);
  }
  updateHoveredAoiForCursor(e.clientX, e.clientY);
  state.isPointerDownOnScrim = true;
  state.isDraggingAOI = false;
  state.isTextSelecting = false;
  state.textSelectionAoi = null;
  state.dragStartTextAoi =
    (state.hoveredAoi && state.hoveredAoi.parsedText ? state.hoveredAoi : null) ||
    findNearestOcrTextAoiAt(e.clientX, e.clientY, 18);
  state.dragStartX = e.clientX;
  state.dragStartY = e.clientY;
  state.dragCurrentX = e.clientX;
  state.dragCurrentY = e.clientY;
});

async function addSelectedTextCardToDraft(selectedText, sourceAoi) {
  if (!selectedText || !selectedText.trim() || state.selectedAOIs.length >= 10) return;
  const cleanText = selectedText.trim();
  const dataUrl = generateTextBitmapDataUrl(cleanText);
  let filePath = null;
  if (api.saveTextAoi) {
    const saved = await api.saveTextAoi({ text: cleanText, dataUrl });
    if (saved && saved.filePath) filePath = saved.filePath;
  }
  state.selectedAOIs.push({
    id: `aoi_text_${Date.now()}_${Math.random()}`,
    type: 'text',
    category: 'TEXT',
    ocrText: cleanText,
    rect: sourceAoi ? sourceAoi.rect : null,
    filePath,
    dataUrl,
    isImage: true
  });
}

window.addEventListener('mouseup', async (e) => {
  if (!state.isPointerDownOnScrim) return;
  state.isPointerDownOnScrim = false;
  const wasDragging = state.isDraggingAOI;
  const wasTextSelecting = state.isTextSelecting;
  const textAoi = state.textSelectionAoi;
  state.isDraggingAOI = false;
  state.isTextSelecting = false;
  state.textSelectionAoi = null;
  state.scrimDirty = true;

  if (wasTextSelecting && textAoi) {
    // Point 3: Whenever NO items are currently attached in the PromptBox (`state.selectedAOIs.length === 0`)
    // and Ctrl is not held, selecting text ALWAYS shows the Copy & Plus circles first!
    // Only if the user already has items attached in the PromptBox (`state.selectedAOIs.length > 0`)
    // or is holding Ctrl for multi-select does it attach directly to the PromptBox!
    const pageSel = getSelectedTextAndGeometryFromPage(
      state.textSelStartX,
      state.textSelStartY,
      state.textSelEndX,
      state.textSelEndY
    );
    if (pageSel && pageSel.text && pageSel.text.trim()) {
      const canShowCopyActions =
        state.selectedAOIs.length === 0 &&
        !e.ctrlKey &&
        !state.ctrlPressed;

      if (canShowCopyActions) {
        showTextSelectionActions(pageSel);
        // Keep PromptBox hidden until the user clicks the '+' circle (or dismisses the selection)!
      } else {
        await addSelectedTextCardToDraft(pageSel.text, { rect: pageSel.rect });
        state.selectingMoreScreen = false;
        updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
        if (e.ctrlKey || state.ctrlPressed) {
          state.multiAoiSelectionMode = true;
          setExpandedState(false, { toFan: true });
        } else {
          state.multiAoiSelectionMode = false;
          const wasCollapsedFan = state.isCollapsed;
          setExpandedState(true, { skipFanAnim: wasCollapsedFan });
        }
        renderScreenAOICards();
        floatingAnchor.classList.remove('dragging-active');
      }
    } else {
      floatingAnchor.classList.remove('dragging-active');
    }
    return;
  }

  const rect = getNormalizedDragRect();
  if (wasDragging && rect.width >= 16 && rect.height >= 16) {
    if (state.selectedAOIs.length < 10) {
      state.croppingAoiRect = rect;
      redrawScrimCanvas();
      const crop = await api.cropAOI(rect);
      state.croppingAoiRect = null;
      if (crop) {
        const containedText = (crop.ocrText && crop.ocrText.trim()) || fetchContainedOcrTextForRect(rect);
        state.selectedAOIs.push({
          id: `aoi_${Date.now()}_${Math.random()}`,
          type: 'screen',
          category: 'MANUAL',
          ocrText: containedText,
          rect,
          filePath: crop.filePath,
          dataUrl: crop.dataUrl,
          isImage: true
        });
      }
    }

    state.selectingMoreScreen = false;
    // Update unclampedX/Y to the mouse release coordinate (e.clientX, e.clientY) BEFORE expanding
    // and BEFORE removing 'dragging-active', so it NEVER flashes at the drag-start coordinate!
    updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
    if (e.ctrlKey || state.ctrlPressed) {
      state.multiAoiSelectionMode = true;
      setExpandedState(false, { toFan: true });
      floatingAnchor.classList.remove('dragging-active');
    } else {
      state.multiAoiSelectionMode = false;
      const wasCollapsedFan = state.isCollapsed;
      setExpandedState(true, { skipFanAnim: wasCollapsedFan });
      floatingAnchor.classList.remove('dragging-active');
    }
    renderScreenAOICards();
  } else {
    // Tap without drag on scrimCanvas (MainScreenKt$mainScreenTapGestures$1$1.java:56651-56706)
    if (state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen) {
      if (state.hoveredAoi && state.hoveredAoi.rect && state.selectedAOIs.length < 10) {
        // MainScreenKt$mainScreenTapGestures$1$1.java:56665-56672:
        // Clicking (without dragging to select text) automatically adds the hovered block/area as an attachment!
        // Copy & Plus circles ONLY appear when the user actually drags to select text!
        if (state.hoveredAoi.parsedText && state.hoveredAoi.parsedText.text) {
          await addSelectedTextCardToDraft(state.hoveredAoi.parsedText.text, state.hoveredAoi);
        } else {
          const hRect = state.hoveredAoi.rect;
          state.croppingAoiRect = hRect;
          redrawScrimCanvas();
          const crop = await api.cropAOI(hRect);
          state.croppingAoiRect = null;
          if (crop) {
            const containedText = (crop.ocrText && crop.ocrText.trim()) || fetchContainedOcrTextForRect(hRect);
            state.selectedAOIs.push({
              id: `aoi_${Date.now()}_${Math.random()}`,
              type: 'screen',
              category: state.hoveredAoi.category || 'INTERACTABLE',
              label: state.hoveredAoi.label || state.hoveredAoi.title || '',
              ocrText: containedText,
              rect: hRect,
              filePath: crop.filePath,
              dataUrl: crop.dataUrl,
              isImage: true
            });
          }
        }
        state.selectingMoreScreen = false;
        updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
        if (e.ctrlKey || state.ctrlPressed) {
          state.multiAoiSelectionMode = true;
          setExpandedState(false, { toFan: true });
          floatingAnchor.classList.remove('dragging-active');
        } else {
          state.multiAoiSelectionMode = false;
          const wasCollapsedFan = state.isCollapsed;
          setExpandedState(true, { skipFanAnim: wasCollapsedFan });
          floatingAnchor.classList.remove('dragging-active');
        }
        renderScreenAOICards();
      } else if (state.selectedAOIs.length > 0) {
        // Return from collapsed fan / selection mode back to ExpandedState
        state.selectingMoreScreen = false;
        updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
        floatingAnchor.classList.remove('dragging-active');
        setExpandedState(true);
      } else {
        floatingAnchor.classList.remove('dragging-active');
        // MainScreenStateFragmentPeer.java:684: saveDraftAndExit(ignoreCooldown = false)
        // Ignores tap-outside dismissal during the 1000ms TRIGGER_DISMISSAL_COOLDOWN_MS window!
        if (performance.now() - state.launchTimestampMs >= 1000) {
          playSaveDraftAndExitAnimation();
        }
      }
    } else {
      floatingAnchor.classList.remove('dragging-active');
      if (performance.now() - state.launchTimestampMs >= 1000) {
        playSaveDraftAndExitAnimation();
      }
    }
  }
});

// ============================================================================
// 7. PromptBox Controls, Custom Scrollbar, Tooltips & Keyboard Shortcuts
// ============================================================================
// Exact port of PromptBoxKt.drawVerticalScrollbar (PromptBoxKt.java:5224-5270):
// - width = 4dp, cornerRadius = 2dp, offsetFromLeft = 4dp past right edge,
// - verticalPadding = 8dp inside the wrapper, thumbHeight = (usableHeight / totalHeight) * usableHeight
function updatePromptVerticalScrollbar() {
  if (!promptScrollbarThumb || !promptInput) return;
  const maxVal = promptInput.scrollHeight - promptInput.clientHeight;
  if (maxVal <= 1 || state.aoiSelectionMode) {
    promptScrollbarThumb.classList.add('hidden');
    return;
  }
  const viewportHeight = promptInput.clientHeight;
  const totalHeight = promptInput.scrollHeight;
  const scrollValue = promptInput.scrollTop;
  // Wrapper has 8px top/bottom padding; inside the textarea, verticalPaddingPx = 8dp
  const verticalPaddingPx = 8;
  const usableHeight = viewportHeight - 2 * verticalPaddingPx;
  if (usableHeight <= 0) {
    promptScrollbarThumb.classList.add('hidden');
    return;
  }
  const thumbHeight = Math.max(8, (usableHeight / totalHeight) * usableHeight);
  const thumbOffset = (scrollValue / totalHeight) * usableHeight + verticalPaddingPx + 8; // +8px for wrapper top padding
  promptScrollbarThumb.style.height = `${thumbHeight.toFixed(1)}px`;
  promptScrollbarThumb.style.top = `${thumbOffset.toFixed(1)}px`;
  promptScrollbarThumb.classList.remove('hidden');
}

// Exact port of TooltipKt.TooltipBox(TooltipAnchorPosition.Above) + PlainTooltip (PromptBoxKt.java:2902, 3233, 3238, 5069)
let tooltipShowTimer = null;
function showM3Tooltip(targetEl) {
  if (!m3PlainTooltip || !targetEl) return;
  const text = targetEl.getAttribute('data-tooltip');
  if (!text) return;
  clearTimeout(tooltipShowTimer);
  tooltipShowTimer = setTimeout(() => {
    const r = targetEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    m3PlainTooltip.textContent = text;
    m3PlainTooltip.classList.remove('hidden');
    const cx = r.left + r.width * 0.5;
    const topY = Math.max(8, r.top - 6);
    m3PlainTooltip.style.left = `${cx.toFixed(1)}px`;
    m3PlainTooltip.style.top = `${topY.toFixed(1)}px`;
    void m3PlainTooltip.offsetWidth;
    m3PlainTooltip.classList.add('visible');
  }, 350);
}

function hideM3Tooltip() {
  clearTimeout(tooltipShowTimer);
  if (!m3PlainTooltip) return;
  m3PlainTooltip.classList.remove('visible');
  m3PlainTooltip.classList.add('hidden');
}

[btnAddContent, btnAddAoiTile, btnCollapseSave, btnClearClose, btnSendPrompt, btnTextSelCopy, btnTextSelAdd].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener('mouseenter', () => showM3Tooltip(btn));
  btn.addEventListener('mouseleave', hideM3Tooltip);
  btn.addEventListener('mousedown', hideM3Tooltip);
});

if (btnTextSelCopy) {
  btnTextSelCopy.addEventListener('click', async (e) => {
    e.stopPropagation();
    onUserInteraction();
    const sel = state.pendingTextSelection;
    if (!sel || !sel.text) return;
    const textToCopy = sel.text;
    try {
      if (api.copyText) {
        await api.copyText(textToCopy);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
    } catch (_) {}

    if (iconTextSelCopy) {
      const p = iconTextSelCopy.querySelector('path');
      if (p) p.setAttribute('d', COPY_ICON_PATH_CHECK);
    }
    // Point 2: Once Copy is pressed, fade out the circles + scrim and turn off Magic Pointer!
    dismissTextSelectionActions(true, () => {
      playExitWithoutSavingAnimation();
    });
  });
}

if (btnTextSelAdd) {
  btnTextSelAdd.addEventListener('click', async (e) => {
    e.stopPropagation();
    onUserInteraction();
    const sel = state.pendingTextSelection;
    if (!sel || !sel.text) return;
    const textToAdd = sel.text;
    const selRect = sel.rect;

    dismissTextSelectionActions(true);
    await addSelectedTextCardToDraft(textToAdd, { rect: selRect });
    state.selectingMoreScreen = false;
    updateFloatingPromptBoxPosition(e.clientX, e.clientY, true);
    floatingAnchor.classList.remove('dragging-active');
    if (e.ctrlKey || state.ctrlPressed) {
      state.multiAoiSelectionMode = true;
      setExpandedState(false, { toFan: true });
    } else {
      state.multiAoiSelectionMode = false;
      const wasCollapsedFan = state.isCollapsed;
      setExpandedState(true, { skipFanAnim: wasCollapsedFan });
    }
    renderScreenAOICards();
  });
}

promptBox.addEventListener('click', () => {
  onUserInteraction();
  if (!state.expanded) {
    setExpandedState(true);
  }
});

aoiThumbnailFan.addEventListener('click', (e) => {
  e.stopPropagation();
  onUserInteraction();
  state.selectingMoreScreen = false;
  setExpandedState(true);
});

promptInput.addEventListener('focus', () => {
  if (api.focusOverlay) api.focusOverlay();
  // Note: In Googlebook (PromptBoxKt$ExpandedState$3$1.java & PromptBoxStateFragmentPeer.updateText:539-545),
  // merely focusing the text input does NOT exit aoiSelectionMode! Only typing non-blank text
  // (or clicking the promptBox pill) transitions aoiSelectionMode -> false.
});

promptInput.addEventListener('scroll', updatePromptVerticalScrollbar);

promptInput.addEventListener('input', () => {
  onUserInteraction();
  // Exact port of PromptBoxKt.ContextControls$lambda$17$1$0 (PromptBoxKt.java:4983-4996) &
  // PromptBoxStateFragmentPeer.updateText (PromptBoxStateFragmentPeer.java:539-545):
  // PROMPT_MAX_LENGTH = 1000: if length > 1000, truncate to 1000 and showCharacterLimitSnackbar() once until length <= 1000!
  if (promptInput.value.length > 1000) {
    promptInput.value = promptInput.value.slice(0, 1000);
    if (state.shouldShowCharLimitSnackbar) {
      showSnackbar('char-limit', 4000);
      state.shouldShowCharLimitSnackbar = false;
    }
  } else {
    state.shouldShowCharLimitSnackbar = true;
  }
  state.promptText = promptInput.value;
  if (state.promptText.trim().length > 0) {
    state.hasUserEnteredContentBefore = true;
    state.aoiSelectionMode = false;
    if (!state.expanded) {
      setExpandedState(true);
    }
  }
  promptInput.style.height = 'auto';
  const h = Math.min(96, promptInput.scrollHeight);
  promptInput.style.height = h + 'px';
  promptInput.classList.toggle('scrollable', promptInput.scrollHeight > 96);
  updatePromptVerticalScrollbar();
  syncPromptBoxMode();
  updateSendButtonVisibility();
  requestAnimationFrame(refreshCachedLayoutMetrics);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitPromptToGemini();
  }
});

btnSendPrompt.addEventListener('click', (e) => {
  e.stopPropagation();
  submitPromptToGemini();
});

// Exact port of MainScreen.kt saveDraftAndExit (MainScreenKt.java:1430-1445)
function playSaveDraftAndExitAnimation() {
  if (state.isExiting) return;
  state.isExiting = true;
  const startX = state.anchorX;
  const startY = state.anchorY;
  const boxW = state.cachedAnchorW || 320;
  const boxH = state.cachedAnchorH || 140;
  const startCX = startX + boxW * 0.5;
  const startCY = startY + boxH * 0.5;
  const targetCX = window.innerWidth;
  const targetCY = 0;

  state.exitFlightTx = startX;
  state.exitFlightTy = startY;
  state.exitFlightScale = 1.0;
  state.exitFlightAlpha = 1.0;

  floatingAnchor.classList.add('exiting-saving-draft');
  // Point 6: Smoothly fade out the translucent scrim tint when Magic Pointer exits!
  scrimCanvas.classList.remove('visible');
  const t0 = performance.now();

  // CROS_STANDARD_ACCELERATION_EASING = cubic-bezier(0.4, 0.0, 1.0, 1.0)
  function crosAccel(t) {
    const x1 = 0.4, y1 = 0.0, x2 = 1.0, y2 = 1.0;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const inv = 1 - u;
      const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
      const dx = 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
      if (Math.abs(dx) < 1e-5) break;
      u = Math.min(1, Math.max(0, u - (x - t) / dx));
    }
    const inv = 1 - u;
    return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
  }

  function stepFlight(now) {
    const elapsed = now - t0;
    const scaleProg = crosAccel(Math.min(1, elapsed / 200)); // EXIT_SCALE_DURATION_MILLIS = 200ms
    const posProg = crosAccel(Math.min(1, elapsed / 400));   // EXIT_POSITION_DURATION_MILLIS = 400ms
    const opProg = elapsed < 100 ? 0 : Math.min(1, (elapsed - 100) / 100); // delay 100ms, duration 100ms

    const scale = Math.max(0, 1 - scaleProg);
    const alpha = Math.max(0, 1 - opProg);
    const cx = startCX + (targetCX - startCX) * posProg;
    const cy = startCY + (targetCY - startCY) * posProg;
    const tx = cx - boxW * 0.5;
    const ty = cy - boxH * 0.5;

    state.exitFlightTx = tx;
    state.exitFlightTy = ty;
    state.exitFlightScale = scale;
    state.exitFlightAlpha = alpha;

    floatingAnchor.style.opacity = String(alpha);
    floatingAnchor.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;

    if (elapsed < 400) {
      requestAnimationFrame(stepFlight);
    } else {
      floatingAnchor.classList.remove('exiting-saving-draft');
      floatingAnchor.style.opacity = '';
      state.exitFlightScale = 1.0;
      state.exitFlightAlpha = 1.0;
      state.isExiting = false;
      for (const aoi of state.selectedAOIs) {
        aoi.fromSavedDraft = true;
      }
      state.draftSavedAtMs = (state.selectedAOIs.length > 0 || state.promptText.trim().length > 0) ? Date.now() : 0;
      recordShakeDismissOnFinish();
      api.dismiss();
    }
  }
  requestAnimationFrame(stepFlight);
}

// Exact port of PromptBox.kt exitWithoutSaving (PromptBoxKt.java:1680-1736 & 2020-2031)
function playExitWithoutSavingAnimation() {
  if (state.isExiting) return;
  state.isExiting = true;
  floatingAnchor.classList.remove('first-entry');

  // Clear any hovered AOI shader and restore normal cursor immediately on exit (MainScreenKt.java:55942)
  clearTimeout(state.hoverDelayTimer);
  state.hoveredAoi = null;
  state.renderedHoverAoi = null;
  state.hoverCardAlpha = 0;
  state.scrimCutOutAlpha = 0;
  state.scrimDirty = true;
  setCursorType('select');

  const hasExpandedRows = !contentArea.classList.contains('hidden');
  if (hasExpandedRows) {
    // Multi-row expanded PromptBox (with selected AOI thumbnails):
    // Shrink container height by 48dp over 150ms EMPHASIZED_ACCELERATE_EASING while fading out over 200ms
    const startH = promptBox.offsetHeight;
    promptBox.style.height = `${startH}px`;
    promptBox.style.transition = `height 150ms var(--emphasized-accel-easing)`;
    void promptBox.offsetWidth;
    expandedStateWrapper.classList.add('exiting-without-saving');
    promptBox.classList.add('exiting-without-saving');
    promptBox.style.height = `${Math.max(52, startH - 48)}px`;
  } else {
    // Initial 1-line "Point and select to ask Gemini" / "Ask Gemini" pill (no selected items):
    // Pure GPU-composited fade + subtle scale/lift out over 180ms with zero layout height crushing!
    void promptBox.offsetWidth;
    expandedStateWrapper.classList.add('exiting-without-saving', 'exiting-empty-pill');
    promptBox.classList.add('exiting-without-saving', 'exiting-empty-pill');
  }

  // Smoothly fade out the translucent scrim tint when Magic Pointer exits!
  scrimCanvas.classList.remove('visible');
  beginChipExit();

  setTimeout(() => {
    // Hide the overlay root FIRST while the PromptBox is still at opacity: 0,
    // and only remove `.exiting-without-saving` AFTER hiding `magicRoot` so the box NEVER
    // flashes back to opacity: 1 for a frame before the IPC round-trip completes!
    recordShakeDismissOnFinish();
    magicRoot.classList.add('hidden');
    expandedStateWrapper.classList.remove('exiting-without-saving', 'exiting-empty-pill');
    promptBox.classList.remove('exiting-without-saving', 'exiting-empty-pill');
    promptBox.style.height = '';
    promptBox.style.transition = '';
    state.selectedAOIs = [];
    state.promptText = '';
    promptInput.value = '';
    state.hasUserEnteredContentBefore = false;
    state.draftSavedAtMs = 0;
    state.isExiting = false;
    renderScreenAOICards();
    api.dismiss();
  }, 200);
}

btnCollapseSave.addEventListener('click', (e) => {
  e.stopPropagation();
  playSaveDraftAndExitAnimation();
});

btnClearClose.addEventListener('click', (e) => {
  e.stopPropagation();
  playExitWithoutSavingAnimation();
});

// Exact port of PromptBoxKt.java:3108 (AddAoiThumbnail) & PromptBoxKt.java:8618 (ContextControls + button):
// Clicking either + button directly calls peer.updateAOISelectionMode(true) -> enters screen selection mode!
// Note: In PromptBoxKt$PromptBox$3$2$1.java:94-100, when collapsing to the thumbnail fan,
// `isFollowingCursor` stays `false` during the 100ms fade-out so the Expanded PromptBox fades out
// in place without jumping or sliding toward the + button!
function handleStartScreenSelection() {
  state.selectingMoreScreen = true;
  state.aoiSelectionMode = true;
  const hasAois = state.selectedAOIs.length > 0;
  setExpandedState(false, { toFan: hasAois });
  if (!hasAois) {
    updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, false);
  }
}

btnAddContent.addEventListener('click', (e) => {
  e.stopPropagation();
  handleStartScreenSelection();
});

btnAddAoiTile.addEventListener('click', (e) => {
  e.stopPropagation();
  handleStartScreenSelection();
});

function applyTheme(dark) {
  state.isDarkMode = dark;
  state.scrimDirty = true;
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  if (!fteModalBackdrop.classList.contains('hidden') && state.fteStep === 'wiggle-adjust') {
    loadStepLottie('wiggle-adjust');
  }
}

function closeTopDialog() {
  if (!feedbackBackdrop.classList.contains('hidden')) {
    closeFeedback();
    return true;
  }
  if (!shakeBackdrop.classList.contains('hidden')) {
    closeShakeIntervention();
    return true;
  }
  if (!fteModalBackdrop.classList.contains('hidden')) {
    closeFte();
    return true;
  }
  return false;
}

function handleEscapePressed() {
  if (!state.active || state.isExiting) return;
  if (closeTopDialog()) return;
  if (state.pendingTextSelection) {
    dismissTextSelectionActions(true);
    return;
  }
  if ((state.aoiSelectionMode || state.isCollapsed) && state.selectedAOIs.length > 0) {
    // MainActivityPeer.java:1920: if in selection mode with selected AOIs, Esc returns to ExpandedState!
    state.selectingMoreScreen = false;
    state.multiAoiSelectionMode = false;
    setExpandedState(true);
    return;
  }
  playExitWithoutSavingAnimation();
}

// Exact port of MainActivityPeer.onKeyDown / onKeyUp (MainActivityPeer.java:1905-1938)
window.addEventListener('keydown', (e) => {
  if ((e.key === ',' && (e.ctrlKey || e.metaKey)) || (e.key.toLowerCase() === 's' && e.altKey)) {
    e.preventDefault();
    openFte('wiggle-adjust');
    return;
  }
  if (e.key === 'Control' && !e.repeat) {
    state.hasPressedCtrlMultiSelect = true;
    setSnackbarMessage();
    if (state.aoiSelectionMode && state.selectedAOIs.length < 10) {
      state.multiAoiSelectionMode = true;
      setSnackbarMessage();
    } else if (state.selectedAOIs.length > 0 && state.selectedAOIs.length < 10 && state.expanded && !state.isCollapsed) {
      state.multiAoiSelectionMode = true;
      state.selectingMoreScreen = true;
      setSnackbarMessage();
      setExpandedState(false, { toFan: true });
    }
  }
  if (e.key === 'Escape') {
    handleEscapePressed();
    return;
  }
  // If the user starts typing any printable character while in initial selection mode,
  // ensure promptInput has focus so they can type directly without selecting an image first!
  if (
    state.active &&
    !state.isCollapsed &&
    document.activeElement !== promptInput &&
    e.key.length === 1 &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    fteModalBackdrop.classList.contains('hidden') &&
    feedbackBackdrop.classList.contains('hidden')
  ) {
    if (api.focusOverlay) api.focusOverlay();
    promptInput.focus({ preventScroll: true });
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    const wasMulti = state.multiAoiSelectionMode;
    state.multiAoiSelectionMode = false;
    if (wasMulti && state.selectedAOIs.length > 0 && !state.isDraggingAOI) {
      // MainActivityPeer.java:1001: releasing Ctrl when selectedAOIs is not empty sets updateAoiSelectionMode(false) -> expands!
      state.selectingMoreScreen = false;
      setExpandedState(true);
    }
  }
});

// ============================================================================
// 8. FTE, Shake Intervention, Feedback, and Wiggle Sensitivity
// ============================================================================
const FTE_LOTTIE = {
  'enable-mp': { containerId: 'lottie-pointer-banner', file: 'swatchie__fte_pointer_banner_animation.json' },
  'enable-wiggle': { containerId: 'lottie-wiggle-intro-banner', file: 'swatchie__fte_wiggle_banner.json' },
  'wiggle-adjust': { containerId: 'lottie-wiggle-level-banner', file: null }
};

// FirstTimeExperienceScreenKt.java:2065-2093:
// switch (wiggleSpeed) { case 0 -> Level1, case 1 -> Level2, case 2 -> Level3 (default), case 3 -> Level4 }
function getLevelAnimationFile() {
  const mode = state.isDarkMode ? 'dark' : 'light';
  const speed = Math.min(3, Math.max(0, Number(state.sensitivityLevel)));
  const animLevel = speed + 1;
  return `swatchie__fte_wiggle_banner_${mode}_level${animLevel}_animation.json`;
}

function resetPlayPauseIcons() {
  state.lottiePaused = false;
  document.querySelectorAll('.swatchie-play-pause-btn').forEach((btn) => {
    const path = btn.querySelector('path');
    if (path) path.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    btn.title = 'Pause animation';
  });
}

function loadStepLottie(step) {
  const spec = FTE_LOTTIE[step];
  if (!spec || !window.lottie) return;
  const container = document.getElementById(spec.containerId);
  if (!container) return;
  if (state.lottieInstance) {
    state.lottieInstance.destroy();
    state.lottieInstance = null;
  }
  resetPlayPauseIcons();
  const file = step === 'wiggle-adjust' ? getLevelAnimationFile() : spec.file;
  state.lottieInstance = window.lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: `extracted_assets/lottie/${file}`
  });
}

function showFteStep(step) {
  state.fteStep = step;
  document.querySelectorAll('.fte-screen-step').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.fte-step-pill').forEach((el) => {
    el.classList.toggle('active', el.dataset.step === step);
  });
  const screen = document.getElementById(`fte-screen-${step}`);
  if (screen) screen.classList.remove('hidden');
  loadStepLottie(step);
}

function openFte(step) {
  closeShakeIntervention();
  fteModalBackdrop.classList.remove('hidden');
  showFteStep(step || 'wiggle-adjust');
}

function closeFte() {
  fteModalBackdrop.classList.add('hidden');
  if (state.lottieInstance) {
    state.lottieInstance.destroy();
    state.lottieInstance = null;
  }
}

function openShakeIntervention() {
  shakeBackdrop.classList.remove('hidden');
}

function closeShakeIntervention() {
  shakeBackdrop.classList.add('hidden');
}

function showWiggleDetected() {
  wiggleDetectedBanner.classList.remove('hidden');
  clearTimeout(showWiggleDetected._timer);
  showWiggleDetected._timer = setTimeout(() => {
    wiggleDetectedBanner.classList.add('hidden');
  }, 1500);
}

// ContextualCursorSettingsUtil.java:16-19:
// MIN_WIGGLE_SPEED = 0, MAX_WIGGLE_SPEED = 3, DEFAULT_WIGGLE_SPEED = 0
function applySensitivity(lvl, notify) {
  const num = Number(lvl);
  const next = Math.min(3, Math.max(0, Number.isFinite(num) ? num : 0));
  state.sensitivityLevel = next;
  sensitivitySlider.value = String(next);
  btnSliderMinus.disabled = next <= 0;
  btnSliderPlus.disabled = next >= 3;
  if (notify) api.setSensitivity(next);
  if (state.fteStep === 'wiggle-adjust' && !fteModalBackdrop.classList.contains('hidden')) {
    loadStepLottie('wiggle-adjust');
  }
}

function openFeedback() {
  feedbackBackdrop.classList.remove('hidden');
  feedbackDialog.classList.remove('expanded-details');
  feedbackStepRate.classList.remove('hidden');
  feedbackStepDetails.classList.add('hidden');
  document.querySelectorAll('.feedback-tag-chip').forEach((chip) => chip.classList.remove('selected'));
}

function closeFeedback() {
  feedbackBackdrop.classList.add('hidden');
}

document.querySelectorAll('.fte-step-pill').forEach((pill) => {
  pill.addEventListener('click', () => showFteStep(pill.dataset.step));
});

document.querySelectorAll('.swatchie-play-pause-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.lottieInstance) return;
    state.lottiePaused = !state.lottiePaused;
    if (state.lottiePaused) state.lottieInstance.pause();
    else state.lottieInstance.play();
    const path = btn.querySelector('path');
    if (path) {
      path.setAttribute('d', state.lottiePaused ? 'M8 5v14l11-7z' : 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    }
    btn.title = state.lottiePaused ? 'Play animation' : 'Pause animation';
  });
});

document.getElementById('btn-fte-no-thanks').addEventListener('click', closeFte);
document.getElementById('btn-fte-get-started').addEventListener('click', () => showFteStep('enable-wiggle'));
document.getElementById('btn-wiggle-disable').addEventListener('click', closeFte);
document.getElementById('btn-wiggle-allow').addEventListener('click', () => showFteStep('wiggle-adjust'));
document.getElementById('btn-wiggle-back').addEventListener('click', () => showFteStep('enable-wiggle'));
btnDoneFte.addEventListener('click', closeFte);

document.getElementById('link-fte-settings').addEventListener('click', (e) => {
  e.preventDefault();
  showFteStep('wiggle-adjust');
});
document.getElementById('link-wiggle-settings').addEventListener('click', (e) => {
  e.preventDefault();
  showFteStep('wiggle-adjust');
});

btnShakeNoThanks.addEventListener('click', closeShakeIntervention);
btnShakeSettings.addEventListener('click', () => openFte('wiggle-adjust'));
shakeBackdrop.addEventListener('click', (e) => {
  if (e.target === shakeBackdrop) closeShakeIntervention();
});

btnFeedback.addEventListener('click', (e) => {
  e.stopPropagation();
  openFeedback();
});
snackbarActionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openFte('wiggle-adjust');
});

btnCloseFeedback.addEventListener('click', closeFeedback);
btnThumbUp.addEventListener('click', closeFeedback);
btnThumbDown.addEventListener('click', () => {
  feedbackStepRate.classList.add('hidden');
  feedbackStepDetails.classList.remove('hidden');
  feedbackDialog.classList.add('expanded-details');
});
btnSubmitFeedback.addEventListener('click', closeFeedback);
feedbackBackdrop.addEventListener('click', (e) => {
  if (e.target === feedbackBackdrop) closeFeedback();
});
document.querySelectorAll('.feedback-tag-chip').forEach((chip) => {
  chip.addEventListener('click', () => chip.classList.toggle('selected'));
});

sensitivitySlider.addEventListener('input', () => {
  applySensitivity(sensitivitySlider.value, true);
});
btnSliderMinus.addEventListener('click', () => applySensitivity(state.sensitivityLevel - 1, true));
btnSliderPlus.addEventListener('click', () => applySensitivity(state.sensitivityLevel + 1, true));
applySensitivity(state.sensitivityLevel, false);

// Optional On-Device Suggestion LLM (~92 MB LaMini-Flan-T5-77M int8 ONNX) UI & On-Demand Download
const btnMagicCueAction = document.getElementById('btn-magic-cue-action');
const magicCueBadge = document.getElementById('magic-cue-badge');
const magicCueProgressWrap = document.getElementById('magic-cue-progress-wrap');
const magicCueProgressFill = document.getElementById('magic-cue-progress-fill');
const magicCueProgressText = document.getElementById('magic-cue-progress-text');

function syncLlmSettingsUI() {
  if (!btnMagicCueAction || !magicCueBadge) return;
  if (state.llmDownloading) {
    btnMagicCueAction.disabled = true;
    btnMagicCueAction.textContent = 'Downloading...';
    btnMagicCueAction.classList.remove('active');
    return;
  }
  btnMagicCueAction.disabled = false;
  if (!state.llmModelDownloaded) {
    magicCueBadge.textContent = 'Optional · 500 MB';
    magicCueBadge.classList.remove('installed');
    btnMagicCueAction.textContent = 'Download & Enable';
    btnMagicCueAction.classList.remove('active');
  } else if (state.llmSuggestionsEnabled) {
    magicCueBadge.textContent = 'Installed · Active';
    magicCueBadge.classList.add('installed');
    btnMagicCueAction.textContent = 'Enabled';
    btnMagicCueAction.classList.add('active');
  } else {
    magicCueBadge.textContent = 'Installed · Off';
    magicCueBadge.classList.remove('installed');
    btnMagicCueAction.textContent = 'Enable';
    btnMagicCueAction.classList.remove('active');
  }
}

if (btnMagicCueAction) {
  btnMagicCueAction.addEventListener('click', async () => {
    if (state.llmDownloading) return;
    if (!state.llmModelDownloaded) {
      state.llmDownloading = true;
      if (magicCueProgressWrap) magicCueProgressWrap.classList.remove('hidden');
      if (magicCueProgressFill) magicCueProgressFill.style.width = '2%';
      if (magicCueProgressText) magicCueProgressText.textContent = 'Connecting to Hugging Face model repository...';
      syncLlmSettingsUI();

      if (api.downloadLlmModel) {
        const res = await api.downloadLlmModel();
        state.llmDownloading = false;
        if (res && res.ok) {
          state.llmModelDownloaded = true;
          state.llmSuggestionsEnabled = true;
          if (res.modelDirUrl) state.llmModelDirUrl = res.modelDirUrl;
          const worker = getOrCreateLlmWorker();
          if (worker) worker.postMessage({ type: 'init', modelDirUrl: state.llmModelDirUrl });
          setTimeout(() => {
            if (magicCueProgressWrap) magicCueProgressWrap.classList.add('hidden');
          }, 900);
        } else if (magicCueProgressText) {
          magicCueProgressText.textContent = `Download failed: ${(res && res.error) || 'Check internet connection'}`;
        }
      }
      syncLlmSettingsUI();
      if (state.expanded) renderSuggestionChips();
    } else {
      const nextEnabled = !state.llmSuggestionsEnabled;
      state.llmSuggestionsEnabled = nextEnabled;
      if (api.setLlmEnabled) {
        await api.setLlmEnabled(nextEnabled);
      }
      syncLlmSettingsUI();
      if (state.expanded) renderSuggestionChips();
    }
  });
}

if (api.getMagicCueState) {
  api.getMagicCueState().then((st) => {
    if (st) {
      state.magicCueEnabled = !!st.enabled;
    }
  });
}

if (api.getLlmState) {
  api.getLlmState().then((st) => {
    if (st) {
      state.llmSuggestionsEnabled = !!st.enabled;
      state.llmModelDownloaded = !!st.downloaded;
      state.llmDownloading = !!st.downloading;
      if (st.modelDirUrl) state.llmModelDirUrl = st.modelDirUrl;
      syncLlmSettingsUI();
      if (state.llmSuggestionsEnabled && state.llmModelDownloaded) {
        const worker = getOrCreateLlmWorker();
        if (worker) worker.postMessage({ type: 'init', modelDirUrl: state.llmModelDirUrl });
      }
    }
  });
}

// ============================================================================
// 9. IPC Events from Main Process & Native Wiggle Watcher
// ============================================================================
// Exact port of MainActivityPeer$onAccountChangedInternal$6$1$1.java:55-93:
// Debounces connectivity loss by 3000ms (CONNECTIVITY_ERROR_DELAY_MS = 3000);
// if still offline after 3000ms while Magic Pointer is active, shows ErrorsKt.showConnectivityError()!
function syncConnectivityMonitor() {
  clearTimeout(state.offlineTimer);
  state.offlineTimer = null;
  if (!state.active) return;
  if (navigator.onLine) {
    state.hasShownOfflineError = false;
    if (state.currentSnackbarKind === 'offline') {
      hideSnackbar(false);
    }
  } else if (!state.hasShownOfflineError) {
    state.offlineTimer = setTimeout(() => {
      state.offlineTimer = null;
      if (state.active && !navigator.onLine && !state.hasShownOfflineError) {
        state.hasShownOfflineError = true;
        showSnackbar('offline', 4000);
      }
    }, 3000);
  }
}

window.addEventListener('online', syncConnectivityMonitor);
window.addEventListener('offline', syncConnectivityMonitor);

function activateOverlay(data) {
  const wasActive = state.active;
  state.active = true;
  state.scrimDirty = true;
  state.entrySource = data.source || 'shake';
  magicRoot.classList.remove('hidden');
  applyTheme(data.isDarkMode !== false);

  if (typeof data.sensitivityLevel === 'number') applySensitivity(data.sensitivityLevel, false);
  if (typeof data.magicCueEnabled === 'boolean') state.magicCueEnabled = data.magicCueEnabled;
  if (typeof data.llmSuggestionsEnabled === 'boolean') state.llmSuggestionsEnabled = data.llmSuggestionsEnabled;
  if (typeof data.llmModelDownloaded === 'boolean') state.llmModelDownloaded = data.llmModelDownloaded;
  if (data.llmModelDirUrl) state.llmModelDirUrl = data.llmModelDirUrl;
  syncLlmSettingsUI();

    if (!wasActive) {
    // Exact port of AOIDetectorImpl.resetMonitoringState() (AOIDetectorImpl.java:552-600):
    // Clear all previous session's OCR blocks, MobileRaid AOIs, sub-elements, and hover state
    // so stale rectangles from an older screen or scroll position NEVER appear!
    visionWorkerSeq++;
    state.ocrTextAOIs = [];
    state.pageOcrBlock = null;
    state.pageOcrSymbols = [];
    clearTextSelectionActionsImmediate();
    state.raidScreenElementAOIs = [];
    state.segmentedScreenElements.clear();
    for (const timerId of state.segmentingScreenElementTimers.values()) {
      clearTimeout(timerId);
    }
    state.segmentingScreenElementTimers.clear();
    clearTimeout(state.hoverDelayTimer);
    state.hoveredAoi = null;
    state.renderedHoverAoi = null;
    state.hoverCardAlpha = 0;
    state.scrimCutOutAlpha = 0;
    state.hasFirstAoiAmbientTransitionPlayed = false;
    if (screenshotFreezeImg) {
      screenshotFreezeImg.classList.add('hidden');
      screenshotFreezeImg.removeAttribute('src');
    }

    // New session: reset per-session launch timestamp, idle-hint & interaction flags (MainScreenStateFragmentPeer.java)
    state.launchTimestampMs = performance.now();
    state.shouldShowCharLimitSnackbar = true;
    state.hasShownOfflineError = false;
    state.hasUserInteractedInSession = false;
    state.hasShownIdleExitHintInSession = false;
    hideM3Tooltip();
    hideSnackbar(true);
    syncConnectivityMonitor();

    // ScreenContextRepositoryImpl.java:105 & 2291: TTL_SECONDS = 120 (120,000ms) draft expiration check
    if (state.draftSavedAtMs > 0 && Date.now() - state.draftSavedAtMs > 120000) {
      state.selectedAOIs = [];
      state.promptText = '';
      promptInput.value = '';
      state.hasUserEnteredContentBefore = false;
      state.draftSavedAtMs = 0;
      renderScreenAOICards();
    }
  }

  if (data.screenshot) {
    processScreenshotForMobileRaid(data.screenshot);
  }
  if (data.ocr) {
    processOcrResultIntoTextAOIs(data.ocr);
  }
  if (Array.isArray(data.detectedWindows)) {
    state.detectedWindows = data.detectedWindows;
  } else if (api.getWindows) {
    api.getWindows().then((wins) => {
      if (Array.isArray(wins)) {
        state.detectedWindows = wins;
        updateHoveredAoiForCursor(state.cursorX, state.cursorY);
      }
    });
  }

  state.cursorX = data.x || window.innerWidth / 2;
  state.cursorY = data.y || window.innerHeight / 2;
  updateHoveredAoiForCursor(state.cursorX, state.cursorY);
  setCursorType('crosshair');
  updateCustomCursorTransform();

  if (!wasActive) {
    // PromptBoxKt$PromptBox$3$2$1.java:67-80 & FirstEntryAnimationConfig.java:11:
    // Every time the Magic Pointer activity opens fresh, `isFirstRender` is true:
    // - `scale` snaps to `1.0f` (NO scale/pop animation on launch)
    // - `alpha` fades from `0.0f -> 1.0f` with `delayMillis = 100`, `durationMillis = 100` (`LinearEasing`)
    // Meanwhile `AoiOverlayCanvas` (`MainScreenKt$AoiOverlayCanvas$1$1.java:47`) fades the scrim
    // from `0.0f -> 0.32f` over `100ms` (`LinearEasing`) during that first 100ms!
    scrimCanvas.classList.remove('visible');
    void scrimCanvas.offsetWidth;
    floatingAnchor.classList.remove('first-entry');
    void floatingAnchor.offsetWidth;
    floatingAnchor.classList.add('first-entry');
    setTimeout(() => floatingAnchor.classList.remove('first-entry'), 260);
  }

  if (data.source === 'tutorial') {
    openFte('enable-mp');
    setCursorType('select');
    updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, true);
  } else if (data.source === 'llm-setup' || data.source === 'magic-cue-setup') {
    openFte('wiggle-adjust');
    setCursorType('select');
    updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, true);
  } else if (data.source === 'shake' && wasActive) {
    if (!fteModalBackdrop.classList.contains('hidden') && state.fteStep === 'wiggle-adjust') {
      showWiggleDetected();
    }
  } else {
    // MainActivityPeer.java:962-995:
    // If entryPoint == CURSOR_SHAKE, call shakeInterventionController.recordTrigger(),
    // then check shouldShowShakeIntervention(); if true, call resetExitCount() and show ShakeInterventionScreen!
    if (data.source === 'shake') {
      recordShakeTrigger();
      if (shouldShowShakeInterventionNow()) {
        recordShakeInterventionShown();
        openShakeIntervention();
      }
    }

    if (state.selectedAOIs.length > 0 || state.promptText.trim().length > 0) {
      if (!wasActive) {
        // Reset lastRenderedSuggestionsSig on fresh activation so saved-draft suggestion chips
        // (including chips generated in the background while collapsed/dismissed) animate in cleanly!
        state.lastRenderedSuggestionsSig = '';
        state.expanded = false;
      }
      setExpandedState(true);
    } else {
      state.aoiSelectionMode = true;
      state.expanded = false;
      state.isCollapsed = false;
      expandedStateWrapper.classList.remove('hidden');
      setCursorType('crosshair');
      syncPromptBoxMode();
      clearSuggestionChips();
      syncIdleExitHintTimer();
      // Focus the text field immediately (and again at 350ms matching PromptBoxKt$ExpandedState$3$1.java)
      // so the user can directly start typing a prompt without selecting an image first!
      if (api.focusOverlay) api.focusOverlay();
      promptInput.focus({ preventScroll: true });
      setTimeout(() => {
        if (state.active && !state.isCollapsed && !state.isDraggingAOI && !state.isTextSelecting) {
          if (api.focusOverlay) api.focusOverlay();
          promptInput.focus({ preventScroll: true });
        }
      }, 350);
    }
    refreshCachedLayoutMetrics();
    updateFloatingPromptBoxPosition(state.cursorX, state.cursorY, true);
  }
}

api.onActivate((data) => activateOverlay(data || {}));

api.onCursorMove((data) => {
  if (!state.active || !data) return;
  // Ignore delayed IPC cursor packets if the overlay window is already receiving direct 1000Hz OS pointer/mousemove events!
  if (state.lastLocalPointerMoveMs && performance.now() - state.lastLocalPointerMoveMs < 120) {
    return;
  }
  if (typeof data.x === 'number' && typeof data.y === 'number') {
    state.cursorX = data.x;
    state.cursorY = data.y;
    const hitEl = document.elementFromPoint(data.x, data.y);
    updateHoveredAoiForCursor(data.x, data.y);
    updateCursorTypeForTarget(hitEl);
    updateCustomCursorTransform();
    if (state.isPointerDownOnScrim) {
      state.dragCurrentX = data.x;
      state.dragCurrentY = data.y;
      const inSelection = state.aoiSelectionMode || state.isCollapsed || state.selectingMoreScreen;
      if (inSelection && !state.isDraggingAOI && !state.isTextSelecting) {
        const dist = Math.hypot(data.x - state.dragStartX, data.y - state.dragStartY);
        if (dist >= 4) {
          const startTextAoi =
            (state.dragStartTextAoi && state.dragStartTextAoi.parsedText ? state.dragStartTextAoi : null) ||
            (state.hoveredAoi && state.hoveredAoi.parsedText ? state.hoveredAoi : null) ||
            findNearestOcrTextAoiAt(state.dragStartX, state.dragStartY, 18) ||
            findNearestOcrTextAoiAt(data.x, data.y, 14);
          if (startTextAoi) {
            state.isTextSelecting = true;
            state.textSelectionAoi = startTextAoi;
            state.textSelStartX = state.dragStartX;
            state.textSelStartY = state.dragStartY;
            state.textSelEndX = data.x;
            state.textSelEndY = data.y;
            setCursorType('ibeam');
            floatingAnchor.classList.add('dragging-active');
          } else {
            state.isDraggingAOI = true;
            setCursorType('crosshair');
            floatingAnchor.classList.add('dragging-active');
          }
        }
      }
      if (state.isTextSelecting) {
        state.textSelEndX = data.x;
        state.textSelEndY = data.y;
        state.scrimDirty = true;
        updateFloatingPromptBoxPosition(data.x, data.y, false);
        return;
      }
      if (state.isDraggingAOI) {
        updateFloatingPromptBoxPosition(data.x, data.y, true);
        return;
      }
    }
    if (!state.expanded || state.selectingMoreScreen || state.isCollapsed) {
      updateFloatingPromptBoxPosition(data.x, data.y, false);
    }
  }
});

api.onDeactivate(() => {
  state.active = false;
  visionWorkerSeq++;
  state.ocrTextAOIs = [];
  state.pageOcrBlock = null;
  state.pageOcrSymbols = [];
  clearTextSelectionActionsImmediate();
  state.raidScreenElementAOIs = [];
  state.segmentedScreenElements.clear();
  for (const timerId of state.segmentingScreenElementTimers.values()) {
    clearTimeout(timerId);
  }
  state.segmentingScreenElementTimers.clear();
  clearTimeout(state.hoverDelayTimer);
  state.hoveredAoi = null;
  state.renderedHoverAoi = null;
  state.hoverCardAlpha = 0;
  state.scrimCutOutAlpha = 0;
  clearTimeout(state.idleHintTimer);
  state.idleHintTimer = null;
  clearTimeout(state.offlineTimer);
  state.offlineTimer = null;
  hideM3Tooltip();
  hideSnackbar(true);
  if (screenshotFreezeImg) {
    screenshotFreezeImg.classList.add('hidden');
    screenshotFreezeImg.removeAttribute('src');
  }
  scrimCanvas.classList.remove('visible');
  magicRoot.classList.add('hidden');
  closeFte();
  closeShakeIntervention();
  closeFeedback();
});

if (api.onEscKey) {
  api.onEscKey(() => {
    handleEscapePressed();
  });
}

if (api.onScreenshotReady) {
  api.onScreenshotReady((screenshotInfo) => {
    processScreenshotForMobileRaid(screenshotInfo);
  });
}

if (api.onOcrReady) {
  api.onOcrReady((ocrInfo) => {
    processOcrResultIntoTextAOIs(ocrInfo);
  });
}

api.onSensitivityChange((lvl) => {
  applySensitivity(lvl, false);
});

api.onThemeChange((dark) => {
  applyTheme(dark);
});

if (api.onMagicCueStateChange) {
  api.onMagicCueStateChange((st) => {
    if (!st) return;
    state.magicCueEnabled = !!st.enabled;
    if (state.expanded) renderSuggestionChips();
  });
}

if (api.onLlmStateChange) {
  api.onLlmStateChange((st) => {
    if (!st) return;
    state.llmSuggestionsEnabled = !!st.enabled;
    state.llmModelDownloaded = !!st.downloaded;
    if (st.modelDirUrl) state.llmModelDirUrl = st.modelDirUrl;
    syncLlmSettingsUI();
    if (state.expanded) renderSuggestionChips();
  });
}

if (api.onLlmDownloadProgress) {
  api.onLlmDownloadProgress((prog) => {
    if (!prog) return;
    if (magicCueProgressWrap) magicCueProgressWrap.classList.remove('hidden');
    if (magicCueProgressFill && typeof prog.pct === 'number') {
      magicCueProgressFill.style.width = `${Math.max(0, Math.min(100, prog.pct))}%`;
    }
    if (magicCueProgressText && prog.status) {
      magicCueProgressText.textContent = prog.status;
    }
  });
}

// Render Command (⌘) keycap on macOS or Windows logo keycap on Windows in the FTE tutorial
(function syncPlatformShortcutKeycap() {
  const metaKeycap = document.getElementById('fte-meta-keycap');
  if (!metaKeycap) return;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  if (isMac) {
    metaKeycap.title = 'Command';
    metaKeycap.textContent = '⌘';
  } else {
    metaKeycap.title = 'Windows key';
    metaKeycap.innerHTML = `<svg class="fte-keycap-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 3h8.5v8.5H3V3zm9.5 0H21v8.5h-8.5V3zM3 12.5h8.5V21H3v-8.5zm9.5 0H21V21h-8.5v-8.5z"/></svg>`;
  }
})();

if (!window.magicPointerAPI) {
  activateOverlay({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    source: 'launch',
    isDarkMode: true,
    sensitivityLevel: 0
  });
}
