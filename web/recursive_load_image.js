import { app } from "../../scripts/app.js";

const NODE_NAME = "HogKitLoadImage";
const ROOT_FOLDER = "(root)";
const FOLDER_WIDGET = "folder";
const IMAGE_WIDGET = "image";

function getInputOptions(nodeData, inputName) {
  const input = nodeData?.input?.required?.[inputName]
    || nodeData?.input?.optional?.[inputName];
  return input?.[1] || {};
}

function getImageChoices(nodeData) {
  const choices = getInputOptions(nodeData, FOLDER_WIDGET).image_choices;
  return choices && typeof choices === "object" ? choices : { [ROOT_FOLDER]: [] };
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function setWidgetValues(widget, values, preferredValue) {
  if (!widget) {
    return;
  }

  widget.options = widget.options || {};
  widget.options.values = values;
  const nextValue = values.includes(preferredValue) ? preferredValue : (values[0] || "");
  if (widget.value !== nextValue) {
    widget.value = nextValue;
  }
}

function updateImageChoices(node) {
  const folderWidget = getWidget(node, FOLDER_WIDGET);
  const imageWidget = getWidget(node, IMAGE_WIDGET);
  const choices = node.imageChoices || { [ROOT_FOLDER]: [] };
  const folders = Object.keys(choices);
  const folder = folders.includes(folderWidget?.value) ? folderWidget.value : ROOT_FOLDER;

  setWidgetValues(folderWidget, folders, folder);
  setWidgetValues(imageWidget, choices[folder] || [], imageWidget?.value);
  node.setDirtyCanvas?.(true, false);
}

async function refreshImageChoices(node) {
  const response = await fetch("/hogkit/load-image/files");
  if (!response.ok) {
    throw new Error(`Image list refresh failed (${response.status})`);
  }
  node.imageChoices = await response.json();
  updateImageChoices(node);
}

function setupFolderWidget(node) {
  const folderWidget = getWidget(node, FOLDER_WIDGET);
  if (!folderWidget || folderWidget.recursiveLoadImagePatched) {
    return;
  }

  folderWidget.recursiveLoadImagePatched = true;
  const originalCallback = folderWidget.callback;
  folderWidget.callback = function (...args) {
    originalCallback?.apply(this, args);
    updateImageChoices(node);
  };
}

function addRefreshWidget(node) {
  if (node.widgets?.some((widget) => widget.recursiveLoadImageRefresh)) {
    return;
  }

  const refreshWidget = node.addWidget(
    "button",
    "Refresh image list",
    null,
    () => refreshImageChoices(node).catch((error) => console.error(error)),
  );
  refreshWidget.recursiveLoadImageRefresh = true;
  refreshWidget.serialize = false;
}

function setupNode(node, nodeData) {
  node.imageChoices = node.imageChoices || getImageChoices(nodeData);
  setupFolderWidget(node);
  updateImageChoices(node);
  addRefreshWidget(node);
}

app.registerExtension({
  name: "RecursiveLoadImage",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME || nodeType.prototype.recursiveLoadImagePatched) {
      return;
    }

    nodeType.prototype.recursiveLoadImagePatched = true;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalOnNodeCreated?.apply(this, arguments);
      setupNode(this, nodeData);
    };

    const originalConfigure = nodeType.prototype.configure;
    nodeType.prototype.configure = function () {
      originalConfigure?.apply(this, arguments);
      setupNode(this, nodeData);
    };
  },
});
