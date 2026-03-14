const state = {
  currentPath: '',
  listing: null,
  activeImagePath: '',
  selectionMode: true,
  selection: null,
  readerMode: 'scroll',
  currentIndex: 0,
  analyzing: false,
  zoomPercent: 100,
  streamText: '',
  progressSaveTimer: null,
  restoringProgress: false,
  recentItems: [],
};

const els = {
  rootPathInput: document.querySelector('#rootPathInput'),
  openRootBtn: document.querySelector('#openRootBtn'),
  goParentBtn: document.querySelector('#goParentBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  recentBooksBtn: document.querySelector('#recentBooksBtn'),
  pathHint: document.querySelector('#pathHint'),
  folders: document.querySelector('#folders'),
  images: document.querySelector('#images'),
  imagesMeta: document.querySelector('#imagesMeta'),
  currentBookName: document.querySelector('#currentBookName'),
  bookInfo: document.querySelector('#bookInfo'),
  currentImageName: document.querySelector('#currentImageName'),
  currentPageProgress: document.querySelector('#currentPageProgress'),
  reader: document.querySelector('#reader'),
  statusBar: document.querySelector('#statusBar'),
  toggleSelectionBtn: document.querySelector('#toggleSelectionBtn'),
  selectionInfo: document.querySelector('#selectionInfo'),
  analyzeBtn: document.querySelector('#analyzeBtn'),
  analysisResult: document.querySelector('#analysisResult'),
  streamStatus: document.querySelector('#streamStatus'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  modelInput: document.querySelector('#modelInput'),
  baseUrlInput: document.querySelector('#baseUrlInput'),
  configHint: document.querySelector('#configHint'),
  readerModeHint: document.querySelector('#readerModeHint'),
  prevPageBtn: document.querySelector('#prevPageBtn'),
  nextPageBtn: document.querySelector('#nextPageBtn'),
  modeBtns: Array.from(document.querySelectorAll('.mode-btn')),
  zoomRange: document.querySelector('#zoomRange'),
  zoomValue: document.querySelector('#zoomValue'),
  zoomOutBtn: document.querySelector('#zoomOutBtn'),
  zoomInBtn: document.querySelector('#zoomInBtn'),
  reasoningEffortSelect: document.querySelector('#reasoningEffortSelect'),
  recentBooksModal: document.querySelector('#recentBooksModal'),
  recentBooksList: document.querySelector('#recentBooksList'),
  closeRecentBooksBtn: document.querySelector('#closeRecentBooksBtn'),
};

const SETTINGS_KEY = 'manga_translator_settings_v4';

function currentImages() { return state.listing?.images || []; }
function escapeHtml(text) { return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

function updateCurrentPageInfo() {
  const images = currentImages();
  const total = images.length;
  const active = images[state.currentIndex];
  els.currentImageName.textContent = active?.name || '未打开图片';
  els.currentPageProgress.textContent = total ? `${state.currentIndex + 1} / ${total}` : '0 / 0';
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    apiKey: els.apiKeyInput.value,
    model: els.modelInput.value,
    baseUrl: els.baseUrlInput.value,
    lastPath: state.currentPath || els.rootPathInput.value,
    readerMode: state.readerMode,
    zoomPercent: state.zoomPercent,
    reasoningEffort: els.reasoningEffortSelect.value,
  }));
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败: ${res.status}`);
  return data;
}


async function fetchReadingProgress(folderPath) {
  const data = await fetchJson(`/api/reading-progress?path=${encodeURIComponent(folderPath)}`);
  return data.progress || null;
}

async function fetchRecentReadingItems(limit = 5) {
  const data = await fetchJson(`/api/reading-progress/recent?limit=${limit}`);
  return data.items || [];
}

async function persistReadingProgress() {
  const images = currentImages();
  const active = images[state.currentIndex];
  if (!state.currentPath || !active) return;

  try {
    await fetchJson('/api/reading-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: state.currentPath,
        imagePath: active.path,
        pageIndex: state.currentIndex,
      }),
    });
  } catch (error) {
    console.warn('保存阅读进度失败:', error);
  }
}

function schedulePersistReadingProgress() {
  if (state.restoringProgress) return;
  clearTimeout(state.progressSaveTimer);
  state.progressSaveTimer = setTimeout(() => {
    persistReadingProgress();
  }, 700);
}

async function restoreReadingProgress() {
  const images = currentImages();
  if (!state.currentPath || !images.length) return false;

  try {
    const progress = await fetchReadingProgress(state.currentPath);
    if (!progress) return false;

    let targetIndex = images.findIndex((image) => image.path === progress.imagePath);
    if (targetIndex < 0 && Number.isInteger(progress.pageIndex)) {
      targetIndex = Math.max(0, Math.min(progress.pageIndex, images.length - 1));
    }
    if (targetIndex < 0) return false;

    state.restoringProgress = true;
    jumpToIndex(targetIndex);
    if (state.readerMode === 'scroll') {
      requestAnimationFrame(() => {
        document.querySelector(`[data-image-path="${CSS.escape(images[targetIndex].path)}"]`)?.scrollIntoView({ block: 'start' });
      });
    }
    setStatus(`已恢复到上次阅读位置：第 ${targetIndex + 1} 页。`);
    return true;
  } catch (error) {
    console.warn('读取阅读进度失败:', error);
    return false;
  } finally {
    setTimeout(() => {
      state.restoringProgress = false;
    }, 50);
  }
}

async function loadServerConfig() {
  try {
    const config = await fetchJson('/api/config');
    els.configHint.textContent = config.baseUrl
      ? `已读取 config.toml：provider=${config.modelProvider || 'unknown'}，base_url=${config.baseUrl}，model=${config.model || '(未设置)'}，服务端密钥=${config.hasServerApiKey ? '已检测到' : '未检测到'}`
      : '未读取到完整 provider 配置，将使用页面填写或环境变量。';
    return config;
  } catch (error) {
    els.configHint.textContent = `读取 config.toml 失败：${error.message}`;
    return null;
  }
}

async function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const config = await loadServerConfig();
  els.apiKeyInput.value = saved.apiKey || '';
  els.modelInput.value = saved.model || config?.model || 'gpt-5.4';
  els.baseUrlInput.value = saved.baseUrl || config?.baseUrl || 'https://api.openai.com/v1';
  els.rootPathInput.value = saved.lastPath || 'B:\\comic';
  els.reasoningEffortSelect.value = saved.reasoningEffort || 'default';
  state.readerMode = saved.readerMode || 'scroll';
  state.zoomPercent = saved.zoomPercent || 100;
  syncModeButtons();
  applyZoom();
}


function formatRecentTime(text) {
  return text || '未知时间';
}

function closeRecentBooksModal() {
  els.recentBooksModal.classList.add('hidden');
}

function renderRecentBooks(items) {
  els.recentBooksList.innerHTML = '';
  if (!items.length) {
    els.recentBooksList.innerHTML = '<div class="hint">还没有阅读记录。</div>';
    return;
  }

  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'recent-book-item';
    button.innerHTML = `
      <img class="recent-book-thumb" src="/api/image?path=${encodeURIComponent(item.imagePath)}" alt="${escapeHtml(item.folderName || 'recent')}" />
      <div>
        <div class="recent-book-title">${escapeHtml(item.folderName || item.folderPath || '未命名')}</div>
        <div class="recent-book-path">${escapeHtml(item.folderPath || '')}</div>
      </div>
      <div class="recent-book-meta">
        <div>${Number(item.pageIndex || 0) + 1} / ${Math.max(Number(item.totalPages || 0), 0)}</div>
        <div>${escapeHtml(formatRecentTime(item.updatedAt))}</div>
      </div>
    `;
    button.onclick = async () => {
      closeRecentBooksModal();
      await openDirectory(item.folderPath);
    };
    els.recentBooksList.appendChild(button);
  }
}

async function openRecentBooksModal() {
  els.recentBooksModal.classList.remove('hidden');
  els.recentBooksList.innerHTML = '<div class="hint">正在读取最近阅读记录...</div>';
  try {
    state.recentItems = await fetchRecentReadingItems(5);
    renderRecentBooks(state.recentItems);
  } catch (error) {
    els.recentBooksList.innerHTML = `<div class="hint">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

async function resolveInitialDirectory() {
  try {
    const recentItems = await fetchRecentReadingItems(1);
    if (recentItems[0]?.folderPath) return recentItems[0].folderPath;
  } catch {}
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  return saved.lastPath || els.rootPathInput.value || 'B:\\comic';
}

function setStatus(message) { els.statusBar.textContent = message; }

function applyZoom() {
  els.zoomRange.value = String(state.zoomPercent);
  els.zoomValue.textContent = `${state.zoomPercent}%`;
  const baseWidth = Math.max(320, Math.min(1040, els.reader.clientWidth - 24));
  const scaledWidth = Math.round(baseWidth * (state.zoomPercent / 100));
  els.reader.style.setProperty('--page-width', `${scaledWidth}px`);
}

function stepZoom(delta) {
  state.zoomPercent = Math.max(60, Math.min(220, state.zoomPercent + delta));
  applyZoom();
  saveSettings();
}

async function openDirectory(targetPath) {
  if (!targetPath) return;
  setStatus('正在读取目录...');
  try {
    const data = await fetchJson(`/api/list?path=${encodeURIComponent(targetPath)}`);
    state.currentPath = data.current.path;
    state.listing = data;
    state.currentIndex = 0;
    state.activeImagePath = data.images[0]?.path || '';
    els.rootPathInput.value = state.currentPath;
    els.pathHint.textContent = data.current.path;
    els.currentBookName.textContent = data.current.name;
    els.bookInfo.textContent = `${data.directories.length} 个子文件夹 · ${data.images.length} 张图片`;
    updateCurrentPageInfo();
    renderFolders();
    renderImages();
    renderReader();
    const restored = await restoreReadingProgress();
    saveSettings();
    if (!restored) setStatus(data.images.length ? '已加载当前卷。' : '当前文件夹没有图片，可继续进入子文件夹。');
  } catch (error) {
    setStatus(`读取失败：${error.message}`);
  }
}

function renderFolders() {
  els.folders.innerHTML = '';
  for (const dir of state.listing?.directories || []) {
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.textContent = dir.name;
    btn.onclick = () => openDirectory(dir.path);
    els.folders.appendChild(btn);
  }
  if (!els.folders.children.length) els.folders.innerHTML = '<div class="hint">无子文件夹</div>';
}

function jumpToIndex(index) {
  const images = currentImages();
  if (!images.length) return;
  state.currentIndex = Math.max(0, Math.min(index, images.length - 1));
  state.activeImagePath = images[state.currentIndex]?.path || '';
  updateCurrentPageInfo();
  renderImages();
  renderReader();
  schedulePersistReadingProgress();
}

function renderImages() {
  els.images.innerHTML = '';
  const images = currentImages();
  els.imagesMeta.textContent = images.length ? `共 ${images.length} 页` : '当前文件夹无图片';
  for (const [index, image] of images.entries()) {
    const btn = document.createElement('button');
    btn.className = `list-item ${state.activeImagePath === image.path ? 'active' : ''}`;
    btn.textContent = `${String(index + 1).padStart(3, '0')} · ${image.name}`;
    btn.onclick = () => {
      state.currentIndex = index;
      state.activeImagePath = image.path;
      if (state.readerMode === 'scroll') {
        document.querySelector(`[data-image-path="${CSS.escape(image.path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderImages();
      } else {
        renderImages();
        renderReader();
      }
      updateCurrentPageInfo();
      schedulePersistReadingProgress();
    };
    els.images.appendChild(btn);
  }
}

function syncCurrentIndexFromScroll() {
  if (state.readerMode !== 'scroll') return;
  const images = currentImages();
  if (!images.length) return;

  const pages = Array.from(els.reader.querySelectorAll('[data-image-path]'));
  if (!pages.length) return;

  const readerRect = els.reader.getBoundingClientRect();
  let bestIndex = state.currentIndex;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    const distance = Math.abs(rect.top - readerRect.top - 8);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = images.findIndex((item) => item.path === page.dataset.imagePath);
    }
  }

  if (bestIndex >= 0 && bestIndex !== state.currentIndex) {
    state.currentIndex = bestIndex;
    state.activeImagePath = images[bestIndex]?.path || '';
    updateCurrentPageInfo();
    renderImages();
    schedulePersistReadingProgress();
  }
}

function clearSelectionVisuals() {
  document.querySelectorAll('.selection-box').forEach((box) => {
    box.classList.remove('fade-out');
    box.style.display = 'none';
  });
}

function resetSelectionInfo() {
  state.selection = null;
  els.selectionInfo.textContent = state.selectionMode
    ? '圈选翻译默认已开启；松开鼠标后会自动开始流式分析。'
    : '圈选翻译当前已关闭。';
  els.analyzeBtn.disabled = true;
  clearSelectionVisuals();
}

function fadeOutSelectionBox(box) {
  box.classList.remove('fade-out');
  void box.offsetWidth;
  box.classList.add('fade-out');
  setTimeout(() => {
    box.style.display = 'none';
    box.classList.remove('fade-out');
  }, 1450);
}

function attachSelectionHandlers(container, img, image, index) {
  const selectionBox = container.querySelector('.selection-box');
  let start = null;

  const updateSelectionBox = (rect) => {
    selectionBox.style.display = 'block';
    selectionBox.style.left = `${rect.x}px`;
    selectionBox.style.top = `${rect.y}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
  };

  container.addEventListener('pointerdown', (event) => {
    if (!state.selectionMode) return;
    event.preventDefault();
    const bounds = img.getBoundingClientRect();
    start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  });

  container.addEventListener('pointermove', (event) => {
    if (!state.selectionMode || !start) return;
    const bounds = img.getBoundingClientRect();
    const currentX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const currentY = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    updateSelectionBox({ x: Math.min(start.x, currentX), y: Math.min(start.y, currentY), width: Math.abs(currentX - start.x), height: Math.abs(currentY - start.y) });
  });

  const finish = async (event) => {
    if (!state.selectionMode || !start) return;
    const bounds = img.getBoundingClientRect();
    const endX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const endY = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    const rect = { x: Math.min(start.x, endX), y: Math.min(start.y, endY), width: Math.abs(endX - start.x), height: Math.abs(endY - start.y) };
    start = null;
    if (rect.width < 12 || rect.height < 12) {
      selectionBox.style.display = 'none';
      return;
    }

    clearSelectionVisuals();
    updateSelectionBox(rect);
    fadeOutSelectionBox(selectionBox);

    const scaleX = img.naturalWidth / bounds.width;
    const scaleY = img.naturalHeight / bounds.height;
    state.selection = {
      imagePath: image.path,
      imageName: image.name,
      rectNatural: {
        x: Math.round(rect.x * scaleX),
        y: Math.round(rect.y * scaleY),
        width: Math.round(rect.width * scaleX),
        height: Math.round(rect.height * scaleY),
      },
      img,
      pageIndex: index + 1,
    };
    state.activeImagePath = image.path;
    renderImages();
    els.selectionInfo.textContent = `已框选：第 ${index + 1} 页，区域 ${state.selection.rectNatural.width}×${state.selection.rectNatural.height}。正在流式分析...`;
    els.analyzeBtn.disabled = false;
    await analyzeCurrentSelection();
  };

  container.addEventListener('pointerup', finish);
  container.addEventListener('pointerleave', (event) => { if (start) finish(event); });
}

function buildPage(image, index) {
  const wrap = document.createElement('div');
  wrap.className = `page ${state.selectionMode ? 'selecting' : ''}`;
  wrap.dataset.imagePath = image.path;
  const inner = document.createElement('div');
  inner.className = 'page-inner';
  const img = document.createElement('img');
  img.src = `/api/image?path=${encodeURIComponent(image.path)}`;
  img.alt = image.name;
  img.loading = state.readerMode === 'scroll' && index > 2 ? 'lazy' : 'eager';
  const selectionBox = document.createElement('div');
  selectionBox.className = 'selection-box';
  inner.append(img, selectionBox);
  wrap.appendChild(inner);
  attachSelectionHandlers(inner, img, image, index);
  return wrap;
}

function buildSpread(images, startIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'spread-wrap';
  const scale = document.createElement('div');
  scale.className = 'spread-scale';
  const inner = document.createElement('div');
  inner.className = 'spread-inner';
  for (let i = 0; i < 2; i++) {
    const image = images[startIndex + i];
    const cell = document.createElement('div');
    cell.className = `spread-cell ${state.selectionMode ? 'selecting' : ''}`;
    if (image) {
      cell.dataset.imagePath = image.path;
      const img = document.createElement('img');
      img.src = `/api/image?path=${encodeURIComponent(image.path)}`;
      img.alt = image.name;
      const selectionBox = document.createElement('div');
      selectionBox.className = 'selection-box';
      cell.append(img, selectionBox);
      attachSelectionHandlers(cell, img, image, startIndex + i);
    } else {
      cell.classList.add('empty');
    }
    inner.appendChild(cell);
  }
  scale.appendChild(inner);
  wrap.appendChild(scale);
  return wrap;
}

function renderReader() {
  els.reader.className = `reader ${state.readerMode}`;
  els.reader.innerHTML = '';
  resetSelectionInfo();
  const images = currentImages();
  if (!images.length) {
    els.reader.innerHTML = '<div class="hint">当前目录没有图片。</div>';
    return;
  }
  if (state.readerMode === 'scroll') {
    images.forEach((image, index) => els.reader.appendChild(buildPage(image, index)));
  } else if (state.readerMode === 'paged') {
    els.reader.appendChild(buildPage(images[state.currentIndex], state.currentIndex));
  } else {
    const startIndex = state.currentIndex % 2 === 0 ? state.currentIndex : state.currentIndex - 1;
    els.reader.appendChild(buildSpread(images, Math.max(0, startIndex)));
  }
  applyZoom();
  updateCurrentPageInfo();
}

function renderAnalysis(result, isStreaming = false) {
  const sections = [];
  if (isStreaming) {
    sections.push('<div class="analysis-section"><h3>流式返回中</h3><div class="hint">内容正在逐步补全...</div></div>');
  }
  sections.push(`<div class="analysis-section"><h3>原文</h3><div>${escapeHtml(result.transcription || '—')}</div></div>`);
  sections.push(`<div class="analysis-section"><h3>中文翻译</h3><div>${escapeHtml(result.translation_zh || '—')}</div></div>`);
  const readingItems = (result.reading_help || []).map((item) => `<li><strong>${escapeHtml(item.text || '')}</strong> · ${escapeHtml(item.reading || '')} · ${escapeHtml(item.meaning_zh || '')}</li>`).join('');
  sections.push(`<div class="analysis-section"><h3>读音 / 词汇</h3>${readingItems ? `<ul>${readingItems}</ul>` : '<div class="hint">无</div>'}</div>`);
  const grammarItems = (result.grammar_points || []).map((item) => `<li><strong>${escapeHtml(item.pattern || '')}</strong>：${escapeHtml(item.explanation_zh || '')}${item.example_from_panel ? `<div class="hint">例：${escapeHtml(item.example_from_panel)}</div>` : ''}</li>`).join('');
  sections.push(`<div class="analysis-section"><h3>语法讲解</h3>${grammarItems ? `<ul>${grammarItems}</ul>` : '<div class="hint">无</div>'}</div>`);
  const jokeItems = (result.jokes_or_context || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  sections.push(`<div class="analysis-section"><h3>梗 / 背景</h3>${jokeItems ? `<ul>${jokeItems}</ul>` : '<div class="hint">无</div>'}</div>`);
  sections.push(`<div class="analysis-section"><h3>置信度</h3><span class="badge">${escapeHtml(result.confidence || 'unknown')}</span></div>`);
  if (result.notes) sections.push(`<div class="analysis-section"><h3>备注</h3><div>${escapeHtml(result.notes)}</div></div>`);
  if (result.raw_text) sections.push(`<div class="analysis-section"><h3>模型原始返回</h3><pre>${escapeHtml(result.raw_text)}</pre></div>`);
  els.analysisResult.classList.remove('empty');
  els.analysisResult.innerHTML = sections.join('');
}

function unescapeJsonString(text) {
  return String(text)
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\')
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\r', '\r');
}

function tryExtractJsonStringField(raw, field) {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"])*)`));
  return match ? unescapeJsonString(match[1]) : '';
}

function tryExtractSimpleField(raw, field) {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"?([A-Za-z0-9_-]+)`));
  return match ? match[1] : '';
}

function tryExtractArrayField(raw, field) {
  const keyIndex = raw.indexOf(`"${field}"`);
  if (keyIndex < 0) return [];
  const start = raw.indexOf('[', keyIndex);
  if (start < 0) return [];
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function partialStructuredResult(raw) {
  return {
    transcription: tryExtractJsonStringField(raw, 'transcription'),
    translation_zh: tryExtractJsonStringField(raw, 'translation_zh'),
    reading_help: tryExtractArrayField(raw, 'reading_help'),
    grammar_points: tryExtractArrayField(raw, 'grammar_points'),
    jokes_or_context: tryExtractArrayField(raw, 'jokes_or_context'),
    confidence: tryExtractSimpleField(raw, 'confidence') || 'streaming',
    notes: tryExtractJsonStringField(raw, 'notes'),
    raw_text: raw,
  };
}

function renderStreamingPreview(text) {
  renderAnalysis(partialStructuredResult(String(text || '')), true);
}

async function cropSelectionToDataUrl() {
  if (!state.selection) throw new Error('没有有效圈选');
  const { img, rectNatural } = state.selection;
  const canvas = document.createElement('canvas');
  canvas.width = rectNatural.width;
  canvas.height = rectNatural.height;
  canvas.getContext('2d').drawImage(img, rectNatural.x, rectNatural.y, rectNatural.width, rectNatural.height, 0, 0, rectNatural.width, rectNatural.height);
  return canvas.toDataURL('image/jpeg', 0.95);
}

async function parseSseResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';
  let finalResponse = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const eventBlock of events) {
      const lines = eventBlock.split(/\r?\n/);
      let eventName = 'message';
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const dataText = dataLines.join('\n');
      if (!dataText) continue;

      let payload;
      try { payload = JSON.parse(dataText); } catch { continue; }

      if (eventName === 'error') throw new Error(payload.error || '流式请求失败');
      if (typeof payload.delta === 'string') {
        streamedText += payload.delta;
        els.streamStatus.textContent = '正在流式接收模型输出...';
        els.streamStatus.classList.add('streaming');
        renderStreamingPreview(streamedText);
      }
      if (typeof payload.text === 'string' && payload.text) {
        streamedText += payload.text;
        renderStreamingPreview(streamedText);
      }
      if (payload.response) finalResponse = payload.response;
    }
  }

  return { streamedText, finalResponse };
}

function extractStructuredResult(streamedText, finalResponse) {
  const finalText = Array.isArray(finalResponse?.output)
    ? finalResponse.output.flatMap((item) => item?.content || []).map((x) => x?.text || '').join('')
    : '';
  const source = String(finalText || streamedText || '');
  try {
    const trimmed = source.trim();
    if (!trimmed) {
      throw new Error('empty response');
    }
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return JSON.parse(match ? match[1] : trimmed);
  } catch (error) {
    const partial = partialStructuredResult(source);
    if (partial.confidence === 'streaming') partial.confidence = 'low';
    partial.notes = partial.notes || `模型返回了非标准 JSON。解析错误：${error.message}`;
    return partial;
  }
}

async function analyzeCurrentSelection() {
  if (!state.selection || state.analyzing) return;
  state.analyzing = true;
  state.streamText = '';
  els.analyzeBtn.disabled = true;
  els.streamStatus.textContent = '正在建立流式连接...';
  els.streamStatus.classList.add('streaming');
  renderStreamingPreview('');

  try {
    const imageDataUrl = await cropSelectionToDataUrl();
    const response = await fetch('/api/analyze-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl,
        settings: {
          apiKey: els.apiKeyInput.value.trim(),
          model: els.modelInput.value.trim(),
          baseUrl: els.baseUrlInput.value.trim(),
          reasoningEffort: els.reasoningEffortSelect.value,
        },
        pageMeta: {
          bookPath: state.currentPath,
          imagePath: state.selection.imagePath,
          imageName: state.selection.imageName,
          pageIndex: state.selection.pageIndex,
          rect: state.selection.rectNatural,
          readerMode: state.readerMode,
          zoomPercent: state.zoomPercent,
        },
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `请求失败: ${response.status}`);
    }

    const { streamedText, finalResponse } = await parseSseResponse(response);
    const result = extractStructuredResult(streamedText, finalResponse);
    renderAnalysis(result);
    els.streamStatus.textContent = '流式分析完成';
    els.streamStatus.classList.remove('streaming');
    els.selectionInfo.textContent = `已完成：第 ${state.selection.pageIndex} 页框选分析。`;
  } catch (error) {
    els.streamStatus.textContent = '';
    els.analysisResult.innerHTML = `<div class="hint">分析失败：${escapeHtml(error.message)}</div>`;
    els.selectionInfo.textContent = `分析失败：${error.message}`;
  } finally {
    state.analyzing = false;
    els.analyzeBtn.disabled = !state.selection;
    saveSettings();
  }
}

function syncModeButtons() {
  for (const btn of els.modeBtns) btn.classList.toggle('active', btn.dataset.mode === state.readerMode);
  const modeText = state.readerMode === 'scroll' ? '纵向滚动' : state.readerMode === 'paged' ? '单页翻页' : '双页模式';
  els.readerModeHint.textContent = `当前：${modeText}`;
}

function setReaderMode(mode) {
  state.readerMode = mode;
  if (mode === 'spread' && state.currentIndex % 2 === 1) state.currentIndex -= 1;
  syncModeButtons();
  renderReader();
  renderImages();
  saveSettings();
  schedulePersistReadingProgress();
}

els.openRootBtn.onclick = () => openDirectory(els.rootPathInput.value.trim());
els.goParentBtn.onclick = () => { if (state.listing?.parent) openDirectory(state.listing.parent); };
els.refreshBtn.onclick = () => openDirectory(state.currentPath || els.rootPathInput.value.trim());
els.recentBooksBtn.onclick = openRecentBooksModal;
els.closeRecentBooksBtn.onclick = closeRecentBooksModal;
els.recentBooksModal.addEventListener('click', (event) => {
  if (event.target.dataset.closeModal === 'recent') closeRecentBooksModal();
});
els.toggleSelectionBtn.onclick = () => {
  state.selectionMode = !state.selectionMode;
  els.toggleSelectionBtn.textContent = `圈选翻译：${state.selectionMode ? '开' : '关'}`;
  resetSelectionInfo();
  renderReader();
};
els.analyzeBtn.onclick = analyzeCurrentSelection;
els.prevPageBtn.onclick = () => jumpToIndex(state.readerMode === 'spread' ? state.currentIndex - 2 : state.currentIndex - 1);
els.nextPageBtn.onclick = () => jumpToIndex(state.readerMode === 'spread' ? state.currentIndex + 2 : state.currentIndex + 1);
els.zoomRange.oninput = (event) => { state.zoomPercent = Number(event.target.value); applyZoom(); saveSettings(); };
els.zoomOutBtn.onclick = () => stepZoom(-10);
els.zoomInBtn.onclick = () => stepZoom(10);
for (const btn of els.modeBtns) btn.onclick = () => setReaderMode(btn.dataset.mode);
for (const input of [els.apiKeyInput, els.modelInput, els.baseUrlInput, els.reasoningEffortSelect]) input.addEventListener('change', saveSettings);
window.addEventListener('resize', applyZoom);
els.reader.addEventListener('scroll', syncCurrentIndexFromScroll);
document.addEventListener('keydown', (event) => {
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
  if (event.key === 'ArrowLeft') els.prevPageBtn.click();
  if (event.key === 'ArrowRight') els.nextPageBtn.click();
  if (event.key === '+' || event.key === '=') els.zoomInBtn.click();
  if (event.key === '-') els.zoomOutBtn.click();
});

await loadSettings();
els.toggleSelectionBtn.textContent = `圈选翻译：${state.selectionMode ? '开' : '关'}`;
openDirectory(await resolveInitialDirectory());
