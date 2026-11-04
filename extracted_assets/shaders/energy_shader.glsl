// Extracted from com.google.android.desktop.gpointer.libraries.shaderlib.energyeffects.shader.EnergyShader
#version 300 es
precision highp float;

uniform float inTime;
uniform vec2 inResolution;
uniform vec2 inCenter;
uniform vec2 inSize;
uniform vec4 inCornerRadii;
uniform float inSpread;

// Panel
uniform float inPanelAlpha;
uniform float inPanelTopBlurRadius;
uniform float inPanelBottomBlurRadius;
uniform vec4 inPanelColor;

// BorderLight 1 & 2
uniform float inBorderLightAlpha1;
uniform float inBorderLightTopBlurRadius1;
uniform float inBorderLightBottomBlurRadius1;
uniform float inBorderLightTopIntensity1;
uniform float inBorderLightBottomIntensity1;
uniform float inBorderLightStrokeWidth1;
uniform float inBorderLightDistortionSpeed1;
uniform float inBorderLightDistortionFrequency1;
uniform float inBorderLightDistortionAmplitude1;
uniform vec4 inBorderLightColor1;

uniform float inBorderLightAlpha2;
uniform float inBorderLightTopBlurRadius2;
uniform float inBorderLightBottomBlurRadius2;
uniform float inBorderLightTopIntensity2;
uniform float inBorderLightBottomIntensity2;
uniform float inBorderLightStrokeWidth2;
uniform float inBorderLightDistortionSpeed2;
uniform float inBorderLightDistortionFrequency2;
uniform float inBorderLightDistortionAmplitude2;
uniform vec4 inBorderLightColor2;

// Dots
uniform float inDotsAlpha;
uniform float inDotsMaxRadius;
uniform float inDotsMinRadius;
uniform float inDotsBlurRadius;
uniform vec4 inDotsColor;
uniform float inDotsGridSize;
uniform float inDotsMoveStrength;
uniform float inDotsYGradientWeight;
uniform float inDotsMaskInnerStrokeWidth;
uniform float inDotsMaskOuterStrokeWidth;
uniform float inDotsWaveFrequency;
uniform float inDotsWaveAmplitude;
uniform float inDotsWaveSpeed;

out vec4 fragColor;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

vec4 normalBlendPreMulti(vec4 back, vec4 front) {
    return front + back * (1.0 - front.a);
}

float remap(float value, float inMin, float inMax, float outMin, float outMax) {
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
    float dotVal = sdBox(p, vec2(r));
    float safeBlur = max(blur, 0.0001);
    dotVal = 1.0 - smoothstep(-safeBlur, safeBlur, dotVal);
    return dotVal;
}

float sinWaves(float x) {
    return sin(x * 2.0) + sin((x + 0.2) * 12.0) * 0.12 + sin((x + 13.0) * 2.555) * 0.28;
}

float rotatingDistortionMask(vec2 p, vec2 center, float amp, float freq, float speed) {
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

vec4 calculateBorderLight(
    vec4 inColor, float mainSdf, vec2 center, float yFract, vec2 p, float blurredSdfMask,
    float alpha, float topBlur, float bottomBlur, float topIntensity, float bottomIntensity,
    float strokeWidth, float speed, float freq, float amp, vec4 color
) {
    if (alpha <= 0.001) return inColor;
    float distortionOffset = rotatingDistortionMask(p, center, amp, freq, speed);
    float borderBlur = calculateBlur(yFract, topBlur, bottomBlur);
    float borderIntensity = calculateBlur(yFract, topIntensity, bottomIntensity);
    float internalDistance = borderBlur + strokeWidth / 2.0 + distortionOffset;
    float externalDistance = borderBlur + strokeWidth / 2.0;
    float borderSdf = smoothpeak(-internalDistance, 0.0, externalDistance, mainSdf);
    float borderMask = borderSdf * borderIntensity;
    vec4 borderLight = vec4(color.rgb, 1.0) * borderMask * blurredSdfMask;
    return normalBlendPreMulti(inColor, borderLight * alpha);
}
