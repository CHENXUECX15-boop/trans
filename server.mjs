import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(getArgValue("--port") || process.env.PORT || 8787);
const cache = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];

    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }

    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }

    return match;
  });
}

function htmlToText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h1|h2|h3|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

function clip(value, limit = 180) {
  const text = cleanLine(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function extractTitle(html, fallback) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanLine(htmlToText(match[1])) : fallback;
}

function extractEudicLines(text) {
  const flatText = cleanLine(text);
  const partOfSpeech = "abbr|adj|adv|art|aux|conj|int|n|num|prep|pron|vt|vi|v";
  const firstDefinition = flatText.search(new RegExp(`\\b1\\.\\s*(?:${partOfSpeech})\\.?\\s`, "i"));
  let section = firstDefinition >= 0
    ? flatText.slice(firstDefinition, firstDefinition + 1600)
    : flatText.slice(0, 1800);
  const stopWords = ["时 态", "近义、反义", "英语例句库", "声明：", "译 历史记录"];

  for (const word of stopWords) {
    const index = section.indexOf(word);
    if (index > 0) {
      section = section.slice(0, index);
    }
  }

  const definitionPattern = new RegExp(
    `(\\d+\\.\\s*(?:${partOfSpeech})\\.?\\s*.*?)(?=\\s+\\d+\\.\\s*(?:${partOfSpeech})\\.?\\s|\\s+时\\s*态|\\s+近义|\\s+英语例句库|$)`,
    "gi"
  );

  const matches = [...section.matchAll(definitionPattern)]
    .map((match) => clip(match[1], 160))
    .filter((line) => line.length > 4);

  if (matches.length) {
    return [...new Set(matches)].slice(0, 8);
  }

  return section
    .split("\n")
    .map((line) => clip(line, 160))
    .filter((line) => /^\d+\./.test(line))
    .slice(0, 8);
}

function normalizeEudicImageWords(html) {
  return html
    .replace(/<img[^>]+src=["'][^"']*7SBdO@i6H7dfMe1C@@1m6IGDCVuQ=[^"']*["'][^>]*>/gi, "细")
    .replace(/<img[^>]+class=["'][^"']*dictimgtoword[^"']*["'][^>]*>/gi, "□");
}

function extractEudicLinesFromHtml(html) {
  const blockMatch = html.match(/<div\s+id=["']ExpFCchild["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div\s+id=["']ExpSYN/i)
    || html.match(/<div\s+id=["']ExpFCchild["'][\s\S]*?(?:<div\s+id=["']trans["']|<\/ol>)/i);
  if (!blockMatch) return [];

  const block = normalizeEudicImageWords(blockMatch[1] || blockMatch[0]);
  const listItems = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match, index) => `${index + 1}. ${clip(htmlToText(match[1]), 150)}`)
    .filter((line) => line.length > 4)
    .slice(0, 8);

  if (listItems.length) {
    return listItems;
  }

  const directText = cleanLine(htmlToText(block)).replace(/\[([^\]]+)\]/g, "$1");
  return directText ? [`1. ${clip(directText, 150)}`] : [];
}

function nearbySnippet(text, term) {
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const index = lowerText.indexOf(lowerTerm);

  if (index < 0) {
    return clip(text, 500);
  }

  const start = Math.max(0, index - 220);
  const end = Math.min(text.length, index + term.length + 420);
  return clip(text.slice(start, end), 650);
}

async function fetchText(url) {
  if (cache.has(url)) {
    return cache.get(url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 local medical terminology lookup",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
      }
    });

    if (!response.ok) {
      throw new Error(`远程站点返回 ${response.status}`);
    }

    const text = await response.text();
    cache.set(url, text);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchForm(url, data, referer) {
  const cacheKey = `POST:${url}:${data.toString()}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      body: data,
      headers: {
        "User-Agent": "Mozilla/5.0 local medical terminology lookup",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer
      }
    });

    if (!response.ok) {
      throw new Error(`远程站点返回 ${response.status}`);
    }

    const text = await response.text();
    cache.set(cacheKey, text);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function extractEudicStatus(html) {
  const match = html.match(/id=["']page-status["'][^>]*value=["']([^"']+)["']/i);
  return match ? decodeHtml(match[1]) : "";
}

function extractZhwikiFirstParagraph(html) {
  const contentMatch = html.match(/<div\s+id=["']mw-content-text-zh["'][^>]*>([\s\S]*?)(?:<h2\b|<\/div>\s*<\/div>\s*$)/i);
  const content = contentMatch ? contentMatch[1] : html;
  const paragraphMatch = content.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);

  if (!paragraphMatch) {
    return "";
  }

  return normalizeChineseParagraph(htmlToText(paragraphMatch[1]));
}

function normalizeChineseParagraph(text) {
  let compacted = cleanLine(text)
    .replace(/\s+([，。；：、！？）])/g, "$1")
    .replace(/([，。；：、！？（])\s+/g, "$1")
    .replace(/（\s+/g, "（")
    .replace(/\s+）/g, "）")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/([\u4e00-\u9fff])\s+([A-Za-z0-9（])/g, "$1$2")
    .replace(/([A-Za-z0-9）])\s+([\u4e00-\u9fff])/g, "$1$2")
    .trim();

  let previous = "";
  while (previous !== compacted) {
    previous = compacted;
    compacted = compacted
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
      .replace(/([，。；：、！？（])\s+/g, "$1");
  }

  return compacted;
}

function extractZhwikiTitle(html, fallback) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? cleanLine(htmlToText(match[1])) : fallback;
}

async function lookupEudicZhwiki(term, pageHtml, pageUrl) {
  const status = extractEudicStatus(pageHtml);
  if (!status) {
    return null;
  }

  const tabUrl = "https://dict.eudic.net/Dicts/en/tab-detail/zhwiki";
  const html = await fetchForm(tabUrl, new URLSearchParams({ status }), pageUrl);
  const paragraph = extractZhwikiFirstParagraph(html);

  if (!paragraph) {
    return null;
  }

  const title = extractZhwikiTitle(html, term);
  return {
    source: "eudic",
    term,
    url: pageUrl,
    title: `欧路中文百科：${title}`,
    statusText: "已摘录欧路词典“中文百科”第一段。",
    summary: paragraph,
    lines: [paragraph],
    note: "内容来自欧路词典页面的中文百科标签；可用右上角备用入口核对原页面。"
  };
}

async function lookupEudic(term) {
  const url = `https://dict.eudic.net/dicts/en/${encodeURIComponent(term)}`;
  const html = await fetchText(url);
  const zhwiki = await lookupEudicZhwiki(term, html, url);
  if (zhwiki) {
    return zhwiki;
  }

  const text = htmlToText(html);
  const lines = extractEudicLinesFromHtml(html);
  const fallbackLines = lines.length ? lines : extractEudicLines(text);
  const displayLines = fallbackLines.length ? fallbackLines : [];
  const summary = displayLines.join("\n") || nearbySnippet(text, term);

  return {
    source: "eudic",
    term,
    url,
    title: extractTitle(html, `欧路词典：${term}`),
    statusText: displayLines.length ? "已从欧路公开词条页提取释义。" : "已连接欧路，但没有识别到标准释义区。",
    summary,
    lines: displayLines.length ? displayLines : [summary],
    note: "若提取不完整，可用右上角备用入口核对原页面。"
  };
}

async function lookupCnki(term) {
  const url = `http://dict.cnki.net/dict_result.aspx?searchword=${encodeURIComponent(term)}`;
  let html = "";

  try {
    html = await fetchText(url);
  } catch (error) {
    return {
      source: "cnki",
      term,
      url,
      title: "CNKI 翻译助手",
      statusText: "CNKI 当前公开接口没有返回可直接提取的词条结果。",
      summary: "请使用右上角备用入口或 CNKI 页面内搜索框检索该术语，再把译法粘贴到 CNKI 文本框。",
      lines: ["CNKI 旧版直达接口不可用。", `检索词：${term}`],
      note: error.message ? `远程站点响应：${error.message}` : "CNKI 站点会按地区和版本跳转。"
    };
  }

  const text = htmlToText(html);
  const overseasHome = /Global Academic Insights|CNKI Overseas/i.test(text);
  const snippet = nearbySnippet(text, term);

  if (overseasHome) {
    return {
      source: "cnki",
      term,
      url,
      title: "CNKI 翻译助手",
      statusText: "CNKI 当前公开入口没有返回可稳定提取的旧版词条结果。",
      summary: "请使用右上角备用入口或 CNKI 页面内搜索框检索该术语，再把译法粘贴到 CNKI 文本框。",
      lines: ["公开入口未返回词条结果。", `检索词：${term}`],
      note: "CNKI 站点会按地区和版本跳转，旧版直达地址可能失效。"
    };
  }

  return {
    source: "cnki",
    term,
    url,
    title: extractTitle(html, `CNKI 翻译助手：${term}`),
    statusText: "已连接 CNKI 并提取页面文本片段。",
    summary: snippet,
    lines: [snippet],
    note: "请与 CNKI 原页面核对后再采用。"
  };
}

async function lookup(source, term) {
  if (source === "eudic") return lookupEudic(term);
  if (source === "cnki") return lookupCnki(term);
  throw new Error("不支持的来源。");
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const resolvedPath = path.resolve(rootDir, relativePath);

  if (!resolvedPath.startsWith(rootDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(resolvedPath);
    const type = contentTypes[path.extname(resolvedPath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "medical-translator", port });
    return;
  }

  if (url.pathname === "/api/lookup") {
    const source = url.searchParams.get("source") || "";
    const term = (url.searchParams.get("term") || "").trim();

    if (!term) {
      sendJson(response, 400, { error: "缺少查询词。" });
      return;
    }

    try {
      const result = await lookup(source, term);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 502, {
        error: error.name === "AbortError" ? "查询超时。" : error.message || "查询失败。"
      });
    }
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  await serveStatic(request, response, url.pathname);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Medical translator running at http://127.0.0.1:${port}`);
});
