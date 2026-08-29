import { app } from "../../scripts/app.js";

const NODE_CONFIGS = {
  HogKitLoraSingleChainLoaderWithMetadata: { dual: false, minWidth: 440 },
  HogKitLoraDualChainLoaderWithMetadata: { dual: true, minWidth: 640 },
};
const ROW_HEIGHT = 78;
let notesTooltip = null;
let notesTooltipHideTimer = null;

function cancelNotesTooltipHide() {
  if (notesTooltipHideTimer !== null) {
    window.clearTimeout(notesTooltipHideTimer);
    notesTooltipHideTimer = null;
  }
}

function hideNotesTooltip() {
  cancelNotesTooltipHide();
  notesTooltip?.remove();
  notesTooltip = null;
}

function scheduleNotesTooltipHide() {
  cancelNotesTooltipHide();
  notesTooltipHideTimer = window.setTimeout(hideNotesTooltip, 120);
}

function showNotesTooltip(title, notes, event) {
  const content = typeof notes === "string" ? notes.trim() : "";
  if (!content) {
    scheduleNotesTooltipHide();
    return false;
  }

  cancelNotesTooltipHide();
  if (!notesTooltip) {
    notesTooltip = document.createElement("div");
    notesTooltip.style.position = "fixed";
    notesTooltip.style.zIndex = "10001";
    notesTooltip.style.width = "min(520px, calc(100vw - 24px))";
    notesTooltip.style.maxHeight = "min(520px, calc(100vh - 24px))";
    notesTooltip.style.overflow = "auto";
    notesTooltip.style.padding = "10px 12px";
    notesTooltip.style.border = `1px solid ${LiteGraph.WIDGET_OUTLINE_COLOR || "#666"}`;
    notesTooltip.style.borderRadius = "6px";
    notesTooltip.style.background = "rgba(24, 24, 24, 0.98)";
    notesTooltip.style.boxShadow = "0 8px 28px rgba(0, 0, 0, 0.55)";
    notesTooltip.style.color = LiteGraph.WIDGET_TEXT_COLOR || "#eee";
    notesTooltip.style.font = "12px/1.45 sans-serif";
    notesTooltip.style.whiteSpace = "pre-wrap";
    notesTooltip.style.overflowWrap = "anywhere";
    notesTooltip.addEventListener("pointerenter", cancelNotesTooltipHide);
    notesTooltip.addEventListener("pointerleave", scheduleNotesTooltipHide);
    document.body.append(notesTooltip);
  }

  notesTooltip.replaceChildren();
  const heading = document.createElement("div");
  heading.textContent = title || "LoRA notes";
  heading.style.marginBottom = "6px";
  heading.style.fontWeight = "600";
  heading.style.color = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR || "#bbb";
  const body = document.createElement("div");
  body.textContent = content;
  notesTooltip.append(heading, body);

  const clientX = Number.isFinite(event?.clientX) ? event.clientX : window.innerWidth / 2;
  const clientY = Number.isFinite(event?.clientY) ? event.clientY : window.innerHeight / 2;
  notesTooltip.style.left = "0px";
  notesTooltip.style.top = "0px";
  const bounds = notesTooltip.getBoundingClientRect();
  const left = clientX + 14 + bounds.width <= window.innerWidth - 8
    ? clientX + 14
    : Math.max(8, clientX - bounds.width - 14);
  const top = Math.min(clientY + 14, Math.max(8, window.innerHeight - bounds.height - 8));
  notesTooltip.style.left = `${left}px`;
  notesTooltip.style.top = `${top}px`;
  return true;
}

function redrawNode(node) {
  for (const widget of node.widgets || []) {
    widget.triggerDraw?.();
  }
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
}

function supportMultipleWidgetHosts(widget) {
  const redrawCallbacks = new Set();
  const existingTriggerDraw = widget.triggerDraw;
  if (typeof existingTriggerDraw === "function") {
    redrawCallbacks.add(existingTriggerDraw);
  }

  const triggerAllDraws = () => {
    for (const callback of [...redrawCallbacks]) {
      try {
        callback();
      } catch {
        // Nodes 2.0 does not identify which host is being unmounted, so prune
        // callbacks once their canvas is no longer available.
        redrawCallbacks.delete(callback);
      }
    }
  };

  Object.defineProperty(widget, "triggerDraw", {
    configurable: true,
    enumerable: true,
    get: () => triggerAllDraws,
    set: (callback) => {
      if (typeof callback === "function" && callback !== triggerAllDraws) {
        redrawCallbacks.add(callback);
      }
    },
  });
}

function getLoraChoices(nodeData) {
  const input = nodeData?.input?.optional?.lora_stack;
  const options = input?.[1] || {};
  const choices = options?.lora_choices || [];
  return Array.isArray(choices) && choices.length ? choices : ["None"];
}

function makeRow(lora = "None") {
  return {
    enabled: true,
    lora_1: lora,
    lora_1_enabled: lora !== "None",
    lora_2: "None",
    lora_2_enabled: false,
    strength_1: 1.0,
    strength_2: 1.0,
  };
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") {
    return makeRow();
  }
  row.enabled = row.enabled !== false;
  row.lora_1 = row.lora_1 || "None";
  row.lora_1_enabled = row.lora_1_enabled !== false;
  if (row.lora_1 === "None") {
    row.lora_1_enabled = false;
  }
  row.lora_2 = row.lora_2 || "None";
  row.lora_2_enabled = !!row.lora_2_enabled;
  if (row.lora_2 === "None") {
    row.lora_2_enabled = false;
  }
  row.strength_1 = Number.isFinite(Number(row.strength_1)) ? Number(row.strength_1) : 1.0;
  row.strength_2 = Number.isFinite(Number(row.strength_2)) ? Number(row.strength_2) : 1.0;
  return row;
}

function parseStack(value) {
  const fallback = {
    rows: [],
    delimiter: ", ",
    exclusive: false,
  };

  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      return {
        rows: rows.filter((row) => row && typeof row === "object").map((row) => normalizeRow(row)),
        delimiter: typeof parsed.delimiter === "string" ? parsed.delimiter : ", ",
        exclusive: !!parsed.exclusive,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function serializeStack(node) {
  const rows = (node.rows || []).map((row) => {
    const serialized = { ...row };
    delete serialized.strength_1;
    delete serialized.strength_2;
    if (!node.isDualChain) {
      delete serialized.lora_2;
      delete serialized.lora_2_enabled;
    }
    return serialized;
  });
  return JSON.stringify({
    rows,
    delimiter: node.delimiter ?? ", ",
    exclusive: !!node.exclusive,
  });
}

function moveItem(items, from, to) {
  if (to < 0 || to >= items.length) {
    return;
  }
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function hideWidget(widget) {
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
  let trimmed = value;
  while (trimmed.length > 4 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function drawButton(ctx, rect, label, disabled = false) {
  ctx.save();
  ctx.globalAlpha = disabled ? 0.35 : 1;
  ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
}

function drawDragHandle(ctx, rect) {
  ctx.save();
  ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR || "#aaa";
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      ctx.beginPath();
      ctx.arc(rect.x + 4 + column * 6, rect.y + 5 + row * 6, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGreenPillToggle(ctx, rect, enabled) {
  ctx.save();
  ctx.fillStyle = enabled ? "#2f6f44" : "#4a4a4a";
  ctx.strokeStyle = enabled ? "#77bd8a" : LiteGraph.WIDGET_OUTLINE_COLOR;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fill();
  ctx.stroke();

  const knobX = enabled ? rect.x + rect.w - 19 : rect.x + 3;
  ctx.fillStyle = enabled ? "#d9f2df" : "#bbb";
  ctx.beginPath();
  ctx.arc(knobX + 8, rect.y + rect.h / 2, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = enabled ? "#d9f2df" : "#ddd";
  ctx.font = "9px sans-serif";
  ctx.textAlign = enabled ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillText(enabled ? "ON" : "OFF", enabled ? rect.x + 7 : rect.x + rect.w - 7, rect.y + rect.h / 2);
  ctx.restore();
}

function hit(pos, rect) {
  if (!pos || !rect) {
    return false;
  }
  return (
    pos[0] >= rect.x
    && pos[0] <= rect.x + rect.w
    && pos[1] >= rect.y
    && pos[1] <= rect.y + rect.h
  );
}

function captureWidgetCanvas(widget, ctx) {
  const scale = ctx.getTransform?.().a || 1;
  widget.pointerCanvases ||= new WeakMap();
  widget.pointerCanvases.set(ctx.canvas, {
    width: ctx.canvas.width / scale,
    height: ctx.canvas.height / scale,
  });
  widget.pointerCanvas = ctx.canvas;
  widget.pointerWidth = ctx.canvas.width / scale;
  widget.pointerHeight = ctx.canvas.height / scale;
}

function widgetCanvasForEvent(widget, event) {
  for (const canvas of [event?.currentTarget, event?.target]) {
    if (canvas && widget.pointerCanvases?.has(canvas)) {
      return canvas;
    }
  }
  return widget.activePointerCanvas || widget.pointerCanvas;
}

function widgetPointerPosition(widget, event, canvas = widgetCanvasForEvent(widget, event)) {
  if (!canvas || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) {
    return null;
  }
  const bounds = canvas.getBoundingClientRect?.();
  if (!bounds?.width || !bounds?.height) {
    return null;
  }
  const geometry = widget.pointerCanvases?.get(canvas) || {
    width: widget.pointerWidth,
    height: widget.pointerHeight,
  };
  return [
    (event.clientX - bounds.left) * (geometry.width / bounds.width),
    (event.clientY - bounds.top) * (geometry.height / bounds.height),
  ];
}

function storeWidgetHitAreas(widget, canvas) {
  widget.hitAreasByCanvas ||= new WeakMap();
  widget.hitAreasByCanvas.set(canvas, widget.hitAreas);
}

function activateWidgetHost(widget, event, canvas = widgetCanvasForEvent(widget, event)) {
  const hitAreas = canvas && widget.hitAreasByCanvas?.get(canvas);
  if (hitAreas) {
    widget.hitAreas = hitAreas;
  }
  return canvas;
}

function handleVueWidgetPointerDown(widget, pointer, node) {
  const event = pointer?.eDown;
  const canvas = activateWidgetHost(widget, event);
  if (!canvas || canvas === app.canvas?.canvas) {
    return false;
  }
  const pos = widgetPointerPosition(widget, event, canvas);
  if (!pos) {
    return false;
  }

  widget.activePointerCanvas = canvas;
  const handled = widget.mouse(event, pos, node);
  if (!handled) {
    widget.activePointerCanvas = null;
    return false;
  }

  pointer.onDrag = (moveEvent) => {
    activateWidgetHost(widget, moveEvent, canvas);
    const movePos = widgetPointerPosition(widget, moveEvent, canvas);
    if (movePos) {
      widget.mouse(moveEvent, movePos, node);
    }
  };
  pointer.finally = () => {
    const upEvent = pointer.eUp;
    activateWidgetHost(widget, upEvent, canvas);
    const upPos = widgetPointerPosition(widget, upEvent, canvas);
    if (upEvent && upPos) {
      widget.mouse(upEvent, upPos, node);
    }
    widget.activePointerCanvas = null;
  };
  return true;
}

function showError(message) {
  alert(message);
}

async function fetchMetadata(lora) {
  const response = await fetch(`/lora/metadata?lora=${encodeURIComponent(lora)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load metadata.");
  }
  return payload;
}

async function saveMetadata(lora, metadata) {
  const response = await fetch("/lora/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lora, metadata }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to save metadata.");
  }
  return payload;
}

function loraForRole(row, role) {
  return role === "2" ? row.lora_2 : row.lora_1;
}

function strengthForRole(row, role) {
  return role === "2" ? row.strength_2 : row.strength_1;
}

function setStrengthForRole(row, role, value) {
  if (role === "2") {
    row.strength_2 = value;
  } else {
    row.strength_1 = value;
  }
}

async function saveRowStrengthToMetadata(row, role = "1") {
  const lora = loraForRole(row, role);
  if (!lora || lora === "None") {
    return;
  }
  const payload = await fetchMetadata(lora);
  const metadata = payload.metadata || {};
  metadata.strength = Number(strengthForRole(row, role) ?? 1.0);
  const saved = await saveMetadata(lora, metadata);
  return saved.metadata || metadata;
}

function metadataSummary(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }
  return (
    metadata.positive_prompt
    || metadata.recommended?.positive_prompt
    || metadata.notes
    || ""
  );
}

function rowDisplayName(row, role = "1") {
  const lora = loraForRole(row, role) || "None";
  const name = role === "2" ? row.metadataName2 : row.metadataName1;
  return name ? `${name} - ${lora}` : lora;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceLastCaseInsensitive(value, from, to) {
  const pattern = new RegExp(`${escapeRegExp(from)}(?!.*${escapeRegExp(from)})`, "i");
  return value.replace(pattern, (match) => {
    if (match === match.toUpperCase()) {
      return to.toUpperCase();
    }
    if (match[0] === match[0].toUpperCase()) {
      return to[0].toUpperCase() + to.slice(1);
    }
    return to.toLowerCase();
  });
}

function pairCandidates(lora) {
  const value = String(lora || "");
  const replacements = [
    ["high_noise", "low_noise"],
    ["HighNoise", "LowNoise"],
    ["highnoise", "lownoise"],
    ["highwan", "lowwan"],
    ["high", "low"],
  ];
  const candidates = new Set();
  for (const [from, to] of replacements) {
    if (value.toLowerCase().includes(from.toLowerCase())) {
      candidates.add(replaceLastCaseInsensitive(value, from, to));
    }
    if (value.toLowerCase().includes(to.toLowerCase())) {
      candidates.add(replaceLastCaseInsensitive(value, to, from));
    }
  }
  return [...candidates].filter((candidate) => candidate && candidate !== value);
}

function findLoraPair(lora, choices) {
  const lookup = new Map((choices || []).map((choice) => [String(choice).toLowerCase(), choice]));
  for (const candidate of pairCandidates(lora)) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }
  return null;
}

function createButton(label, onClick) {
  const button = document.createElement("button");
  button.textContent = label;
  button.style.padding = "6px 12px";
  button.style.border = "1px solid #555";
  button.style.borderRadius = "4px";
  button.style.background = "#2b2b2b";
  button.style.color = "#ddd";
  button.style.cursor = "pointer";
  button.addEventListener("click", onClick);
  return button;
}

function ensureRecommended(metadata) {
  if (!metadata.recommended || typeof metadata.recommended !== "object") {
    metadata.recommended = {};
  }
}

function buildMetadataFieldsPanel(initialMetadata = {}) {
  const metadata = initialMetadata || {};
  const panel = document.createElement("div");
  panel.style.display = "grid";
  panel.style.gridTemplateColumns = "1fr 1fr";
  panel.style.gap = "8px";
  panel.style.padding = "8px 12px";
  panel.style.borderBottom = "1px solid #333";
  panel.style.background = "#181818";

  const makeField = (label, multiline = false) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "4px";
    const title = document.createElement("div");
    title.textContent = label;
    title.style.font = "11px sans-serif";
    title.style.color = "#bbb";
    title.style.whiteSpace = "nowrap";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    const input = multiline ? document.createElement("textarea") : document.createElement("input");
    input.spellcheck = false;
    input.style.background = "#101010";
    input.style.color = "#ddd";
    input.style.border = "1px solid #444";
    input.style.borderRadius = "4px";
    input.style.padding = "6px 8px";
    input.style.font = multiline ? "11px Consolas, monospace" : "11px sans-serif";
    input.style.minHeight = multiline ? "52px" : "28px";
    if (multiline) {
      input.style.resize = "vertical";
    }
    wrap.append(title, input);
    panel.append(wrap);
    return { wrap, input };
  };

  const name = makeField("Name");
  const strength = makeField("Strength");
  const positive = makeField("Positive Prompt", true);
  const negative = makeField("Negative Prompt", true);
  const recPositive = makeField("Recommended Positive", true);
  const recNegative = makeField("Recommended Negative", true);
  const recStrength = makeField("Recommended Strength");
  const recMin = makeField("Recommended Min");
  const recMax = makeField("Recommended Max");
  const notes = makeField("Notes", true);

  notes.wrap.style.gridColumn = "1 / 3";
  notes.input.style.minHeight = "128px";

  const tripleRow = document.createElement("div");
  tripleRow.style.gridColumn = "1 / 3";
  tripleRow.style.display = "grid";
  tripleRow.style.gridTemplateColumns = "148px 148px 148px";
  tripleRow.style.gap = "8px";
  tripleRow.style.justifyContent = "start";
  recStrength.wrap.remove();
  recMin.wrap.remove();
  recMax.wrap.remove();
  tripleRow.append(recStrength.wrap, recMin.wrap, recMax.wrap);
  panel.insertBefore(tripleRow, notes.wrap);

  const allInputs = [
    name.input, strength.input, positive.input, negative.input,
    recPositive.input, recNegative.input, notes.input,
    recStrength.input, recMin.input, recMax.input,
  ];

  const fromMetadata = (m) => {
    const data = m || {};
    ensureRecommended(data);
    name.input.value = data.name ?? "";
    strength.input.value = data.strength ?? "";
    positive.input.value = data.positive_prompt ?? "";
    negative.input.value = data.negative_prompt ?? "";
    recPositive.input.value = data.recommended.positive_prompt ?? "";
    recNegative.input.value = data.recommended.negative_prompt ?? "";
    notes.input.value = data.notes ?? "";
    recStrength.input.value = data.recommended.strength ?? "";
    recMin.input.value = data.recommended.min_strength ?? "";
    recMax.input.value = data.recommended.max_strength ?? "";
  };

  const toMetadata = (base = {}) => {
    const data = base || {};
    ensureRecommended(data);
    data.name = name.input.value ?? "";
    data.positive_prompt = positive.input.value ?? "";
    data.negative_prompt = negative.input.value ?? "";
    data.notes = notes.input.value ?? "";
    data.recommended.positive_prompt = recPositive.input.value ?? "";
    data.recommended.negative_prompt = recNegative.input.value ?? "";
    if (strength.input.value !== "") data.strength = Number(strength.input.value);
    if (recStrength.input.value !== "") data.recommended.strength = Number(recStrength.input.value);
    if (recMin.input.value !== "") data.recommended.min_strength = Number(recMin.input.value);
    if (recMax.input.value !== "") data.recommended.max_strength = Number(recMax.input.value);
    return data;
  };

  fromMetadata(metadata);
  return { panel, fromMetadata, toMetadata, allInputs };
}

function showLoraChooser(loras, onSelect, currentValue = "None") {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "10000";
  overlay.style.background = "rgba(0, 0, 0, 0.2)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.width = "min(680px, calc(100vw - 64px))";
  panel.style.maxHeight = "min(560px, calc(100vh - 64px))";
  panel.style.background = LiteGraph.WIDGET_BGCOLOR || "#222";
  panel.style.border = `1px solid ${LiteGraph.WIDGET_OUTLINE_COLOR || "#555"}`;
  panel.style.borderRadius = "4px";
  panel.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.55)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.overflow = "hidden";

  const header = document.createElement("div");
  header.style.padding = "8px 10px";
  header.style.borderBottom = `1px solid ${LiteGraph.WIDGET_OUTLINE_COLOR || "#444"}`;
  header.style.color = LiteGraph.WIDGET_TEXT_COLOR || "#eee";
  header.style.font = "12px sans-serif";
  header.textContent = "Select LoRA";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search LoRAs...";
  search.style.margin = "8px 10px";
  search.style.padding = "6px 8px";
  search.style.border = `1px solid ${LiteGraph.WIDGET_OUTLINE_COLOR || "#555"}`;
  search.style.borderRadius = "4px";
  search.style.background = LiteGraph.NODE_DEFAULT_BGCOLOR || "#111";
  search.style.color = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
  search.style.outline = "0";
  search.style.font = "12px sans-serif";

  const list = document.createElement("div");
  list.style.flex = "1";
  list.style.overflow = "auto";
  list.style.padding = "0 6px 6px";

  let matches = [];
  let activeIndex = 0;

  const close = () => document.body.removeChild(overlay);
  const choose = (value) => {
    onSelect(value);
    close();
  };

  const setActive = (index) => {
    if (!matches.length) {
      activeIndex = 0;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, matches.length - 1));
    for (const [rowIndex, row] of [...list.querySelectorAll("button")].entries()) {
      const active = rowIndex === activeIndex;
      const selected = row.dataset.value === currentValue;
      row.style.background = active
        ? LiteGraph.WIDGET_OUTLINE_COLOR || "#555"
        : selected
          ? "rgba(120, 160, 220, 0.22)"
          : "transparent";
    }
    list.querySelectorAll("button")[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    const needle = search.value.trim().toLowerCase();
    matches = loras
      .filter((lora) => !needle || String(lora).toLowerCase().includes(needle))
      .slice(0, 300);
    list.replaceChildren();
    activeIndex = Math.max(0, matches.findIndex((lora) => lora === currentValue));

    for (const lora of matches) {
      const row = document.createElement("button");
      row.dataset.value = lora;
      row.textContent = lora;
      row.style.display = "block";
      row.style.width = "100%";
      row.style.padding = "5px 8px";
      row.style.border = "0";
      row.style.borderRadius = "3px";
      row.style.background = "transparent";
      row.style.color = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
      row.style.textAlign = "left";
      row.style.font = "12px sans-serif";
      row.style.cursor = "pointer";
      row.style.whiteSpace = "nowrap";
      row.style.overflow = "hidden";
      row.style.textOverflow = "ellipsis";
      row.addEventListener("mouseenter", () => {
        activeIndex = matches.indexOf(lora);
        setActive(activeIndex);
      });
      row.addEventListener("dblclick", () => {
        choose(lora);
      });
      row.addEventListener("click", () => choose(lora));
      list.append(row);
    }

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.textContent = "No matches";
      empty.style.padding = "16px";
      empty.style.color = "#999";
      list.append(empty);
    }
    setActive(activeIndex < 0 ? 0 : activeIndex);
  };

  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(activeIndex + 1);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex - 1);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) {
        choose(matches[activeIndex]);
      }
    }
  });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  panel.append(header, search, list);
  overlay.append(panel);
  document.body.appendChild(overlay);
  render();
  search.value = currentValue && currentValue !== "None" ? currentValue : "";
  search.select();
  search.focus();
  requestAnimationFrame(() => {
    search.focus();
    search.select();
  });
  render();
}

function activeMetadataRoles(row, dual) {
  const roles = [];
  if (row.lora_1 && row.lora_1 !== "None") {
    roles.push("1");
  }
  if (dual && row.lora_2 && row.lora_2 !== "None") {
    roles.push("2");
  }
  return roles;
}

async function showMetadataEditor(row, node) {
  const roles = activeMetadataRoles(row, node.isDualChain);
  if (!roles.length) {
    showError("Select a LoRA before editing metadata.");
    return;
  }
  if (roles.length === 1) {
    await showSingleMetadataEditor(row, node, roles[0]);
    return;
  }
  await showDualMetadataEditor(row, node);
}

async function showSingleMetadataEditor(row, node, role = "1") {
  const lora = loraForRole(row, role);
  if (!lora || lora === "None") {
    showError("Select a LoRA before editing metadata.");
    return;
  }

  let payload;
  try {
    payload = await fetchMetadata(lora);
  } catch (error) {
    showError(error.message);
    return;
  }

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "10000";
  overlay.style.background = "rgba(0, 0, 0, 0.65)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.width = "min(980px, calc(100vw - 64px))";
  panel.style.height = "min(760px, calc(100vh - 64px))";
  panel.style.background = "#1f1f1f";
  panel.style.border = "1px solid #555";
  panel.style.borderRadius = "6px";
  panel.style.boxShadow = "0 16px 60px rgba(0, 0, 0, 0.5)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.overflow = "hidden";

  const header = document.createElement("div");
  header.style.padding = "12px 14px";
  header.style.borderBottom = "1px solid #444";
  header.style.color = "#eee";
  header.style.font = "13px sans-serif";
  header.textContent = `Metadata JSON ${role} - ${lora}`;

  const path = document.createElement("div");
  path.style.padding = "8px 14px";
  path.style.color = "#aaa";
  path.style.font = "11px monospace";
  path.style.borderBottom = "1px solid #333";
  path.textContent = payload.metadata_path || "";

  const textarea = document.createElement("textarea");
  textarea.value = JSON.stringify(payload.metadata || {}, null, 2);
  textarea.spellcheck = false;
  textarea.style.flex = "1";
  textarea.style.resize = "none";
  textarea.style.border = "0";
  textarea.style.outline = "0";
  textarea.style.padding = "14px";
  textarea.style.background = "#111";
  textarea.style.color = "#ddd";
  textarea.style.font = "12px Consolas, monospace";
  textarea.style.lineHeight = "1.45";
  const fields = buildMetadataFieldsPanel(payload.metadata || {});
  const syncJsonFromFields = () => {
    const base = (() => {
      try {
        return JSON.parse(textarea.value);
      } catch {
        return {};
      }
    })();
    const rebuilt = fields.toMetadata(base);
    textarea.value = JSON.stringify(rebuilt, null, 2);
  };
  for (const input of fields.allInputs) {
    input.addEventListener("input", syncJsonFromFields);
  }
  textarea.addEventListener("input", () => {
    try {
      fields.fromMetadata(JSON.parse(textarea.value));
      status.textContent = "";
    } catch {
      // Ignore while user is typing incomplete JSON.
    }
  });

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.gap = "8px";
  footer.style.justifyContent = "flex-end";
  footer.style.padding = "10px 14px";
  footer.style.borderTop = "1px solid #444";

  const status = document.createElement("span");
  status.style.marginRight = "auto";
  status.style.alignSelf = "center";
  status.style.color = "#aaa";
  status.style.font = "12px sans-serif";

  const close = () => document.body.removeChild(overlay);
  const saveButton = createButton("Save & Close", async () => {
    let metadata;
    try {
      metadata = JSON.parse(textarea.value);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      status.textContent = "Metadata must be a JSON object.";
      return;
    }
    try {
      const saved = await saveMetadata(lora, metadata);
      const savedMetadata = saved.metadata || metadata;
      textarea.value = JSON.stringify(savedMetadata, null, 2);
      fields.fromMetadata(savedMetadata);
      if (saved.metadata && typeof saved.metadata.strength !== "undefined") {
        setStrengthForRole(row, role, Number(saved.metadata.strength));
      }
      if (role === "2") {
        row.metadataName2 = saved.metadata?.name || "";
      } else {
        row.metadataName1 = saved.metadata?.name || "";
      }
      status.textContent = "Saved.";
      node.rebuildWidgets?.();
      redrawNode(node);
      close();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  footer.append(status, saveButton);
  panel.append(header, path, fields.panel, textarea, footer);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.body.appendChild(overlay);
  textarea.focus();
}

async function showDualMetadataEditor(row, node) {
  let payload1;
  let payload2;
  try {
    [payload1, payload2] = await Promise.all([
      fetchMetadata(row.lora_1),
      fetchMetadata(row.lora_2),
    ]);
  } catch (error) {
    showError(error.message);
    return;
  }

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "10000";
  overlay.style.background = "rgba(0, 0, 0, 0.65)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.width = "min(1180px, calc(100vw - 64px))";
  panel.style.height = "min(780px, calc(100vh - 64px))";
  panel.style.background = "#1f1f1f";
  panel.style.border = "1px solid #555";
  panel.style.borderRadius = "6px";
  panel.style.boxShadow = "0 16px 60px rgba(0, 0, 0, 0.5)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.overflow = "hidden";

  const header = document.createElement("div");
  header.style.padding = "12px 14px";
  header.style.borderBottom = "1px solid #444";
  header.style.color = "#eee";
  header.style.font = "13px sans-serif";
  header.textContent = "Metadata JSON - LoRA 1 / LoRA 2";

  const editors = document.createElement("div");
  editors.style.flex = "1";
  editors.style.display = "grid";
  editors.style.gridTemplateColumns = "1fr auto 1fr";
  editors.style.minHeight = "0";

  const makeEditor = (label, lora, payload) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.minWidth = "0";

    const title = document.createElement("div");
    title.style.padding = "8px 12px";
    title.style.borderBottom = "1px solid #333";
    title.style.color = "#ddd";
    title.style.font = "12px sans-serif";
    title.textContent = `${label} - ${lora}`;

    const path = document.createElement("div");
    path.style.padding = "6px 12px";
    path.style.color = "#aaa";
    path.style.font = "10px monospace";
    path.style.borderBottom = "1px solid #333";
    path.style.whiteSpace = "nowrap";
    path.style.overflow = "hidden";
    path.style.textOverflow = "ellipsis";
    path.textContent = payload.metadata_path || "";

    const textarea = document.createElement("textarea");
    textarea.value = JSON.stringify(payload.metadata || {}, null, 2);
    textarea.spellcheck = false;
    textarea.style.flex = "1";
    textarea.style.resize = "none";
    textarea.style.border = "0";
    textarea.style.outline = "0";
    textarea.style.padding = "14px";
    textarea.style.background = "#111";
    textarea.style.color = "#ddd";
    textarea.style.font = "12px Consolas, monospace";
    textarea.style.lineHeight = "1.45";
    const fields = buildMetadataFieldsPanel(payload.metadata || {});
    wrap.append(title, path, fields.panel, textarea);
    return { wrap, textarea, fields };
  };

  const left = makeEditor("LoRA 1", row.lora_1, payload1);
  const right = makeEditor("LoRA 2", row.lora_2, payload2);
  const syncLeftJsonFromFields = () => {
    const base = (() => {
      try {
        return JSON.parse(left.textarea.value);
      } catch {
        return {};
      }
    })();
    left.textarea.value = JSON.stringify(left.fields.toMetadata(base), null, 2);
  };
  const syncRightJsonFromFields = () => {
    const base = (() => {
      try {
        return JSON.parse(right.textarea.value);
      } catch {
        return {};
      }
    })();
    right.textarea.value = JSON.stringify(right.fields.toMetadata(base), null, 2);
  };
  for (const input of left.fields.allInputs) {
    input.addEventListener("input", syncLeftJsonFromFields);
  }
  for (const input of right.fields.allInputs) {
    input.addEventListener("input", syncRightJsonFromFields);
  }
  left.textarea.addEventListener("input", () => {
    try {
      left.fields.fromMetadata(JSON.parse(left.textarea.value));
      status.textContent = "";
    } catch {
      // Ignore while user is typing incomplete JSON.
    }
  });
  right.textarea.addEventListener("input", () => {
    try {
      right.fields.fromMetadata(JSON.parse(right.textarea.value));
      status.textContent = "";
    } catch {
      // Ignore while user is typing incomplete JSON.
    }
  });
  const syncBar = document.createElement("div");
  syncBar.style.display = "flex";
  syncBar.style.flexDirection = "column";
  syncBar.style.gap = "8px";
  syncBar.style.alignItems = "center";
  syncBar.style.justifyContent = "center";
  syncBar.style.padding = "0 10px";
  syncBar.style.borderLeft = "1px solid #333";
  syncBar.style.borderRight = "1px solid #333";
  syncBar.append(
    createButton("> > >", () => {
      right.textarea.value = left.textarea.value;
      try {
        right.fields.fromMetadata(JSON.parse(left.textarea.value));
      } catch {
        // Keep copied text even if invalid JSON; user can rebuild/check next.
      }
    }),
    createButton("< < <", () => {
      left.textarea.value = right.textarea.value;
      try {
        left.fields.fromMetadata(JSON.parse(right.textarea.value));
      } catch {
        // Keep copied text even if invalid JSON; user can rebuild/check next.
      }
    }),
  );

  editors.append(left.wrap, syncBar, right.wrap);

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.gap = "8px";
  footer.style.justifyContent = "flex-end";
  footer.style.padding = "10px 14px";
  footer.style.borderTop = "1px solid #444";

  const status = document.createElement("span");
  status.style.marginRight = "auto";
  status.style.alignSelf = "center";
  status.style.color = "#aaa";
  status.style.font = "12px sans-serif";

  const close = () => document.body.removeChild(overlay);
  const saveButton = createButton("Save & Close", async () => {
    let metadata1;
    let metadata2;
    try {
      metadata1 = JSON.parse(left.textarea.value);
      metadata2 = JSON.parse(right.textarea.value);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    if (!metadata1 || typeof metadata1 !== "object" || Array.isArray(metadata1)
      || !metadata2 || typeof metadata2 !== "object" || Array.isArray(metadata2)) {
      status.textContent = "Metadata must be JSON objects.";
      return;
    }
    try {
      const [saved1, saved2] = await Promise.all([
        saveMetadata(row.lora_1, metadata1),
        saveMetadata(row.lora_2, metadata2),
      ]);
      const next1 = saved1.metadata || metadata1;
      const next2 = saved2.metadata || metadata2;
      left.textarea.value = JSON.stringify(next1, null, 2);
      right.textarea.value = JSON.stringify(next2, null, 2);
      left.fields.fromMetadata(next1);
      right.fields.fromMetadata(next2);
      if (typeof next1.strength !== "undefined") {
        row.strength_1 = Number(next1.strength);
      }
      if (typeof next2.strength !== "undefined") {
        row.strength_2 = Number(next2.strength);
      }
      row.metadataName1 = next1.name || "";
      row.metadataName2 = next2.name || "";
      status.textContent = "Saved.";
      node.rebuildWidgets?.();
      redrawNode(node);
      close();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  footer.append(status, saveButton);
  panel.append(header, editors, footer);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.body.appendChild(overlay);
  left.textarea.focus();
}

class LoraRowWidget {
  constructor(node, row, rowIndex, generation) {
    this.type = "custom";
    this.name = `lora_row_${generation}_${rowIndex + 1}`;
    this.serialize = false;
    this.node = node;
    this.row = row;
    this.rowIndex = rowIndex;
    this.hitAreas = {};
    this.preview1 = "";
    this.preview2 = "";
    this.notes1 = "";
    this.notes2 = "";
    this.hoverCanvases = new Map();
    supportMultipleWidgetHosts(this);
    this.loadPreview("1");
    if (node.isDualChain) {
      this.loadPreview("2");
    }
  }

  computeSize(width) {
    return [width, ROW_HEIGHT];
  }

  draw(ctx, node, width, y) {
    captureWidgetCanvas(this, ctx);
    this.bindHoverCanvas(ctx.canvas);
    this.hitAreas = {};
    if (this.rowIndex === 0) {
      node.rowsStartY = y;
    }
    const margin = 12;
    const rowX = margin;
    const rowY = y + 4;
    const rowW = width - margin * 2;
    const rowH = ROW_HEIGHT - 8;
    const controlSize = 22;
    const gap = 5;

    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(rowX, rowY, rowW, rowH, 5);
    ctx.fill();
    ctx.stroke();

    let x = rowX + 7;
    const dragRect = { x, y: rowY + 24, w: 16, h: 22 };
    this.hitAreas.drag = dragRect;
    drawDragHandle(ctx, dragRect);
    x += dragRect.w + 7;

    const toggleRect = { x, y: rowY + 24, w: 44, h: 22 };
    this.hitAreas.toggle = toggleRect;
    this.drawToggle(ctx, toggleRect);
    x += toggleRect.w + 8;

    const removeRect = { x: rowX + rowW - controlSize - 6, y: rowY + 24, w: controlSize, h: controlSize };
    const editRect = { x: removeRect.x - controlSize - gap, y: rowY + 24, w: controlSize, h: controlSize };
    const panelGap = 8;
    const panelW = node.isDualChain
      ? Math.max(120, (editRect.x - x - panelGap * 2) / 2)
      : Math.max(120, editRect.x - x - panelGap);
    const panel1 = { x, y: rowY + 7, w: panelW, h: rowH - 14 };

    this.drawSlot(ctx, panel1, "1", this.row.lora_1_enabled !== false);
    if (node.isDualChain) {
      const panel2 = { x: x + panelW + panelGap, y: rowY + 7, w: panelW, h: rowH - 14 };
      this.drawSlot(ctx, panel2, "2", this.row.lora_2_enabled !== false);
    }

    this.hitAreas.edit = editRect;
    this.hitAreas.remove = removeRect;
    drawButton(ctx, editRect, "{}");
    drawButton(ctx, removeRect, "x");

    if (this.row.enabled === false) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(rowX + 1, rowY + 1, rowW - 2, rowH - 2);
    }
    ctx.restore();
    storeWidgetHitAreas(this, ctx.canvas);
  }

  drawSlot(ctx, rect, role, enabled) {
    const loraRect = { x: rect.x + 22, y: rect.y + 2, w: Math.max(40, rect.w - 84), h: 20 };
    const strengthRect = { x: rect.x + rect.w - 58, y: rect.y + 2, w: 52, h: 20 };
    const toggleRect = { x: rect.x + 2, y: rect.y + 2, w: 42, h: 20 };
    const isSlot2 = role === "2";
    const isSlot1 = role === "1";

    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.45;
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
    ctx.fill();
    ctx.stroke();

    if (isSlot2) {
      this.hitAreas.slot2 = rect;
      this.hitAreas.toggle2 = toggleRect;
      drawGreenPillToggle(ctx, toggleRect, this.row.lora_2_enabled !== false);
      loraRect.x = toggleRect.x + toggleRect.w + 6;
      loraRect.w = Math.max(40, strengthRect.x - loraRect.x - 6);
    } else if (isSlot1) {
      this.hitAreas.slot1 = rect;
      this.hitAreas.toggle1 = toggleRect;
      drawGreenPillToggle(ctx, toggleRect, this.row.lora_1_enabled !== false);
      loraRect.x = toggleRect.x + toggleRect.w + 6;
      loraRect.w = Math.max(40, strengthRect.x - loraRect.x - 6);
    }

    this.hitAreas[`lora${role}`] = loraRect;
    this.hitAreas[`strength${role}`] = strengthRect;

    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "12px sans-serif";
    const rolePrefix = this.node.isDualChain ? `${role}: ` : "";
    ctx.fillText(fitText(ctx, `${rolePrefix}${rowDisplayName(this.row, role)}`, loraRect.w), loraRect.x, loraRect.y + loraRect.h / 2);

    const preview = (role === "2" ? this.preview2 : this.preview1) || "metadata prompt will be appended";
    ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
    ctx.font = "10px sans-serif";
    ctx.fillText(fitText(ctx, preview, rect.w - 12), rect.x + 6, rect.y + 42);

    drawButton(ctx, strengthRect, `s ${Number(strengthForRole(this.row, role) ?? 1).toFixed(2)}`, !enabled);
    ctx.restore();
  }

  notesForRole(role) {
    return role === "2" ? this.notes2 : this.notes1;
  }

  handleHover(pos, event, hitAreas = this.hitAreas) {
    for (const role of this.node.isDualChain ? ["1", "2"] : ["1"]) {
      if (hit(pos, hitAreas?.[`slot${role}`])) {
        return showNotesTooltip(
          rowDisplayName(this.row, role),
          this.notesForRole(role),
          event,
        );
      }
    }
    return false;
  }

  bindHoverCanvas(canvas) {
    const graphCanvas = app.canvas?.canvas;
    if (!canvas || canvas === graphCanvas || this.hoverCanvases.has(canvas)) {
      return;
    }
    const moveHandler = (event) => {
      const pos = widgetPointerPosition(this, event, canvas) || [event.offsetX, event.offsetY];
      const hitAreas = this.hitAreasByCanvas?.get(canvas) || this.hitAreas;
      if (!this.handleHover(pos, event, hitAreas)) {
        scheduleNotesTooltipHide();
      }
    };
    const leaveHandler = scheduleNotesTooltipHide;
    this.hoverCanvases.set(canvas, { moveHandler, leaveHandler });
    canvas.addEventListener("pointermove", moveHandler);
    canvas.addEventListener("pointerleave", leaveHandler);
  }

  unbindHoverCanvases() {
    for (const [canvas, handlers] of this.hoverCanvases) {
      canvas.removeEventListener("pointermove", handlers.moveHandler);
      canvas.removeEventListener("pointerleave", handlers.leaveHandler);
    }
    this.hoverCanvases.clear();
  }

  onRemove() {
    this.unbindHoverCanvases();
    scheduleNotesTooltipHide();
  }

  redraw() {
    this.triggerDraw?.();
    redrawNode(this.node);
  }

  onPointerDown(pointer, node) {
    return handleVueWidgetPointerDown(this, pointer, node);
  }

  mouse(event, pos, node) {
    activateWidgetHost(this, event);
    if (event.type === "pointerup") {
      node.draggingRow = null;
      node.dragLastTarget = null;
      return true;
    }

    if (event.type === "pointermove" && node.draggingRow != null) {
      const rowsStartY = node.rowsStartY ?? this.hitAreas.drag.y;
      const targetIndex = clamp(
        Math.floor((pos[1] - rowsStartY) / ROW_HEIGHT),
        0,
        node.rows.length - 1,
      );
      if (node.draggingRow !== targetIndex) {
        moveItem(node.rows, node.draggingRow, targetIndex);
        node.draggingRow = targetIndex;
        node.dragLastTarget = targetIndex;
        node.updateStackWidget();
        node.rebuildWidgets();
      }
      return true;
    }

    if (event.type !== "pointerdown") {
      return false;
    }
    if (hit(pos, this.hitAreas.drag)) {
      node.draggingRow = this.rowIndex;
      node.dragLastTarget = this.rowIndex;
      const clearDrag = () => {
        node.draggingRow = null;
        node.dragLastTarget = null;
        window.removeEventListener("pointerup", clearDrag);
      };
      window.addEventListener("pointerup", clearDrag, { once: true });
      return true;
    }
    if (hit(pos, this.hitAreas.toggle)) {
      const nextEnabled = this.row.enabled === false;
      if (nextEnabled && node.exclusive) {
        for (const row of node.rows) {
          row.enabled = false;
        }
      }
      this.row.enabled = nextEnabled;
      node.updateStackWidget();
      this.redraw();
      return true;
    }
    if (hit(pos, this.hitAreas.toggle2)) {
      if (!this.row.lora_2 || this.row.lora_2 === "None") {
        this.row.lora_2_enabled = false;
        node.updateStackWidget();
        this.redraw();
        return true;
      }
      this.row.lora_2_enabled = this.row.lora_2_enabled === false;
      node.updateStackWidget();
      this.redraw();
      return true;
    }
    if (hit(pos, this.hitAreas.toggle1)) {
      if (!this.row.lora_1 || this.row.lora_1 === "None") {
        this.row.lora_1_enabled = false;
        node.updateStackWidget();
        this.redraw();
        return true;
      }
      this.row.lora_1_enabled = this.row.lora_1_enabled === false;
      node.updateStackWidget();
      this.redraw();
      return true;
    }
    if (hit(pos, this.hitAreas.lora1)) {
      this.openLoraMenu(event, node, "1");
      return true;
    }
    if (hit(pos, this.hitAreas.lora2)) {
      this.openLoraMenu(event, node, "2");
      return true;
    }
    if (hit(pos, this.hitAreas.strength1)) {
      this.promptStrength(event, node, "1");
      return true;
    }
    if (hit(pos, this.hitAreas.strength2)) {
      this.promptStrength(event, node, "2");
      return true;
    }
    if (hit(pos, this.hitAreas.edit)) {
      showMetadataEditor(this.row, node);
      return true;
    }
    if (hit(pos, this.hitAreas.remove)) {
      node.rows.splice(this.rowIndex, 1);
      node.updateStackWidget();
      node.rebuildWidgets();
      return true;
    }
    return false;
  }

  promptStrength(event, node, role) {
    app.canvas.prompt(`LoRA ${role} strength`, String(strengthForRole(this.row, role) ?? 1.0), (value) => {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          setStrengthForRole(this.row, role, parsed);
          saveRowStrengthToMetadata(this.row, role)
            .then((metadata) => {
              if (role === "2") {
                this.preview2 = metadataSummary(metadata);
              } else {
                this.preview1 = metadataSummary(metadata);
              }
              this.redraw();
            })
            .catch((error) => {
              showError(error.message);
            });
          this.redraw();
        }
      }, event);
  }

  openLoraMenu(event, node, role) {
    showLoraChooser(node.loraChoices || ["None"], (lora) => {
      hideNotesTooltip();
      if (role === "2") {
        this.row.lora_2 = lora;
        this.row.lora_2_enabled = lora !== "None";
        this.notes2 = "";
        const pair = node.isDualChain ? findLoraPair(lora, node.loraChoices || []) : null;
        if (pair && (!this.row.lora_1 || this.row.lora_1 === "None")) {
          if (confirm(`Found likely LoRA 1 pair:\n${pair}\n\nLoad it into slot 1?`)) {
            this.row.lora_1 = pair;
            this.loadPreview("1");
          }
        }
      } else {
        this.row.lora_1 = lora;
        this.row.lora_1_enabled = lora !== "None";
        this.notes1 = "";
        const pair = node.isDualChain ? findLoraPair(lora, node.loraChoices || []) : null;
        if (pair && (!this.row.lora_2 || this.row.lora_2 === "None")) {
          if (confirm(`Found likely LoRA 2 pair:\n${pair}\n\nLoad it into slot 2?`)) {
            this.row.lora_2 = pair;
            this.row.lora_2_enabled = true;
            this.loadPreview("2");
          }
        }
      }
      normalizeRow(this.row);
      this.loadPreview(role);
      node.updateStackWidget();
      this.redraw();
    }, loraForRole(this.row, role) || "None");
  }

  drawToggle(ctx, rect) {
    const enabled = this.row.enabled !== false;
    drawGreenPillToggle(ctx, rect, enabled);
  }

  async loadPreview(role) {
    const lora = loraForRole(this.row, role);
    if (!lora || lora === "None") {
      if (role === "2") {
        this.preview2 = "";
        this.notes2 = "";
      } else {
        this.preview1 = "";
        this.notes1 = "";
      }
      return;
    }
    try {
      const payload = await fetchMetadata(lora);
      if (payload.metadata && typeof payload.metadata.strength !== "undefined") {
        setStrengthForRole(this.row, role, Number(payload.metadata.strength));
      }
      if (role === "2") {
        this.row.metadataName2 = payload.metadata?.name || "";
        this.preview2 = metadataSummary(payload.metadata);
        this.notes2 = typeof payload.metadata?.notes === "string" ? payload.metadata.notes : "";
      } else {
        this.row.metadataName1 = payload.metadata?.name || "";
        this.preview1 = metadataSummary(payload.metadata);
        this.notes1 = typeof payload.metadata?.notes === "string" ? payload.metadata.notes : "";
      }
      this.redraw();
    } catch {
      if (role === "2") {
        this.preview2 = "";
        this.notes2 = "";
      } else {
        this.preview1 = "";
        this.notes1 = "";
      }
    }
  }
}

class LoraSettingsWidget {
  constructor(node, generation) {
    this.type = "custom";
    this.name = `lora_settings_${generation}`;
    this.serialize = false;
    this.node = node;
    this.hitAreas = {};
    supportMultipleWidgetHosts(this);
  }

  computeSize(width) {
    return [width, 68];
  }

  draw(ctx, node, width, y) {
    captureWidgetCanvas(this, ctx);
    this.hitAreas = {};
    const margin = 12;
    const rowX = margin;
    const rowY = y + 5;
    const rowW = width - margin * 2;
    const rowH = 58;
    const exclusiveY = rowY + 6;
    const delimiterY = rowY + 32;
    const exclusiveRect = { x: rowX + 78, y: exclusiveY, w: 44, h: 22 };
    const delimiterRect = { x: rowX + 78, y: delimiterY, w: Math.max(120, rowW - 88), h: 22 };

    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(rowX, rowY, rowW, rowH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "11px sans-serif";
    ctx.fillText("Exclusive", rowX + 10, exclusiveY + 11);
    this.hitAreas.exclusive = exclusiveRect;
    drawGreenPillToggle(ctx, exclusiveRect, !!node.exclusive);

    ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR;
    ctx.fillText("Delimiter", rowX + 10, delimiterY + 11);
    this.hitAreas.delimiter = delimiterRect;
    drawButton(ctx, delimiterRect, JSON.stringify(node.delimiter ?? ", "));
    ctx.restore();
    storeWidgetHitAreas(this, ctx.canvas);
  }

  mouse(event, pos, node) {
    activateWidgetHost(this, event);
    if (event.type !== "pointerdown") {
      return false;
    }

    if (hit(pos, this.hitAreas.delimiter)) {
      app.canvas.prompt("Prompt delimiter", node.delimiter ?? ", ", (value) => {
        if (value != null) {
          node.delimiter = value;
          node.updateStackWidget();
          this.triggerDraw?.();
          redrawNode(node);
        }
      }, event);
      return true;
    }

    if (hit(pos, this.hitAreas.exclusive)) {
      node.exclusive = !node.exclusive;
      if (node.exclusive) {
        let foundEnabled = false;
        for (const row of node.rows) {
          if (row.enabled !== false && !foundEnabled) {
            foundEnabled = true;
          } else {
            row.enabled = false;
          }
        }
      }
      node.updateStackWidget();
      node.rebuildWidgets();
      return true;
    }

    return false;
  }

  onPointerDown(pointer, node) {
    return handleVueWidgetPointerDown(this, pointer, node);
  }
}

app.registerExtension({
  name: "LoraChainLoaderWithMetadata",

  beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeConfig = NODE_CONFIGS[nodeData.name];
    if (!nodeConfig || nodeType.prototype.loraChainMetadataPatched) {
      return;
    }

    nodeType.prototype.loraChainMetadataPatched = true;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalOnNodeCreated?.apply(this, arguments);

      this.loraChoices = getLoraChoices(nodeData);
      this.isDualChain = nodeConfig.dual;
      this.loraChainMinWidth = nodeConfig.minWidth;
      this.rows = [];

      const stackWidget = this.widgets?.find((widget) => widget.name === "lora_stack");
      this.stackWidget = stackWidget;
      if (stackWidget) {
        const stack = parseStack(stackWidget.value);
        this.rows = stack.rows;
        this.delimiter = stack.delimiter;
        this.exclusive = stack.exclusive;
        stackWidget.serializeValue = () => serializeStack(this);
        hideWidget(stackWidget);
      }

      this.rebuildWidgets();
      return result;
    };

    const originalConfigure = nodeType.prototype.configure;
    nodeType.prototype.configure = function (info) {
      const result = originalConfigure?.apply(this, arguments);
      const stackIndex = this.widgets?.findIndex((widget) => widget.name === "lora_stack");
      const stackValue = info?.widgets_values?.lora_stack ?? info?.widgets_values?.[stackIndex];
      if (stackValue !== undefined) {
        const stack = parseStack(stackValue);
        this.rows = stack.rows;
        this.delimiter = stack.delimiter;
        this.exclusive = stack.exclusive;
      }
      if (this.stackWidget) {
        this.stackWidget.value = serializeStack(this);
      }
      this.rebuildWidgets?.();
      return result;
    };

    nodeType.prototype.removeRowWidgets = function () {
      if (!this.widgets) {
        return;
      }
      for (let index = this.widgets.length - 1; index >= 0; index -= 1) {
        const widget = this.widgets[index];
        if (widget.loraDynamicWidget) {
          if (typeof this.removeWidget === "function") {
            this.removeWidget(widget);
          } else {
            widget.onRemove?.();
            this.widgets.splice(index, 1);
          }
        }
      }
    };

    nodeType.prototype.rebuildWidgets = function () {
      this.rows = (this.rows || []).map((row) => normalizeRow(row));
      this.delimiter = this.delimiter ?? ", ";
      this.exclusive = !!this.exclusive;
      this.removeRowWidgets();
      this.removeEnableInputs();
      this.loraWidgetGeneration = (this.loraWidgetGeneration || 0) + 1;
      const generation = this.loraWidgetGeneration;

      let addButton = this.widgets?.find((widget) => widget.loraAddWidget);
      if (!addButton) {
        addButton = this.addWidget("button", "+ Add LoRA", null, () => {
          if (this.exclusive) {
            for (const row of this.rows) {
              row.enabled = false;
            }
          }
          this.rows.push(makeRow("None"));
          this.rebuildWidgets();
        });
        addButton.loraAddWidget = true;
        addButton.serialize = false;
      }

      this.rows.forEach((row, rowIndex) => {
        const widget = new LoraRowWidget(this, row, rowIndex, generation);
        widget.loraDynamicWidget = true;
        this.addCustomWidget(widget);
      });

      const settingsWidget = new LoraSettingsWidget(this, generation);
      settingsWidget.loraDynamicWidget = true;
      this.addCustomWidget(settingsWidget);

      if (this.stackWidget) {
        this.updateStackWidget();
      }

      const computed = this.computeSize();
      const nextSize = [
        Math.max(this.size?.[0] || 0, computed[0], this.loraChainMinWidth),
        Math.max(computed[1], 120),
      ];
      if (typeof this.setSize === "function") {
        this.setSize(nextSize);
      } else {
        this.size = nextSize;
      }
      redrawNode(this);
    };

    nodeType.prototype.updateStackWidget = function () {
      if (this.stackWidget) {
        this.stackWidget.value = serializeStack(this);
      }
    };

    nodeType.prototype.removeEnableInputs = function () {
      if (!this.inputs) {
        return;
      }
      for (let index = this.inputs.length - 1; index >= 0; index -= 1) {
        const input = this.inputs[index];
        if (/^enabled_\d+$/.test(input?.name || "")) {
          this.removeInput(index);
        }
      }
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = originalOnExecuted?.apply(this, arguments);
      const syncedStack = message?.lora_stack_sync?.[0] ?? message?.ui?.lora_stack_sync?.[0];
      if (typeof syncedStack !== "string" || !syncedStack.trim()) {
        return result;
      }
      const stack = parseStack(syncedStack);
      this.rows = stack.rows;
      this.delimiter = stack.delimiter;
      this.exclusive = stack.exclusive;
      if (this.stackWidget) {
        this.stackWidget.value = syncedStack;
      }
      this.rebuildWidgets?.();
      return result;
    };

    const originalOnMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos) {
      const result = originalOnMouseMove?.apply(this, arguments);
      const hovered = this.widgets?.some((widget) => (
        widget.loraDynamicWidget
        && typeof widget.handleHover === "function"
        && widget.handleHover(pos, event)
      ));
      if (!hovered) {
        scheduleNotesTooltipHide();
      }
      return result;
    };

    const originalOnMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      const result = originalOnMouseLeave?.apply(this, arguments);
      scheduleNotesTooltipHide();
      return result;
    };

  },
});
