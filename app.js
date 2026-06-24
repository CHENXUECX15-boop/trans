const SOURCES = {
  eudic: {
    label: "欧路词典",
    mode: "url",
    url(term) {
      return `https://dict.eudic.net/dicts/en/${encodeURIComponent(term)}`;
    },
    cite(term) {
      return `欧路词典：${this.url(term)}`;
    }
  },
  xiangya: {
    label: "湘雅医学专业词典",
    mode: "manual",
    cite() {
      return "湘雅医学专业词典：按自有纸本/离线词库版本核对。";
    }
  },
  cnki: {
    label: "CNKI 翻译助手",
    mode: "url",
    url(term) {
      const legacy = `http://dict.cnki.net/dict_result.aspx?searchword=${encodeURIComponent(term)}`;
      return legacy;
    },
    fallback: "https://dict.cnki.net/index/",
    cite(term) {
      return `CNKI 翻译助手：${this.url(term)}；入口页：https://dict.cnki.net/index/`;
    }
  },
  "medical-sea": {
    label: "英中医学辞海",
    mode: "manual",
    cite() {
      return "王贤才等：《英中医学辞海》，1989。";
    }
  }
};

const STORAGE_KEY = "medical-translator-source-data-v1";

const termInput = document.querySelector("#termInput");
const queryAllButton = document.querySelector("#queryAllButton");
const copyTermButton = document.querySelector("#copyTermButton");
const clearButton = document.querySelector("#clearButton");
const csvInput = document.querySelector("#csvInput");
const summarizeButton = document.querySelector("#summarizeButton");
const bestTranslation = document.querySelector("#bestTranslation");
const sourceComparison = document.querySelector("#sourceComparison");
const citationOutput = document.querySelector("#citationOutput");
const copySummaryButton = document.querySelector("#copySummaryButton");
const toast = document.querySelector("#toast");

const inlineResults = {
  eudic: document.querySelector("#eudicResult"),
  cnki: document.querySelector("#cnkiResult")
};

const apiOrigin = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "";

let importedRows = loadRows();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function getTerm() {
  return termInput.value.trim();
}

function getTextArea(sourceId) {
  return document.querySelector(`[data-note="${sourceId}"]`);
}

function loadRows() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRows() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(importedRows));
}

function getResultCard(sourceId) {
  return document.querySelector(`.inline-frame-card[data-source="${sourceId}"]`);
}

function setResultLink(sourceId, url) {
  const card = getResultCard(sourceId);
  const link = card?.querySelector("[data-result-link]");

  if (link) {
    link.href = url;
  }
}

function setInlineLoading(sourceId, label) {
  const panel = inlineResults[sourceId];
  if (!panel) return;

  panel.className = "live-result is-loading";
  panel.textContent = `正在查询${label}...`;
}

function renderInlineMessage(sourceId, message, state = "is-empty") {
  const panel = inlineResults[sourceId];
  if (!panel) return;

  panel.className = `live-result ${state}`;
  panel.textContent = message;
}

function renderLookupResult(sourceId, result) {
  const panel = inlineResults[sourceId];
  const card = document.querySelector(`.inline-frame-card[data-source="${sourceId}"]`);

  if (!panel || !card) return;

  panel.className = "live-result";
  panel.innerHTML = "";

  const status = document.createElement("div");
  status.className = "lookup-status";
  status.textContent = result.statusText || "已获取结果";

  const title = document.createElement("div");
  title.className = "lookup-title";
  title.textContent = result.title || SOURCES[sourceId].label;

  const list = document.createElement("ul");
  list.className = "result-lines";

  const lines = result.lines?.length ? result.lines : [result.summary || "没有提取到可直接显示的词条内容。"];
  lines.forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  });

  panel.append(status, title, list);

  if (result.note) {
    const note = document.createElement("p");
    note.className = "result-note";
    note.textContent = result.note;
    panel.append(note);
  }
}

function resetInlineResults() {
  Object.entries(inlineResults).forEach(([sourceId, panel]) => {
    if (!panel) return;
    panel.className = "live-result is-empty";
    panel.textContent = sourceId === "eudic"
      ? "输入术语后点击“查询全部”，欧路中文百科第一段会显示在这里。"
      : "输入术语后点击“查询全部”，CNKI 可获取的入口或提示会显示在这里。";
  });
}

async function lookupOnlineSource(sourceId) {
  const source = SOURCES[sourceId];
  const term = getTerm();
  const url = source.url(term);
  setResultLink(sourceId, url);
  setInlineLoading(sourceId, source.label);

  try {
    const response = await fetch(`${apiOrigin}/api/lookup?source=${encodeURIComponent(sourceId)}&term=${encodeURIComponent(term)}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "查询失败。");
    }

    renderLookupResult(sourceId, result);

    const textArea = getTextArea(sourceId);
    if (result.summary && textArea && !textArea.value.trim()) {
      textArea.value = result.summary;
      summarize();
    }
  } catch (error) {
    const serverHint = apiOrigin
      ? "请先双击 start-server.bat，或打开 http://127.0.0.1:8787 后再查询。"
      : "请确认本地查询服务正在运行。";
    renderInlineMessage(sourceId, `${error.message || "无法获取结果。"} ${serverHint}`, "is-error");
  }
}

function openSource(sourceId) {
  const source = SOURCES[sourceId];
  const term = getTerm();

  if (!term) {
    showToast("请先输入要查询的术语。");
    termInput.focus();
    return;
  }

  if (source.mode === "manual") {
    navigator.clipboard?.writeText(term);
    showToast(`已复制“${term}”，请在${source.label}中检索后粘贴译法。`);
    getTextArea(sourceId)?.focus();
    return;
  }

  lookupOnlineSource(sourceId);

  if (source.fallback) {
    window.setTimeout(() => {
      showToast("CNKI 若没有公开词条结果，会在下方显示可用入口提示。");
    }, 500);
  }
}

function openAllSources() {
  const term = getTerm();
  if (!term) {
    showToast("请先输入要查询的术语。");
    termInput.focus();
    return;
  }

  fillFromImported(term);
  Object.entries(SOURCES).forEach(([sourceId, source]) => {
    if (source.mode === "url") {
      lookupOnlineSource(sourceId);
    }
  });
  navigator.clipboard?.writeText(term);
  showToast("已在下方显示在线查询结果，并复制词条给纸本词典使用。");
  summarize();
  document.querySelector("#inlineResults")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function parseDelimited(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeSource(value) {
  const raw = value.trim().toLowerCase();
  const aliases = {
    "欧路": "eudic",
    "欧路词典": "eudic",
    "eudic": "eudic",
    "湘雅": "xiangya",
    "湘雅医学专业词典": "xiangya",
    "xiangya": "xiangya",
    "cnki": "cnki",
    "知网": "cnki",
    "cnki 翻译助手": "cnki",
    "英中医学辞海": "medical-sea",
    "medical-sea": "medical-sea",
    "medical sea": "medical-sea"
  };
  return aliases[raw] || raw;
}

function rowsFromFile(text) {
  const table = parseDelimited(text);
  if (table.length < 2) return [];

  const headers = table[0].map((header) => header.trim().toLowerCase());
  const termIndex = headers.indexOf("term");
  const sourceIndex = headers.indexOf("source");
  const translationIndex = headers.indexOf("translation");
  const noteIndex = headers.indexOf("note");

  if ([termIndex, sourceIndex, translationIndex].includes(-1)) {
    throw new Error("CSV 需要包含 term, source, translation 三列。");
  }

  return table.slice(1).map((row) => ({
    term: row[termIndex] || "",
    source: normalizeSource(row[sourceIndex] || ""),
    translation: row[translationIndex] || "",
    note: noteIndex >= 0 ? row[noteIndex] || "" : ""
  })).filter((row) => row.term && SOURCES[row.source] && row.translation);
}

function fillFromImported(term) {
  const normalizedTerm = term.trim().toLowerCase();
  const exactRows = importedRows.filter((row) => row.term.trim().toLowerCase() === normalizedTerm);

  exactRows.forEach((row) => {
    const textArea = getTextArea(row.source);
    const value = [row.translation, row.note].filter(Boolean).join("\n");
    textArea.value = textArea.value.trim() ? `${textArea.value.trim()}\n${value}` : value;
  });

  if (exactRows.length) {
    showToast(`已从导入词库填入 ${exactRows.length} 条记录。`);
  }
}

function splitCandidates(text) {
  return text
    .split(/[\n;；,，、/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 40)
    .filter((part) => !/^https?:\/\//i.test(part));
}

function collectNotes() {
  return Object.entries(SOURCES).map(([id, source]) => {
    const text = getTextArea(id).value.trim();
    return {
      id,
      label: source.label,
      text,
      candidates: splitCandidates(text)
    };
  });
}

function rankCandidates(notes) {
  const scores = new Map();

  notes.forEach((note) => {
    const unique = new Set(note.candidates);
    unique.forEach((candidate) => {
      const current = scores.get(candidate) || { text: candidate, count: 0, sources: [] };
      current.count += 1;
      current.sources.push(note.label);
      scores.set(candidate, current);
    });
  });

  return [...scores.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.text.length - b.text.length;
  });
}

function renderComparison(notes) {
  sourceComparison.innerHTML = "";

  notes.forEach((note) => {
    const item = document.createElement("div");
    item.className = "comparison-item";

    const title = document.createElement("strong");
    title.textContent = note.label;

    const body = document.createElement("span");
    body.textContent = note.text || "尚未录入该来源译法。";

    item.append(title, body);
    sourceComparison.append(item);
  });
}

function summarize() {
  const term = getTerm();
  const notes = collectNotes();
  const ranked = rankCandidates(notes);
  const filled = notes.filter((note) => note.text);

  renderComparison(notes);

  if (!term) {
    bestTranslation.textContent = "请先输入术语。";
    return;
  }

  if (!filled.length) {
    bestTranslation.textContent = "还没有录入任何来源译法。打开来源检索后，把每个词典的译法粘贴进左侧文本框，再生成汇总。";
  } else if (ranked.length) {
    const top = ranked[0];
    const other = ranked.slice(1, 4).map((item) => item.text).join("；");
    bestTranslation.textContent = `建议优先采用：${top.text}。支持来源：${top.sources.join("、")}。${other ? `可备选：${other}。` : ""}`;
  } else {
    bestTranslation.textContent = "已录入来源备注，但未识别出可直接采用的短译法；请检查分隔符或手动整理。";
  }

  citationOutput.value = buildCitation(term, notes, ranked);
}

function buildCitation(term, notes, ranked) {
  const lines = [];
  lines.push(`查询词条：${term}`);
  if (ranked[0]) lines.push(`推荐译法：${ranked[0].text}`);
  lines.push("");
  lines.push("来源记录：");

  notes.forEach((note) => {
    const text = note.text || "未录入";
    lines.push(`- ${note.label}：${text}`);
  });

  lines.push("");
  lines.push("引用入口/书目：");
  Object.entries(SOURCES).forEach(([id, source]) => {
    lines.push(`- ${source.cite(term)}`);
  });

  return lines.join("\n");
}

document.querySelectorAll(".open-source").forEach((button) => {
  button.addEventListener("click", () => {
    const sourceId = button.closest(".source-card").dataset.source;
    openSource(sourceId);
  });
});

queryAllButton.addEventListener("click", openAllSources);

copyTermButton.addEventListener("click", () => {
  const term = getTerm();
  if (!term) {
    showToast("请先输入要复制的术语。");
    return;
  }
  navigator.clipboard?.writeText(term);
  showToast("词条已复制。");
});

clearButton.addEventListener("click", () => {
  termInput.value = "";
  Object.keys(SOURCES).forEach((id) => {
    getTextArea(id).value = "";
  });
  sourceComparison.innerHTML = "";
  citationOutput.value = "";
  bestTranslation.textContent = "等待查询或录入来源译法。";
  resetInlineResults();
  termInput.focus();
});

csvInput.addEventListener("change", async () => {
  const file = csvInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const rows = rowsFromFile(text);
    importedRows = rows;
    saveRows();
    showToast(`已导入 ${rows.length} 条词库记录。`);
    const term = getTerm();
    if (term) {
      fillFromImported(term);
      summarize();
    }
  } catch (error) {
    showToast(error.message || "CSV 导入失败。");
  } finally {
    csvInput.value = "";
  }
});

summarizeButton.addEventListener("click", summarize);

copySummaryButton.addEventListener("click", () => {
  if (!citationOutput.value.trim()) {
    summarize();
  }
  navigator.clipboard?.writeText(citationOutput.value);
  showToast("汇总内容已复制。");
});

termInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    openAllSources();
  }
});

Object.keys(SOURCES).forEach((id) => {
  getTextArea(id).addEventListener("input", summarize);
});

renderComparison(collectNotes());
