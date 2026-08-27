import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

const NODE_NAME = "HogKitShowConvertAnything";
const INPUT_PREFIX = "value";
const OUTPUT_PREFIX = "output";
const TYPE_PREFIX = "output_type";
const DISPLAY_WIDGET = "display";
const MAX_ROWS = 100;
const OUTPUT_TYPES = ["Auto", "String", "Integer", "Float", "Boolean"];
const OUTPUT_TYPE_MAP = {
  String: "STRING",
  Integer: "INT",
  Float: "FLOAT",
  Boolean: "BOOLEAN",
};

function slotIndex(name, prefix) {
  if (!name?.startsWith(prefix)) {
    return null;
  }
  const suffix = name.slice(prefix.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : null;
}

function findSlot(slots, prefix, index) {
  return slots?.find((slot) => slotIndex(slot.name, prefix) === index);
}

function getGraphLink(graph, linkId) {
  return graph?.links?.[linkId]
    || graph?._links?.get?.(linkId)
    || graph?._links?.[linkId]
    || null;
}

function getSourceType(node, index) {
  const input = findSlot(node.inputs, INPUT_PREFIX, index);
  const link = input?.link == null ? null : getGraphLink(node.graph, input.link);
  const originNode = link ? node.graph?.getNodeById(link.origin_id) : null;
  return originNode?.outputs?.[link?.origin_slot]?.type || link?.type || "*";
}

function getInputType(node, index) {
  const type = getSourceType(node, index);
  return type === "*" ? "Any" : type;
}

function getDisplayType(node, index) {
  const inputType = getInputType(node, index);
  const selector = node.widgets?.find((widget) => widget.name === `${TYPE_PREFIX}${index}`);
  const outputType = OUTPUT_TYPE_MAP[selector?.value];
  return outputType ? `${inputType} to ${outputType}` : inputType;
}

function updateOutputType(node, index) {
  const output = findSlot(node.outputs, OUTPUT_PREFIX, index);
  const selector = node.widgets?.find((widget) => widget.name === `${TYPE_PREFIX}${index}`);
  if (!output || !selector) {
    return;
  }

  const type = OUTPUT_TYPE_MAP[selector.value] || getSourceType(node, index);
  if (output.type !== type) {
    output.type = type;
    node.graph?.setDirtyCanvas(true, false);
  }
}

function addRow(node, index) {
  if (index >= MAX_ROWS) {
    return;
  }
  if (!findSlot(node.inputs, INPUT_PREFIX, index)) {
    node.addInput(`${INPUT_PREFIX}${index}`, "*");
  }
  if (!findSlot(node.outputs, OUTPUT_PREFIX, index)) {
    node.addOutput(`${OUTPUT_PREFIX}${index}`, "*");
  }

  let typeWidget = node.widgets?.find((widget) => widget.name === `${TYPE_PREFIX}${index}`);
  if (!typeWidget) {
    typeWidget = node.addWidget(
      "combo",
      `${TYPE_PREFIX}${index}`,
      "Auto",
      () => {
        updateOutputType(node, index);
        const display = node.widgets?.find((widget) => widget.name === DISPLAY_WIDGET);
        if (display?.displayValues) {
          updateDisplay(node, display.displayValues);
        }
      },
      { values: OUTPUT_TYPES },
    );
  }
  typeWidget.advanced = true;
  updateOutputType(node, index);
}

function ensureDisplayWidget(node) {
  if (node.widgets?.some((widget) => widget.name === DISPLAY_WIDGET)) {
    return;
  }

  const widget = ComfyWidgets.STRING(
    node,
    DISPLAY_WIDGET,
    ["STRING", { multiline: true }],
    app,
  ).widget;
  widget.inputEl.readOnly = true;
  widget.inputEl.style.opacity = 0.65;
  widget.serializeValue = () => "";
}

function getRowCount(node) {
  const indices = [];
  for (const slot of node.inputs || []) {
    const index = slotIndex(slot.name, INPUT_PREFIX);
    if (index !== null) {
      indices.push(index);
    }
  }
  for (const slot of node.outputs || []) {
    const index = slotIndex(slot.name, OUTPUT_PREFIX);
    if (index !== null && (index === 0 || slot.links?.length || slot.link != null)) {
      indices.push(index);
    }
  }
  for (const widget of node.widgets || []) {
    const index = slotIndex(widget.name, TYPE_PREFIX);
    if (index !== null) {
      indices.push(index);
    }
  }
  return indices.length ? Math.max(...indices) + 1 : 1;
}

function hasOutputLinks(slot) {
  return slot?.links?.length > 0 || slot?.link != null;
}

function trimOutputs(node, rowCount) {
  for (let index = node.outputs.length - 1; index >= rowCount; index -= 1) {
    if (!hasOutputLinks(node.outputs[index])) {
      node.removeOutput(index);
    }
  }
}

function ensureRows(node) {
  ensureDisplayWidget(node);
  let rowCount = getRowCount(node);
  trimOutputs(node, rowCount);
  for (let index = 0; index < rowCount; index++) {
    addRow(node, index);
  }

  while (rowCount < MAX_ROWS && findSlot(node.inputs, INPUT_PREFIX, rowCount - 1)?.link != null) {
    addRow(node, rowCount);
    rowCount += 1;
  }
}

function updateDisplay(node, text) {
  const values = Array.isArray(text) ? text : [text ?? ""];
  const display = node.widgets?.find((widget) => widget.name === DISPLAY_WIDGET);
  if (!display) {
    return;
  }
  const lines = values.map((value, index) => {
    return `display${index} - ${getDisplayType(node, index)}\n${value ?? ""}`;
  });
  display.displayValues = values;
  display.value = lines.join("\n");
  const size = node.computeSize?.();
  if (size) {
    node.setSize?.([Math.max(node.size[0], size[0]), Math.max(node.size[1], size[1])]);
  }
  app.graph?.setDirtyCanvas(true, false);
}

app.registerExtension({
  name: "ShowConvertAnything",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME || nodeType.prototype.showConvertAnythingPatched) {
      return;
    }

    nodeType.prototype.showConvertAnythingPatched = true;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalOnNodeCreated?.apply(this, arguments);
      ensureRows(this);
      return result;
    };

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalOnConfigure?.apply(this, arguments);
      ensureRows(this);
      return result;
    };

    const originalOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = originalOnConnectionsChange?.apply(this, arguments);
      ensureRows(this);
      return result;
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = originalOnExecuted?.apply(this, arguments);
      updateDisplay(this, message?.text);
      return result;
    };
  },
});
