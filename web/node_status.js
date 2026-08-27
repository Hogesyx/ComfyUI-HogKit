import { app } from "../../scripts/app.js";

const NODE_NAME = "HogKitNodeStatus";
const SWITCH_NODE_NAME = "HogKitNodeStatusIfElseSwitch";
const TARGET_INPUT = "target";
const STATUS_WIDGET = "target_status";
const MODE_MUTED = globalThis.LiteGraph?.NEVER ?? 2;
const MODE_BYPASSED = globalThis.LiteGraph?.BYPASS ?? 4;
const STATUS_NODE_NAMES = new Set([NODE_NAME, SWITCH_NODE_NAME]);

function getTargetInput(node) {
  return node.inputs?.find((input) => input.name === TARGET_INPUT);
}

function getGraphLink(graph, linkId) {
  return graph?.links?.[linkId]
    || graph?._links?.get?.(linkId)
    || graph?._links?.[linkId]
    || null;
}

function getTargetNode(node) {
  const targetInput = getTargetInput(node);
  if (targetInput?.link == null) {
    return null;
  }

  const graph = node.graph || app.graph;
  const link = getGraphLink(graph, targetInput.link);
  return link ? graph.getNodeById(link.origin_id) : null;
}

function getTargetStatus(node) {
  const targetNode = getTargetNode(node);
  if (!targetNode) {
    return "unknown";
  }
  if (targetNode.mode === MODE_BYPASSED) {
    return "bypassed";
  }
  if (targetNode.mode === MODE_MUTED) {
    return "muted";
  }
  return "working";
}

function updateStatus(node) {
  const widget = node.widgets?.find((candidate) => candidate.name === STATUS_WIDGET);
  if (widget) {
    widget.value = getTargetStatus(node);
  }
}

function hideWidget(widget) {
  widget.type = "hidden";
  widget.options = { ...widget.options, hidden: true };
  widget.computeSize = () => [0, -4];
}

function ensureTargetInput(node) {
  let targetInput = node.inputs?.find((input) => input.name === TARGET_INPUT);
  if (!targetInput) {
    targetInput = node.addInput(TARGET_INPUT, "*");
  }

  const targetIndex = node.inputs?.indexOf(targetInput) ?? -1;
  if (targetIndex > 0) {
    node.inputs.splice(targetIndex, 1);
    node.inputs.unshift(targetInput);
  }
}

function setupStatusWidget(node) {
  const widget = node.widgets?.find((candidate) => candidate.name === STATUS_WIDGET);
  if (!widget) {
    return;
  }

  hideWidget(widget);
  if (widget.nodeStatusPatched) {
    return;
  }
  widget.nodeStatusPatched = true;
  const originalBeforeQueued = widget.beforeQueued;
  widget.beforeQueued = (context) => {
    originalBeforeQueued?.call(widget, context);
    updateStatus(node);
  };
}

function getStatusNodes(graph) {
  return (graph?._nodes || []).filter((node) => (
    STATUS_NODE_NAMES.has(node.comfyClass) || STATUS_NODE_NAMES.has(node.type)
  ));
}

app.registerExtension({
  name: "NodeStatus",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!STATUS_NODE_NAMES.has(nodeData.name) || nodeType.prototype.nodeStatusPatched) {
      return;
    }

    nodeType.prototype.nodeStatusPatched = true;
    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalOnNodeCreated?.apply(this, arguments);
      ensureTargetInput(this);
      setupStatusWidget(this);
      return result;
    };

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalOnConfigure?.apply(this, arguments);
      ensureTargetInput(this);
      setupStatusWidget(this);
      return result;
    };
  },

  setup() {
    const originalGraphToPrompt = app.graphToPrompt;
    if (typeof originalGraphToPrompt !== "function") {
      return;
    }

    app.graphToPrompt = async function (...args) {
      const graph = args[0] || app.graph;
      const detachedLinks = [];
      for (const node of getStatusNodes(graph)) {
        updateStatus(node);
        const targetInput = getTargetInput(node);
        if (targetInput?.link != null) {
          detachedLinks.push([targetInput, targetInput.link]);
          targetInput.link = null;
        }
      }

      try {
        return await originalGraphToPrompt.apply(this, args);
      } finally {
        for (const [targetInput, link] of detachedLinks) {
          targetInput.link = link;
        }
      }
    };
  },
});
