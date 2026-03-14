import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const codexConfigPath = 'C:\\Users\\Administrator\\.codex\\config.toml';
const localAppConfigPath = path.join(__dirname, 'app.config.json');
const preferredPort = Number(process.env.PORT || 3321);
const host = process.env.HOST || '127.0.0.1';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function isWindowsAbsolute(inputPath) {
  return /^[a-zA-Z]:\\/.test(inputPath);
}

function normalizeUserPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') throw new Error('路径不能为空');
  const trimmed = inputPath.trim().replaceAll('/', '\\');
  if (!isWindowsAbsolute(trimmed) && !trimmed.startsWith('\\\\')) {
    throw new Error('请提供 Windows 本地绝对路径，例如 B:\\comic\\book');
  }
  return path.normalize(trimmed);
}

async function pathInfo(targetPath) {
  const stat = await fs.stat(targetPath);
  return {
    path: targetPath,
    name: path.basename(targetPath),
    type: stat.isDirectory() ? 'directory' : 'file',
  };
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export async function listDirectory(targetPath) {
  const normalized = normalizeUserPath(targetPath);
  const stat = await fs.stat(normalized);
  if (!stat.isDirectory()) throw new Error('目标路径不是文件夹');

  const dirents = await fs.readdir(normalized, { withFileTypes: true });
  const directories = [];
  const images = [];

  for (const dirent of dirents) {
    const childPath = path.join(normalized, dirent.name);
    if (dirent.isDirectory()) directories.push({ name: dirent.name, path: childPath, kind: 'directory' });
    else if (dirent.isFile() && IMAGE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
      images.push({ name: dirent.name, path: childPath, kind: 'image' });
    }
  }

  directories.sort((a, b) => naturalSort(a.name, b.name));
  images.sort((a, b) => naturalSort(a.name, b.name));

  return {
    current: await pathInfo(normalized),
    parent: path.dirname(normalized) !== normalized ? path.dirname(normalized) : null,
    directories,
    images,
  };
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(publicDir, path.normalize(safePath).replace(/^([.][.][\\/])+/, ''));
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, 'Forbidden');

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypeForFile(filePath) });
    res.end(data);
  } catch {
    sendText(res, 404, 'Not Found');
  }
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function extractTextFromResponsesPayload(payload) {
  const texts = [];

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content === 'string') texts.push(content);
      if (typeof content?.text === 'string') texts.push(content.text);
      if (typeof content?.output_text === 'string') texts.push(content.output_text);
      if (typeof content?.content === 'string') texts.push(content.content);
    }
  }

  for (const choice of payload.choices || []) {
    const message = choice.message || {};
    if (typeof message.content === 'string' && message.content.trim()) texts.push(message.content);
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (typeof part === 'string') texts.push(part);
        else if (typeof part?.text === 'string') texts.push(part.text);
      }
    }
    if (typeof choice.text === 'string' && choice.text.trim()) texts.push(choice.text);
  }

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (typeof message?.content === 'string') texts.push(message.content);
    }
  }

  if (texts.length) return texts.join('\n').trim();
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text;
  if (typeof payload.content === 'string' && payload.content.trim()) return payload.content;
  return '';
}

function parseLooseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return JSON.parse(match[1]);
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    throw new Error('模型返回了非 JSON 内容');
  }
}

function parseSsePayload(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return {};

  const lines = trimmed.split(/\r?\n/);
  const deltas = [];
  let finalResponse = null;

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const dataText = line.slice(5).trim();
    if (!dataText || dataText === '[DONE]') continue;

    try {
      const event = JSON.parse(dataText);
      if (typeof event?.delta === 'string' && event.delta) deltas.push(event.delta);
      if (event?.response) finalResponse = event.response;
      if (typeof event?.text === 'string' && event.text) deltas.push(event.text);
    } catch {
      // ignore malformed chunk
    }
  }

  if (finalResponse) return { output: finalResponse.output || [], response: finalResponse };
  if (deltas.length) return { output_text: deltas.join('') };
  return {};
}

async function readLocalAppConfig() {
  const defaults = {
    persistence: {
      enabled: true,
      noteRootDir: 'B:\\nihongo_note\\raw',
    },
  };

  try {
    const raw = await fs.readFile(localAppConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      persistence: {
        enabled: parsed?.persistence?.enabled ?? defaults.persistence.enabled,
        noteRootDir: parsed?.persistence?.noteRootDir || defaults.persistence.noteRootDir,
      },
    };
  } catch {
    return defaults;
  }
}

function normalizeAnalyzeResultFromText(text) {
  try {
    return parseLooseJson(text);
  } catch (error) {
    return {
      transcription: '',
      translation_zh: '',
      reading_help: [],
      grammar_points: [],
      jokes_or_context: [],
      confidence: 'low',
      notes: `模型返回了非标准 JSON，已原样保存在下方。解析错误：${error.message}`,
      raw_text: String(text || '').trim(),
    };
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getLocalDateParts(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return {
    monthKey: `${year}_${month}`,
    dayKey: `${year}_${month}_${day}`,
    timestamp: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
  };
}

function mdEscape(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

function formatReadingHelp(items) {
  if (!Array.isArray(items) || !items.length) return '- 无\n';
  return items.map((item) => {
    const text = mdEscape(item?.text || '');
    const reading = mdEscape(item?.reading || '');
    const meaning = mdEscape(item?.meaning_zh || '');
    return `- **${text || '（空）'}**${reading ? `（${reading}）` : ''}${meaning ? `：${meaning}` : ''}`;
  }).join('\n') + '\n';
}

function formatGrammarPoints(items) {
  if (!Array.isArray(items) || !items.length) return '- 无\n';
  return items.map((item) => {
    const pattern = mdEscape(item?.pattern || '');
    const explanation = mdEscape(item?.explanation_zh || '');
    const example = mdEscape(item?.example_from_panel || '');
    return [
      `- **${pattern || '（未命名语法点）'}**：${explanation || '—'}`,
      example ? `  - 例句：${example}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n') + '\n';
}

function formatJokesOrContext(items) {
  if (!Array.isArray(items) || !items.length) return '- 无\n';
  return items.map((item) => `- ${mdEscape(item) || '（空）'}`).join('\n') + '\n';
}

function buildNoteMarkdown(result, pageMeta, savedAt) {
  const lines = [
    '',
    '---',
    `- saved_at: ${savedAt.timestamp}`,
    `- image_path: ${mdEscape(pageMeta?.imagePath || '')}`,
    `- page_index: ${pageMeta?.pageIndex ?? ''}`,
    `- confidence: ${mdEscape(result?.confidence || '')}`,
    `- rect: \`${JSON.stringify(pageMeta?.rect || {})}\``,
    '',
    '## 读音 / 词汇',
    formatReadingHelp(result?.reading_help),
    '## 语法讲解',
    formatGrammarPoints(result?.grammar_points),
    '## 梗 / 背景',
    formatJokesOrContext(result?.jokes_or_context),
  ];

  const notes = mdEscape(result?.notes || '');
  if (notes) lines.push('', '## 备注', notes);

  const rawText = mdEscape(result?.raw_text || '');
  if (rawText) lines.push('', '## 模型原始返回', '```', rawText, '```');

  lines.push('');
  return lines.join('\n');
}

async function appendAnalysisNote(result, pageMeta, noteRootDir) {
  const savedAt = getLocalDateParts();
  const monthDir = path.join(noteRootDir, savedAt.monthKey);
  const noteFile = path.join(monthDir, `${savedAt.dayKey}.md`);
  await fs.mkdir(monthDir, { recursive: true });
  await fs.appendFile(noteFile, buildNoteMarkdown(result, pageMeta, savedAt), 'utf8');
  return noteFile;
}

async function persistAnalysisNote(result, pageMeta) {
  try {
    const appConfig = await readLocalAppConfig();
    if (!appConfig.persistence.enabled) return;
    await appendAnalysisNote(result, pageMeta, normalizeUserPath(appConfig.persistence.noteRootDir));
  } catch (error) {
    console.error(`Failed to persist analysis note: ${error.message || error}`);
  }
}

async function readCodexConfig() {
  try {
    const raw = await fs.readFile(codexConfigPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const parsed = {};
    let section = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
      if (!kvMatch) continue;
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      const target = section ? (parsed[section] ||= {}) : parsed;
      target[key] = value;
    }

    const providerName = parsed.model_provider || '';
    const providerSection = providerName ? parsed[`model_providers.${providerName}`] : null;
    const envKeyName = providerSection?.env_key || 'OPENAI_API_KEY';

    return {
      model: parsed.model || '',
      modelProvider: providerName,
      baseUrl: providerSection?.base_url || '',
      wireApi: providerSection?.wire_api || 'responses',
      envKeyName,
      hasServerApiKey: Boolean(process.env[envKeyName] || process.env.OPENAI_API_KEY),
    };
  } catch {
    return {
      model: process.env.OPENAI_MODEL || '',
      modelProvider: '',
      baseUrl: process.env.OPENAI_BASE_URL || '',
      wireApi: 'responses',
      envKeyName: 'OPENAI_API_KEY',
      hasServerApiKey: Boolean(process.env.OPENAI_API_KEY),
    };
  }
}

async function buildAnalyzeContext(body) {
  const { imageDataUrl, settings, pageMeta } = body;
  if (!imageDataUrl || typeof imageDataUrl !== 'string') throw new Error('缺少圈选图片数据');

  const codexConfig = await readCodexConfig();
  const serverSideApiKey = process.env[codexConfig.envKeyName] || process.env.OPENAI_API_KEY;
  const apiKey = settings?.apiKey || serverSideApiKey;
  const model = settings?.model || codexConfig.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const baseUrl = (settings?.baseUrl || codexConfig.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error(`未提供 API Key。请在界面里填写，或设置 ${codexConfig.envKeyName} / OPENAI_API_KEY 环境变量。`);
  }

  const prompt = `你是一个面向中文母语日语初学者的漫画讲解老师。\n请阅读这张漫画局部截图，并严格输出 JSON。\n\n输出字段要求：\n{\n  "transcription": "尽量完整抄写图中的日文原文；看不清就标注不确定部分",\n  "translation_zh": "自然中文翻译",\n  "reading_help": [\n    {"text": "原词", "reading": "平假名读音", "meaning_zh": "中文义"}\n  ],\n  "grammar_points": [\n    {"pattern": "语法/表达", "explanation_zh": "中文解释", "example_from_panel": "图中的相关片段"}\n  ],\n  "jokes_or_context": ["梗、文化背景、角色语气或双关说明；没有就返回空数组"],\n  "confidence": "high|medium|low",\n  "notes": "如果有看不清、拟声词、断句不确定，就写这里"\n}\n\n要求：\n- reading_help 优先列出对初学者最关键的汉字词、口语缩略、拟声词。\n- grammar_points 用最适合初学者的中文解释。\n- 如果文本很少，也要尽量解释语气。\n- 只输出 JSON，不要输出任何额外说明。\n- 页面信息：${JSON.stringify(pageMeta || {}, null, 2)}`;

  const requestBody = {
    model,
    stream: true,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: imageDataUrl },
    ] }],
    max_output_tokens: 1400,
  };

  if (settings?.reasoningEffort && settings.reasoningEffort !== 'default' && /^(gpt-5|o)/i.test(model)) {
    requestBody.reasoning = { effort: settings.reasoningEffort };
  }

  return {
    apiUrl: `${baseUrl}/responses`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    requestBody,
    pageMeta: pageMeta || {},
  };
}

export async function analyzeSelection(body) {
  const ctx = await buildAnalyzeContext(body);
  const response = await fetch(ctx.apiUrl, {
    method: 'POST',
    headers: ctx.headers,
    body: JSON.stringify(ctx.requestBody),
  });

  const responseContentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  const payload = responseContentType.includes('text/event-stream')
    ? parseSsePayload(rawBody)
    : (rawBody ? JSON.parse(rawBody) : {});

  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI API 调用失败 (${response.status})`);

  const text = extractTextFromResponsesPayload(payload);
  if (!text) {
    const payloadKeys = Object.keys(payload || {}).slice(0, 12).join(', ') || '(empty)';
    throw new Error(`模型没有返回可解析内容。返回字段: ${payloadKeys}`);
  }

  const result = normalizeAnalyzeResultFromText(text);
  await persistAnalysisNote(result, ctx.pageMeta);
  return result;
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/list') {
      return sendJson(res, 200, await listDirectory(url.searchParams.get('path')));
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, await readCodexConfig());
    }

    if (req.method === 'GET' && url.pathname === '/api/image') {
      const targetPath = normalizeUserPath(url.searchParams.get('path'));
      if (!IMAGE_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) return sendText(res, 400, 'Not an image');
      const stat = await fs.stat(targetPath);
      if (!stat.isFile()) return sendText(res, 404, 'Not Found');
      const data = await fs.readFile(targetPath);
      res.writeHead(200, { 'Content-Type': contentTypeForFile(targetPath), 'Cache-Control': 'no-store' });
      return res.end(data);
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      return sendJson(res, 200, await analyzeSelection(await readRequestBody(req)));
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze-stream') {
      const body = await readRequestBody(req);
      const ctx = await buildAnalyzeContext(body);
      const upstream = await fetch(ctx.apiUrl, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(ctx.requestBody),
      });

      if (!upstream.ok) {
        const raw = await upstream.text();
        let message = `OpenAI API 调用失败 (${upstream.status})`;
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          message = parsed?.error?.message || message;
        } catch {}
        res.writeHead(500, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        return res.end();
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });

      const chunks = [];
      for await (const chunk of upstream.body) {
        chunks.push(Buffer.from(chunk));
        res.write(chunk);
      }
      res.end();

      const rawSse = Buffer.concat(chunks).toString('utf8');
      const payload = parseSsePayload(rawSse);
      const text = extractTextFromResponsesPayload(payload);
      if (text) {
        const result = normalizeAnalyzeResultFromText(text);
        await persistAnalysisNote(result, ctx.pageMeta);
      }
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '服务器错误' });
  }
});

async function startServerWithFallback() {
  const candidatePorts = [preferredPort, 3322, 3323, 3325, 8080, 8787, 9000];
  let lastError = null;

  for (const port of candidatePorts) {
    const started = await new Promise((resolve) => {
      const onError = (error) => {
        server.off('listening', onListening);
        resolve({ ok: false, error, port });
      };
      const onListening = () => {
        server.off('error', onError);
        resolve({ ok: true, port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

    if (started.ok) {
      console.log(`Manga translator app running at http://${host}:${started.port}`);
      console.log(`If you want a fixed port, run: $env:PORT=${started.port}; npm start`);
      return;
    }

    lastError = started.error;
    if (!['EACCES', 'EADDRINUSE'].includes(started.error?.code)) throw started.error;
  }

  throw new Error(`无法监听本地端口。已尝试: ${candidatePorts.join(', ')}。最后错误: ${lastError?.code || 'UNKNOWN'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServerWithFallback().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
