// Dedicated Background Web Worker for Optional On-Device Suggestion LLM + Vision Classifier (LlmProcessorServiceImpl / ODML)
// Combines:
// 1. Quantized ResNet-50 (1,000-class ImageNet visual classifier, ~25MB int8 ONNX) to recognize actual image pixels
//    (plants, sneakers, clothes, dishes/food, dogs/cats, cars, furniture, electronics, instruments, landmarks, etc.)
// 2. Quantized LaMini-Flan-T5-77M (~92MB int8 ONNX) + Google's exact 20 domain templates from `action_suggestions_prompt`
//    (strings.xml:33) & `odml_action_suggestion_prompt` (strings.xml:389)!

let pipelineFn = null;
let envObj = null;
let textGenPromise = null;
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
    envObj.backends.onnx.wasm.numThreads = 1;
    envObj.allowRemoteModels = false;
    envObj.allowLocalModels = true;
    return true;
  } catch (err) {
    console.warn('LLM Worker transformers load warning:', err);
    return false;
  }
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
      return await pipelineFn('text2text-generation', 'LaMini-Flan-T5-77M', { quantized: true });
    } catch (err) {
      console.warn('LLM Worker LaMini-Flan-T5-77M init warning:', err);
      textGenPromise = null;
      return null;
    }
  })();
  return textGenPromise;
}

function cleanVisualLabel(rawLabel) {
  if (!rawLabel) return '';
  // ImageNet labels look like "running shoe", "golden retriever", "espresso, coffee" -> take primary name
  return String(rawLabel).split(',')[0].replace(/_/g, ' ').trim();
}

// Build 3 diverse, specific, <45-char suggestion chips following Google's exact rules in `action_suggestions_prompt` (strings.xml:33)
function buildSmartSuggestions({ ocrText, visualLabels, aoiCount, hasFiles, llmSuggestion }) {
  const ocr = (ocrText || '').trim();
  const ocrLower = ocr.toLowerCase();
  const topVisual = cleanVisualLabel(visualLabels && visualLabels[0]);
  const topVisualLower = topVisual.toLowerCase();
  const allVisualText = (visualLabels || []).map(cleanVisualLabel).join(' ').toLowerCase();

  const pool = [];
  const pushChip = (s) => {
    if (!s) return;
    const clean = String(s)
      .replace(/^[\s\-*•\d.)"']+/, '')
      .replace(/["'`]+$/g, '')
      .trim();
    if (clean.length < 6 || clean.length > 45) return;
    if (/^(tell me more|open in |rename |delete |move to )/i.test(clean)) return;
    if (!pool.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      pool.push(clean);
    }
  };

  // Multi-selection synthesis (Examples 12, 15, 16, 17, 19, 20 in strings.xml:33)
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

  // 1. Code / Programming / Terminal / Stack Trace (Example 18 in strings.xml:33)
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

  // 2. Math / Equations / Science Problems
  if (/[=+\-*/^]{2,}|\b(solve|equation|integral|derivative|matrix|theorem|calculus|algebra|triangle|angle|physics)\b/i.test(ocrLower)) {
    pushChip('Solve this step by step');
    pushChip('Explain the formula used here');
    pushChip('Give me similar practice problems');
  }

  // 3. System Notification / Warning / Troubleshooting (Example 6 in strings.xml:33)
  if (/\b(not connected|disconnected|unavailable|warning|update required|permission denied|offline|bluetooth|wi-fi|driver)\b/i.test(ocrLower)) {
    pushChip('Help me fix this issue');
    pushChip('Why is this happening?');
    pushChip('Show troubleshooting steps');
  }

  // 4. Shopping / Retail / Fashion / Sneakers / Apparel (Examples 3, 11, 12, 17 in strings.xml:33)
  const isFootwearOrApparel = /\b(shoe|sneaker|boot|sandal|loafer|jersey|shirt|sweatshirt|hoodie|jacket|coat|dress|suit|jean|sunglass|watch|bag|backpack)\b/i.test(
    `${ocrLower} ${allVisualText}`
  );
  if (isFootwearOrApparel) {
    const itemWord = topVisual && topVisual.length <= 18 ? topVisual : 'item';
    pushChip(`Where can I buy this ${itemWord}?`);
    pushChip('Compare with similar products');
    pushChip(`Build an outfit around this`);
  } else if (/[$€£¥₹]\s*\d+|\b(add to cart|buy now|in stock|free shipping|customer reviews|best seller|msrp|discount)\b/i.test(ocrLower)) {
    pushChip('Is this a good price?');
    pushChip('Compare with similar products');
    pushChip('Summarize the product reviews');
  }

  // 5. Food / Cooking / Recipes / Restaurants / Menus (Examples 8, 15 in strings.xml:33)
  const isFoodOrDish = /\b(pizza|burger|sushi|ramen|pasta|salad|soup|stew|steak|cake|cookie|bread|coffee|espresso|ice cream|guacamole|burrito|taco|curry|dish|recipe|ingredients|menu|restaurant|cafe|bistro|tablespoon|teaspoon|calories)\b/i.test(
    `${ocrLower} ${allVisualText}`
  );
  if (isFoodOrDish) {
    if (/\b(restaurant|menu|reviews|rating| reservations|bistro|cafe)\b/i.test(ocrLower)) {
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

  // 6. Plants / Flowers / Animals / Pets / Nature (Example 14 in strings.xml:33)
  const isPlant = /\b(plant|pot|flower|daisy|rose|orchid|fern|succulent|cactus|tree|mushroom|fungus|leaf|botanical|garden)\b/i.test(
    `${ocrLower} ${allVisualText}`
  );
  if (isPlant) {
    pushChip('Identify this plant');
    pushChip('How do I care for this?');
    pushChip('Is this plant pet-safe?');
  }
  const isAnimal = /\b(dog|cat|puppy|kitten|retriever|terrier|poodle|shepherd|husky|pug|tabby|siamese|bird|parrot|eagle|owl|fish|turtle|rabbit|hamster|wildlife)\b/i.test(
    `${ocrLower} ${allVisualText}`
  );
  if (isAnimal) {
    const animalName = topVisual && topVisual.length <= 20 ? topVisual : 'animal';
    pushChip(`Tell me about the ${animalName}`);
    pushChip('What are its key traits?');
    pushChip('Create an illustration of this');
  }

  // 7. Vehicles / Cars / Gadgets / Hardware
  const isVehicleOrTech = /\b(car|convertible|sports car|suv|truck|motorcycle|bicycle|laptop|monitor|keyboard|phone|camera|headphones|microphone|guitar|piano)\b/i.test(
    `${ocrLower} ${allVisualText}`
  );
  if (isVehicleOrTech && topVisual) {
    pushChip(`Identify this ${topVisual}`);
    pushChip('Compare specs with alternatives');
    pushChip('What is the typical price range?');
  }

  // 8. Furniture / Interior Design / Architecture (Example 12 in strings.xml:33)
  if (/\b(sofa|couch|chair|armchair|desk|table|lamp|chandelier|bookcase|wardrobe|bed|patio|interior|living room|bedroom)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    pushChip('What design style is this?');
    pushChip('Suggest matching decor ideas');
    pushChip('Find similar furniture options');
  }

  // 9. Data / Charts / Graphs / Tables / Finance (Example 4 in strings.xml:33)
  if (/\b(\d+(\.\d+)?%|q[1-4]\b|revenue|profit|traffic|analytics|chart|graph|histogram|plot|dataset|median|average|yoy|roi|stocks?)\b/i.test(ocrLower)) {
    pushChip('Explain the trends shown here');
    pushChip('Turn these stats into a table');
    pushChip('Create a summary of this data');
  }

  // 10. Email / Chat / Message Thread / Social Post (Examples 1, 7 in strings.xml:33)
  if (/\b(dear |hi |hey |hello |sincerely|regards|subject:|inbox|reply|re:|fwd:|thread|posted by|@[\w_]+|retweet|likes)\b/i.test(ocrLower)) {
    pushChip('Summarize key points here');
    pushChip('Help me draft a reply');
    pushChip('Extract action items from this');
  }

  // 11. Travel / Landmarks / Maps / Flights (Examples 5, 7, 16 in strings.xml:33)
  if (/\b(flight|airport|airline|terminal|hotel|resort|beach|plaza|castle|palace|mountain|trail|hike|itinerary|vacation|museum|stadium|arena)\b/i.test(`${ocrLower} ${allVisualText}`)) {
    pushChip('Give travel tips for this spot');
    pushChip('Suggest a trip itinerary');
    pushChip('What are good places nearby?');
  }

  // 12. Music / Playlists / Media / Movies / Books (Examples 2, 9 in strings.xml:33)
  if (/\b(song|playlist|album|track|artist|spotify|concert|festival|movie|film|episode|trailer|author|novel|chapter)\b/i.test(ocrLower)) {
    pushChip('Recommend similar titles');
    pushChip('Tell me more about the creator');
    pushChip('Summarize the main themes');
  }

  // 13. Include cleaned LLM-generated chip if valid & specific
  if (llmSuggestion) {
    pushChip(llmSuggestion);
  }

  // 14. Specific OCR / Visual Label Fallbacks (so even arbitrary text or images get specific chips!)
  if (ocr.length > 100) {
    pushChip('Summarize this article');
    pushChip('Explain the key concepts here');
    pushChip('Extract key takeaways');
  } else if (ocr.length > 0) {
    const cleanWords = ocr.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const topic = cleanWords.slice(0, 4).join(' ') + (cleanWords.length > 4 ? '…' : '');
    if (topic.length >= 2) {
      pushChip(`Explain "${topic}" simply`);
      pushChip('Rewrite or polish this text');
      pushChip('Find more info on this topic');
    }
  }

  if (topVisual && pool.length < 3) {
    pushChip(`Identify this ${topVisual}`);
    pushChip(`Tell me more about ${topVisual}`);
    pushChip(`Find similar ${topVisual}s`);
  }

  if (hasFiles && pool.length < 3) {
    pushChip('Summarize key takeaways');
    pushChip('Extract action items');
    pushChip('Format this into a clean table');
  }

  // Final safety padding up to 3 chips
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
    await Promise.all([getImageClassifier(modelDirUrl), getTextGenerator(modelDirUrl)]);
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'generate_suggestions') {
    const { reqId, ocrText, imageDataUrl, aoiCount, hasFiles, modelDirUrl: dirUrl } = msg;
    const baseDir = dirUrl || modelDirUrl;
    let visualLabels = [];
    let llmSuggestion = '';

    try {
      // Step 1: If an image dataUrl is present, run the on-device ResNet-50 vision model to see what object/scene is in the image!
      if (imageDataUrl) {
        const clf = await getImageClassifier(baseDir);
        if (clf) {
          const preds = await clf(imageDataUrl, { topk: 3 });
          if (Array.isArray(preds)) {
            visualLabels = preds
              .filter((p) => p && p.score >= 0.08 && p.label)
              .map((p) => p.label);
          }
        }
      }

      // Step 2: Run LaMini-Flan-T5-77M on the combined visual + OCR context to synthesize a custom action prompt
      const gen = await getTextGenerator(baseDir);
      const topVis = cleanVisualLabel(visualLabels[0]);
      const combinedContext = [
        topVis ? `Image of ${topVis}` : '',
        ocrText ? `Text: "${ocrText.slice(0, 180)}"` : ''
      ]
        .filter(Boolean)
        .join('. ');

      if (gen && combinedContext) {
        const prompt = `Write a short 4-word question or action a user can ask an AI assistant about: ${combinedContext}. Question:`;
        const out = await gen(prompt, {
          max_new_tokens: 12,
          temperature: 0.2,
          do_sample: false
        });
        if (Array.isArray(out) && out[0] && out[0].generated_text) {
          const candidate = out[0].generated_text.split(/[\n\t.?!]/)[0].trim();
          if (candidate.length >= 8 && candidate.length <= 45) {
            llmSuggestion = candidate;
          }
        }
      }
    } catch (err) {
      console.warn('LLM Worker inference warning:', err);
    }

    const chips = buildSmartSuggestions({
      ocrText,
      visualLabels,
      aoiCount: aoiCount || 1,
      hasFiles: !!hasFiles,
      llmSuggestion
    });

    self.postMessage({
      type: 'suggestions_ready',
      reqId,
      chips,
      visualLabels
    });
  }
};
