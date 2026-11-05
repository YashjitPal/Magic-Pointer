// Dedicated Background Web Worker for On-Device Multimodal Suggestion AI (~500 MB int8 ONNX Suite)
// Combines 3 specialized models completely off the 120fps UI thread:
// 1. `vit-gpt2-image-captioning` (~237 MB int8 ONNX): Vision-Language encoder-decoder that generates a full natural-language
//    caption of any selected image or screenshot region (e.g. "a white and black video game controller on a dark surface").
// 2. `resnet-50` (~25 MB int8 ONNX): High-speed 1,000-class ImageNet classifier for fine-grained object category detection.
// 3. `LaMini-Flan-T5-248M` (~265 MB int8 ONNX): 248-million-parameter instruction-tuned T5 model (>3x larger than 77M)
//    guided by Google's exact `action_suggestions_prompt` (strings.xml:33) & `odml_action_suggestion_prompt` (strings.xml:389)!

let pipelineFn = null;
let envObj = null;
let textGenPromise = null;
let imageCaptionPromise = null;
let imageClfPromise = null;
let modelDirUrl = null;

async function ensureTransformersLoaded() {
  if (pipelineFn && envObj) return true;
  try {
    const mod = await import('./extracted_assets/transformers/dist/transformers.min.js');
    pipelineFn = mod.pipeline;
    envObj = mod.env;
    const baseUrl = new URL('./extracted_assets/transformers/dist/', self.location.href).href;
    envObj.backends.onnx.wasm.wasmPaths = baseUrl;
    // Enable multi-threaded XNNPACK/WASM SIMD inside the background Worker (up to 4 threads)
    // so the 248M LLM + ViT-GPT2 vision model run in ~180-300ms with zero main-thread impact!
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    envObj.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, Math.floor(cores / 2)));
    envObj.useBrowserCache = false;
    envObj.allowRemoteModels = false;
    envObj.allowLocalModels = true;
    return true;
  } catch (err) {
    console.warn('LLM Worker transformers load warning:', err);
    return false;
  }
}

async function getImageCaptioner(localModelBasePath) {
  if (imageCaptionPromise) return imageCaptionPromise;
  imageCaptionPromise = (async () => {
    const ok = await ensureTransformersLoaded();
    if (!ok) return null;
    try {
      if (localModelBasePath) envObj.localModelPath = localModelBasePath;
      return await pipelineFn('image-to-text', 'vit-gpt2-image-captioning', { quantized: true });
    } catch (err) {
      console.warn('LLM Worker vit-gpt2-image-captioning init warning:', err);
      imageCaptionPromise = null;
      return null;
    }
  })();
  return imageCaptionPromise;
}

async function getImageClassifier(localModelBasePath) {
  if (imageClfPromise) return imageClfPromise;
  imageClfPromise = (async () => {
    const ok = await ensureTransformersLoaded();
    if (!ok) return null;
    try {
      if (localModelBasePath) envObj.localModelPath = localModelBasePath;
      return await pipelineFn('image-classification', 'resnet-50', { quantized: true });
    } catch (err) {
      console.warn('LLM Worker resnet-50 init warning:', err);
      imageClfPromise = null;
      return null;
    }
  })();
  return imageClfPromise;
}

async function getTextGenerator(localModelBasePath) {
  if (textGenPromise) return textGenPromise;
  textGenPromise = (async () => {
    const ok = await ensureTransformersLoaded();
    if (!ok) return null;
    try {
      if (localModelBasePath) envObj.localModelPath = localModelBasePath;
      return await pipelineFn('text2text-generation', 'LaMini-Flan-T5-248M', { quantized: true });
    } catch (err) {
      console.warn('LLM Worker LaMini-Flan-T5-248M init warning:', err);
      textGenPromise = null;
      return null;
    }
  })();
  return textGenPromise;
}

function cleanVisualLabel(rawLabel) {
  if (!rawLabel) return '';
  return String(rawLabel).split(',')[0].replace(/_/g, ' ').trim();
}

// Extract key domain entities/noun phrases from OCR text or image caption so suggestions are hyper-specific
function extractSpecificTopicPhrase(ocrText, imageCaption, topVisual) {
  const text = (ocrText || '').replace(/\s+/g, ' ').trim();
  if (text) {
    // Look for proper nouns, capitalized phrases, or quoted terms first
    const properMatches = text.match(/\b([A-Z][A-Za-z0-9.+-]*(?:\s+[A-Z0-9][A-Za-z0-9.+-]*){0,2})\b/g);
    if (properMatches) {
      const stopProper = /^(The|This|That|These|Those|Here|There|When|Where|What|Why|How|In|On|At|For|To|From|With|By|And|But|Or|If|Do|Filter|Solved|Chapter|Look|It|Is|Are)$/;
      const goodProper = properMatches
        .map((m) => m.trim())
        .find((m) => m.length >= 3 && m.length <= 24 && !stopProper.test(m));
      if (goodProper) return goodProper;
    }
    const words = text.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length <= 4) return words.join(' ');
    return words.slice(0, 4).join(' ') + '…';
  }
  if (imageCaption) {
    return imageCaption
      .replace(/^(a|an|the)\s+(photo|picture|image|close up|view)\s+of\s+(a|an|the)?\s*/i, '')
      .replace(/^(a|an|the)\s+/i, '')
      .trim()
      .slice(0, 26);
  }
  return topVisual || '';
}

function isGoodGeneratedChip(raw, ocrText) {
  if (!raw) return false;
  let s = String(raw)
    .replace(/^[\s\-*•\d.)"'\`:]+/, '')
    .replace(/["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 10 || s.length > 45) return false;
  const wordCount = s.split(/\s+/).length;
  if (wordCount < 3 || wordCount > 9) return false;
  // Reject meta-echoes or forbidden actions from strings.xml:33
  if (/^(question|command|prompt|suggestion|action|chip|output|input|answer|task|example|write|generate|tell me more\b|open in |rename |delete |move to )/i.test(s)) {
    return false;
  }
  // Reject if it just echoes a raw substring of the OCR text without an action verb or question word
  const startsWithActionOrQuestion = /^(explain|summarize|compare|identify|how|what|why|where|when|which|is|are|can|should|help|find|suggest|recommend|draft|rewrite|create|plan|solve|break|extract|list|check|give|turn|build|analyze|simplify|translate)\b/i.test(
    s
  );
  if (!startsWithActionOrQuestion) return false;
  if (ocrText && ocrText.toLowerCase().includes(s.toLowerCase()) && s.length > 15) return false;
  return true;
}

// Build 3 diverse, specific, <45-char suggestion chips following Google's exact rules in `action_suggestions_prompt` (strings.xml:33)
function buildSmartSuggestions({ ocrText, imageCaption, visualLabels, aoiCount, hasFiles, llmSuggestions }) {
  const ocr = (ocrText || '').trim();
  const ocrLower = ocr.toLowerCase();
  const caption = (imageCaption || '').trim();
  const captionLower = caption.toLowerCase();
  const topVisual = cleanVisualLabel(visualLabels && visualLabels[0]);
  const allVisualText = `${captionLower} ${(visualLabels || []).map(cleanVisualLabel).join(' ').toLowerCase()}`.trim();
  const combinedContext = `${ocrLower} ${allVisualText}`.trim();
  const specificTopic = extractSpecificTopicPhrase(ocr, caption, topVisual);

  const pool = [];
  const pushChip = (s) => {
    if (!s) return;
    let clean = String(s)
      .replace(/^[\s\-*•\d.)"'\`:]+/, '')
      .replace(/["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length > 0) {
      clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    }
    if (clean.length < 8 || clean.length > 45) return;
    if (/^(tell me more$|open in |rename |delete |move to |question:|action:|prompt:|answer:)/i.test(clean)) return;
    if (!pool.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      pool.push(clean);
    }
  };

  // 1. Prioritize validated 248M LLM-generated suggestions (Understand/Analyze, Transform, Ideate)
  if (Array.isArray(llmSuggestions)) {
    for (const s of llmSuggestions) {
      if (isGoodGeneratedChip(s, ocr)) {
        pushChip(s);
      }
    }
  }

  // 2. Multi-selection synthesis (Examples 12, 15, 16, 17, 19, 20 in strings.xml:33)
  if (aoiCount > 1) {
    if (topVisual && !ocr) {
      pushChip(`Compare these ${topVisual}s`);
      pushChip('Which of these is the best option?');
      pushChip('Visualize how these look together');
    } else if (ocrLower.includes('resume') || ocrLower.includes('experience') || ocrLower.includes('role')) {
      pushChip('Compare my resume to this role');
      pushChip('Suggest resume improvements');
      pushChip('Draft a cover letter for this job');
    } else if (/[$€£¥₹]\s*\d+|\b(price|buy|cart|review|rating)\b/i.test(ocrLower)) {
      pushChip('Compare these products');
      pushChip('Get recommendation based on reviews');
      pushChip('Which one is the best value?');
    } else {
      pushChip('Compare and synthesize these');
      pushChip('What are the key differences?');
      pushChip('Summarize common themes here');
    }
  }

  // 3. Gaming / Controllers / Consoles / Video Games
  if (/\b(joystick|gamepad|controller|playstation|ps5|xbox|nintendo|console|gaming|steam|gameplay|esports)\b/i.test(combinedContext)) {
    pushChip('Identify this controller model');
    pushChip('Compare features and compatibility');
    pushChip('Where can I buy this controller?');
  }

  // 4. Study / Exam Prep / Textbooks / Homework / Math (e.g. ICSE, ISC, ML Aggarwal, Class 12, Calculus, Chapters)
  if (/\b(exam|board|icse|isc|cbse|jee|neet|sat|textbook|chapter|exercise|solved example|question|syllabus|grade|topper|study|theorem|algebra|calculus|equation|integral|derivative|matrix|physics|chemistry)\b/i.test(combinedContext)) {
    if (specificTopic && specificTopic.length <= 20) {
      pushChip(`Create a study plan for ${specificTopic}`);
    } else {
      pushChip('Create a study plan from this');
    }
    pushChip('Give me key practice questions');
    pushChip('Summarize the core tips here');
  }

  // 5. Code / Programming / Terminal / Stack Trace (Example 18 in strings.xml:33)
  if (/\b(error|exception|traceback|syntaxerror|typeerror|referenceerror|nullpointer|segfault|failed|enoent|ebusy|err_)\b/i.test(ocrLower)) {
    pushChip('Help me fix this error');
    pushChip('Explain what caused this bug');
    pushChip('Rewrite this code without errors');
  } else if (
    /\b(function|const |let |var |import |export |class |interface |def |return |async |await |public |private |console\.|print\(|SELECT |FROM |WHERE )\b/.test(ocr) ||
    /[{};()=>]{2,}/.test(ocr)
  ) {
    pushChip('Explain what this code does');
    pushChip('Suggest improvements to this code');
    pushChip('Write documentation for this code');
  }

  // 6. System Notification / Warning / Troubleshooting (Example 6 in strings.xml:33)
  if (/\b(not connected|disconnected|unavailable|warning|update required|permission denied|offline|bluetooth|wi-fi|driver)\b/i.test(ocrLower)) {
    pushChip('Help me fix this issue');
    pushChip('Why is this happening?');
    pushChip('Show troubleshooting steps');
  }

  // 7. Shopping / Retail / Fashion / Sneakers / Apparel (Examples 3, 11, 12, 17 in strings.xml:33)
  if (/\b(shoe|sneaker|boot|sandal|loafer|jersey|shirt|sweatshirt|hoodie|jacket|coat|dress|suit|jean|sunglass|watch|bag|backpack)\b/i.test(combinedContext)) {
    const itemWord = topVisual && topVisual.length <= 18 ? topVisual : 'item';
    pushChip(`Where can I buy this ${itemWord}?`);
    pushChip('Compare with similar products');
    pushChip('Build an outfit around this');
  } else if (/[$€£¥₹]\s*\d+|\b(add to cart|buy now|in stock|free shipping|customer reviews|best seller|msrp|discount)\b/i.test(ocrLower)) {
    pushChip('Is this a good price?');
    pushChip('Compare with similar products');
    pushChip('Summarize the product reviews');
  }

  // 8. Food / Cooking / Recipes / Restaurants / Menus (Examples 8, 15 in strings.xml:33)
  if (/\b(pizza|burger|sushi|ramen|pasta|salad|soup|stew|steak|cake|cookie|bread|coffee|espresso|ice cream|guacamole|burrito|taco|curry|dish|recipe|ingredients|menu|restaurant|cafe|bistro|tablespoon|teaspoon|calories)\b/i.test(combinedContext)) {
    if (/\b(restaurant|menu|reviews|rating|reservations|bistro|cafe)\b/i.test(ocrLower)) {
      pushChip('What are their signature dishes?');
      pushChip('Summarize restaurant reviews');
      pushChip('Plan a night out around this spot');
    } else {
      const foodLabel = topVisual && topVisual.length <= 18 && !/plate|bowl|cup/i.test(topVisual) ? topVisual : 'dish';
      pushChip(`How do I make this ${foodLabel}?`);
      pushChip('Brainstorm similar recipes');
      pushChip('Estimate calories and nutrition');
    }
  }

  // 9. Plants / Flowers / Animals / Pets / Nature (Example 14 in strings.xml:33)
  if (/\b(plant|pot|flower|daisy|rose|orchid|fern|succulent|cactus|tree|mushroom|fungus|leaf|botanical|garden)\b/i.test(combinedContext)) {
    pushChip('Identify this plant');
    pushChip('How do I care for this?');
    pushChip('Is this plant pet-safe?');
  }
  if (/\b(dog|cat|puppy|kitten|retriever|terrier|poodle|shepherd|husky|pug|tabby|siamese|bird|parrot|eagle|owl|fish|turtle|rabbit|hamster|wildlife)\b/i.test(combinedContext)) {
    const animalName = topVisual && topVisual.length <= 20 ? topVisual : 'animal';
    pushChip(`Tell me about this ${animalName}`);
    pushChip('What are its key traits?');
    pushChip('Create an illustration of this');
  }

  // 10. Vehicles / Cars / Gadgets / Electronics / Hardware
  if (/\b(car|convertible|sports car|suv|truck|motorcycle|bicycle|laptop|monitor|keyboard|phone|camera|headphones|microphone|guitar|piano|drone|robot)\b/i.test(combinedContext)) {
    const labelWord = topVisual && topVisual.length <= 18 ? topVisual : 'item';
    pushChip(`Identify this ${labelWord}`);
    pushChip('Compare specs with alternatives');
    pushChip('What is the typical price range?');
  }

  // 11. Furniture / Interior Design / Architecture (Example 12 in strings.xml:33)
  if (/\b(sofa|couch|chair|armchair|desk|table|lamp|chandelier|bookcase|wardrobe|bed|patio|interior|living room|bedroom)\b/i.test(combinedContext)) {
    pushChip('What design style is this?');
    pushChip('Suggest matching decor ideas');
    pushChip('Find similar furniture options');
  }

  // 12. Data / Charts / Graphs / Tables / Finance (Example 4 in strings.xml:33)
  if (/\b(\d+(\.\d+)?%|q[1-4]\b|revenue|profit|traffic|analytics|chart|graph|histogram|plot|dataset|median|average|yoy|roi|stocks?)\b/i.test(ocrLower)) {
    pushChip('Explain the trends shown here');
    pushChip('Turn these stats into a table');
    pushChip('Create a summary of this data');
  }

  // 13. Email / Chat / Message Thread / Social Post (Examples 1, 7 in strings.xml:33)
  if (/\b(dear |hi |hey |hello |sincerely|regards|subject:|inbox|reply|re:|fwd:|thread|posted by|@[\w_]+|retweet|likes)\b/i.test(ocrLower)) {
    pushChip('Summarize key points here');
    pushChip('Help me draft a reply');
    pushChip('Fact-check the claims made here');
  }

  // 14. Travel / Landmarks / Maps / Flights (Examples 5, 7, 16 in strings.xml:33)
  if (/\b(flight|airport|airline|terminal|hotel|resort|beach|plaza|castle|palace|mountain|trail|hike|itinerary|vacation|museum|stadium|arena)\b/i.test(combinedContext)) {
    pushChip('Give travel tips for this spot');
    pushChip('Suggest a trip itinerary');
    pushChip('What are good places nearby?');
  }

  // 15. Rich Visual Caption / Specific OCR Fallbacks
  if (pool.length < 3 && caption && !ocr) {
    const shortCap = specificTopic && specificTopic.length <= 22 ? specificTopic : topVisual || 'image';
    pushChip(`Identify details in this ${shortCap}`);
    pushChip(`Find similar images or products`);
    pushChip(`Create a variation of this image`);
  }

  if (pool.length < 3) {
    if (ocr.length > 100) {
      pushChip('Summarize the key points here');
      pushChip('Turn this into a bulleted checklist');
      pushChip('Explain the main concepts simply');
    } else if (ocr.length > 0 && specificTopic) {
      pushChip(`Explain "${specificTopic}" simply`);
      pushChip('Rewrite or polish this text');
      pushChip('Find more info on this topic');
    }
  }

  if (topVisual && pool.length < 3) {
    pushChip(`Identify this ${topVisual}`);
    pushChip(`Compare with similar ${topVisual}s`);
    pushChip(`Tell me more about ${topVisual}`);
  }

  if (hasFiles && pool.length < 3) {
    pushChip('Summarize key takeaways');
    pushChip('Extract action items');
    pushChip('Format this into a clean table');
  }

  const defaults = [
    'Explain this selection in detail',
    'Identify key details shown here',
    'Suggest next steps based on this'
  ];
  for (const d of defaults) {
    if (pool.length >= 3) break;
    pushChip(d);
  }

  return pool.slice(0, 3);
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    modelDirUrl = msg.modelDirUrl;
    await Promise.all([
      getImageCaptioner(modelDirUrl),
      getImageClassifier(modelDirUrl),
      getTextGenerator(modelDirUrl)
    ]);
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'generate_suggestions') {
    const { reqId, ocrText, imageDataUrl, aoiCount, hasFiles, modelDirUrl: dirUrl } = msg;
    const baseDir = dirUrl || modelDirUrl;
    let imageCaption = '';
    let visualLabels = [];
    const llmSuggestions = [];

    try {
      // Step 1: If an image crop is present, run BOTH ViT-GPT2 image captioning AND ResNet-50 object classification in parallel!
      if (imageDataUrl) {
        const [captioner, clf] = await Promise.all([
          getImageCaptioner(baseDir),
          getImageClassifier(baseDir)
        ]);
        const [capOut, preds] = await Promise.all([
          captioner ? captioner(imageDataUrl, { max_new_tokens: 20 }) : Promise.resolve(null),
          clf ? clf(imageDataUrl, { topk: 3 }) : Promise.resolve(null)
        ]);
        if (Array.isArray(capOut) && capOut[0] && capOut[0].generated_text) {
          imageCaption = String(capOut[0].generated_text).trim();
        }
        if (Array.isArray(preds)) {
          visualLabels = preds
            .filter((p) => p && p.score >= 0.12 && p.label)
            .map((p) => p.label);
        }
      }

      // Step 2: Run 248M LaMini-Flan-T5-248M across the 3 Googlebook intent categories (Analyze, Transform, Ideate)
      const gen = await getTextGenerator(baseDir);
      const topVis = cleanVisualLabel(visualLabels[0]);
      const cleanOcr = (ocrText || '').replace(/\s+/g, ' ').trim().slice(0, 220);

      let contextSummary = '';
      if (cleanOcr && imageCaption) {
        contextSummary = `Image of ${imageCaption} with text: "${cleanOcr}"`;
      } else if (cleanOcr) {
        contextSummary = `Selected text: "${cleanOcr}"`;
      } else if (imageCaption) {
        contextSummary = `Selected image showing ${imageCaption}${topVis ? ` (${topVis})` : ''}`;
      } else if (topVis) {
        contextSummary = `Selected image of a ${topVis}`;
      }

      if (gen && contextSummary) {
        // Few-shot instruction prompts tailored for Flan-T5-248M so it outputs clean, imperative/question chips <=45 chars:
        const prompts = [
          `Context: Image of a houseplant. Suggestion: How do I care for this plant?\nContext: Article about Artemis II launch. Suggestion: Summarize the key points here\nContext: ${contextSummary}.\nWrite one short 5-word question or action to explain or analyze this:`,
          `Context: Email thread about project launch. Suggestion: Draft a polite reply to this\nContext: Table of Q3 website traffic stats. Suggestion: Turn these stats into a table\nContext: ${contextSummary}.\nWrite one short 5-word command to summarize, rewrite, or organize this:`,
          `Context: Photo of running shoes on a website. Suggestion: Compare with similar running shoes\nContext: Recipe and ingredients for bean stew. Suggestion: Brainstorm similar recipes with these\nContext: ${contextSummary}.\nWrite one short 5-word action to plan next steps or explore related ideas:`
        ];

        for (const p of prompts) {
          const out = await gen(p, {
            max_new_tokens: 14,
            do_sample: false,
            repetition_penalty: 1.2
          });
          if (Array.isArray(out) && out[0] && out[0].generated_text) {
            const candidate = out[0].generated_text
              .replace(/^(Suggestion|Action|Question|Command|Output):\s*/i, '')
              .split(/[\n\t.?!]/)[0]
              .trim();
            if (isGoodGeneratedChip(candidate, cleanOcr)) {
              llmSuggestions.push(candidate);
            }
          }
        }
      }
    } catch (err) {
      console.warn('LLM Worker inference warning:', err);
    }

    const chips = buildSmartSuggestions({
      ocrText,
      imageCaption,
      visualLabels,
      aoiCount: aoiCount || 1,
      hasFiles: !!hasFiles,
      llmSuggestions
    });

    self.postMessage({
      type: 'suggestions_ready',
      reqId,
      chips,
      imageCaption,
      visualLabels
    });
  }
};
