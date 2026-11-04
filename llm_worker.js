// Dedicated Background Web Worker for Optional On-Device Suggestion LLM (LlmProcessorServiceImpl / ODML)
// Runs a lightweight quantized 77M instruction model (Xenova/LaMini-Flan-T5-77M, ~92MB int8) via ONNX Runtime WASM
// completely off the 120fps main thread!

let pipelineFn = null;
let envObj = null;
let generatorPromise = null;
let modelDirUrl = null;

async function ensureTransformersLoaded() {
  if (pipelineFn && envObj) return true;
  try {
    const mod = await import('./extracted_assets/transformers/dist/transformers.min.js');
    pipelineFn = mod.pipeline;
    envObj = mod.env;
    // Configure local WASM paths so ONNX Runtime runs 100% offline from bundled WASM binaries
    const baseUrl = new URL('./extracted_assets/transformers/dist/', self.location.href).href;
    envObj.backends.onnx.wasm.wasmPaths = baseUrl;
    envObj.backends.onnx.wasm.numThreads = 1;
    envObj.allowRemoteModels = false;
    envObj.allowLocalModels = true;
    return true;
  } catch (err) {
    console.warn('LLM Worker transformers load warning:', err);
    return false;
  }
}

async function getGenerator(localModelBasePath) {
  if (generatorPromise) return generatorPromise;
  generatorPromise = (async () => {
    const ok = await ensureTransformersLoaded();
    if (!ok) return null;
    try {
      if (localModelBasePath) {
        envObj.localModelPath = localModelBasePath;
      }
      const gen = await pipelineFn('text2text-generation', 'LaMini-Flan-T5-77M', {
        quantized: true
      });
      return gen;
    } catch (err) {
      console.warn('LLM Worker pipeline init warning:', err);
      generatorPromise = null;
      return null;
    }
  })();
  return generatorPromise;
}

// Parse and clean LLM output into concise <= 45 char suggestion chips (LlmProcessorServiceImpl.java:322-347)
function parseAndRefineLlmChips(rawText, contextSummary) {
  const cleaned = String(rawText || '')
    .replace(/^[\s\-*•\d.)"]+/, '')
    .replace(/["`]/g, '')
    .trim();

  const candidates = cleaned
    .split(/[\t\n;|]+|(?:\d+\.\s+)/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter((s) => s.length >= 6 && s.length <= 45);

  const ctx = (contextSummary || '').toLowerCase();
  const contextualPool = [];

  if (/\b(error|exception|traceback|failed|syntaxerror|typeerror|bug|undefined|nullpointer)\b/i.test(ctx)) {
    contextualPool.push('Explain how to fix this error', 'Find the root cause of this bug', 'Rewrite this code without errors');
  } else if (/\b(function|const|let|var|class|import|export|def |return |public |private |async |await )\b/i.test(ctx)) {
    contextualPool.push('Explain what this code does', 'Refactor and optimize this code', 'Write unit tests for this code');
  } else if (/[$€£¥₹]\s*\d+|\b(price|buy|cart|shipping|review|rating|discount|deal|order)\b/i.test(ctx)) {
    contextualPool.push('Is this a good price?', 'Compare with similar products', 'Summarize product pros and cons');
  } else if (/\b(recipe|ingredients|tablespoon|teaspoon|oven|bake|cook|calories|protein|dish)\b/i.test(ctx)) {
    contextualPool.push('List the recipe ingredients', 'Make this recipe vegetarian', 'Estimate calories and nutrition');
  } else if (/\b(\d+%|\bq[1-4]\b|revenue|growth|chart|graph|dataset|average|total|metrics)\b/i.test(ctx)) {
    contextualPool.push('Explain the trends shown here', 'Turn these stats into a table', 'Summarize the key data points');
  } else if (/\b(dear |hi |hello |sincerely|regards|subject:|reply|meeting|schedule|deadline)\b/i.test(ctx)) {
    contextualPool.push('Help me draft a polite reply', 'Summarize key decisions here', 'Extract action items from this');
  } else if (ctx.length > 80) {
    contextualPool.push('Summarize the key takeaways', 'Explain this in simple terms', 'Extract the main action items');
  } else if (ctx.length > 0) {
    const shortWords = contextSummary.trim().split(/\s+/).slice(0, 3).join(' ');
    contextualPool.push(
      `Explain "${shortWords}" simply`,
      'Find more info about this topic',
      'Summarize the key points here'
    );
  } else {
    contextualPool.push(
      'Identify what is shown here',
      'Explain the key details here',
      'Suggest helpful next steps'
    );
  }

  const finalChips = [];
  const seen = new Set();
  for (const c of [...candidates, ...contextualPool]) {
    const norm = c.toLowerCase();
    if (!seen.has(norm) && c.length <= 45) {
      seen.add(norm);
      finalChips.push(c);
      if (finalChips.length >= 3) break;
    }
  }
  return finalChips;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    modelDirUrl = msg.modelDirUrl;
    await getGenerator(modelDirUrl);
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'generate_suggestions') {
    const { reqId, contextSummary, modelDirUrl: dirUrl } = msg;
    try {
      const gen = await getGenerator(dirUrl || modelDirUrl);
      let rawOut = '';
      if (gen && contextSummary) {
        // Prompt derived from odml_action_suggestion_prompt (strings.xml:389)
        const prompt = `Generate a short 4-word action prompt for a user who selected: "${contextSummary.slice(0, 220)}". Action prompt:`;
        const out = await gen(prompt, {
          max_new_tokens: 14,
          temperature: 0.3,
          do_sample: false
        });
        if (Array.isArray(out) && out[0] && out[0].generated_text) {
          rawOut = out[0].generated_text.trim();
        }
      }
      const chips = parseAndRefineLlmChips(rawOut, contextSummary);
      self.postMessage({ type: 'suggestions_ready', reqId, chips });
    } catch (err) {
      const chips = parseAndRefineLlmChips('', contextSummary);
      self.postMessage({ type: 'suggestions_ready', reqId, chips });
    }
  }
};
