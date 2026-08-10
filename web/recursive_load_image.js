import { app } from "../../scripts/app.js";

const NODE_NAME = "HogKitLoadImage";
const IMAGE_WIDGET = "image";
const SELECTOR_WIDGET = "image_selector";
let activePicker = null;

function getInputOptions(nodeData) {
  const input = nodeData?.input?.required?.[IMAGE_WIDGET]
    || nodeData?.input?.optional?.[IMAGE_WIDGET];
  return input?.[1] || {};
}

function getImageChoices(nodeData) {
  const choices = getInputOptions(nodeData).image_choices;
  return choices && typeof choices === "object" ? choices : {};
}

function getImageFiles(choices) {
  return Object.values(choices).flatMap((files) => Array.isArray(files) ? files : []);
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function hideWidget(widget) {
  widget.type = "hidden";
  widget.options = { ...widget.options, hidden: true };
  widget.computeSize = () => [0, -4];
}

function fitText(ctx, text, maxWidth) {
  let value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
  while (value.length > 4 && ctx.measureText(`${value}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function imagePreviewUrl(image) {
  const normalized = image.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const filename = slash < 0 ? normalized : normalized.slice(slash + 1);
  const subfolder = slash < 0 ? "" : normalized.slice(0, slash);
  const params = new URLSearchParams({
    filename,
    type: "input",
    preview: "webp;64",
    channel: "rgb",
  });
  if (subfolder) {
    params.set("subfolder", subfolder);
  }
  return `/view?${params.toString()}`;
}

function redrawNode(node) {
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
}

function setImageWidgetValue(node, image, event) {
  const inputWidget = node.imageInputWidget;
  if (!inputWidget) {
    return;
  }

  if (typeof inputWidget.setValue === "function" && app.canvas) {
    inputWidget.setValue(image, { e: event, node, canvas: app.canvas });
    return;
  }

  const previous = inputWidget.value;
  inputWidget.value = image;
  inputWidget.callback?.call(inputWidget, image);
  node.onWidgetChanged?.(IMAGE_WIDGET, image, previous, inputWidget);
}

function setSelectedImage(node, image, event) {
  node.selectedImage = image;
  node.imageSelectorWidget?.setValue(image);
  setImageWidgetValue(node, image, event);
  redrawNode(node);
}

function syncImageChoices(node) {
  const files = getImageFiles(node.imageChoices || {});
  const selected = files.includes(node.selectedImage) ? node.selectedImage : (files[0] || "");
  node.selectedImage = selected;
  if (node.imageInputWidget) {
    node.imageInputWidget.options = node.imageInputWidget.options || {};
    node.imageInputWidget.options.values = files;
    if (node.imageInputWidget.value !== selected) {
      node.selectedImage = selected;
      setImageWidgetValue(node, selected);
    }
  }
  if (node.imageSelectorWidget) {
    node.imageSelectorWidget.setValue(selected);
  }
  node.imageSelectorWidget?.setDirty?.();
}

function makeButton(label, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.background = "#333";
  button.style.border = "1px solid #666";
  button.style.borderRadius = "3px";
  button.style.color = "#ddd";
  button.style.cursor = "pointer";
  button.style.padding = "4px 8px";
  button.addEventListener("click", callback);
  return button;
}

function addImageItem(list, node, image, close) {
  const item = document.createElement("button");
  item.type = "button";
  item.style.alignItems = "center";
  item.style.background = image === node.selectedImage ? "#454f61" : "#292929";
  item.style.border = "1px solid #4a4a4a";
  item.style.borderRadius = "4px";
  item.style.color = "#ddd";
  item.style.cursor = "pointer";
  item.style.display = "flex";
  item.style.gap = "8px";
  item.style.minHeight = "72px";
  item.style.overflow = "hidden";
  item.style.padding = "4px";
  item.style.textAlign = "left";
  item.style.width = "100%";

  const thumbnail = document.createElement("img");
  thumbnail.alt = "";
  thumbnail.loading = "lazy";
  thumbnail.src = imagePreviewUrl(image);
  thumbnail.style.background = "#111";
  thumbnail.style.height = "62px";
  thumbnail.style.objectFit = "contain";
  thumbnail.style.width = "62px";

  const label = document.createElement("span");
  label.textContent = image;
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";

  item.append(thumbnail, label);
  item.addEventListener("click", () => {
    setSelectedImage(node, image);
    close();
  });
  list.append(item);
}

function renderImagePicker(picker, node) {
  const { content, close } = picker;
  content.replaceChildren();
  const choices = node.imageChoices || {};
  const folders = Object.keys(choices);
  const rootFolder = folders[0];
  const orderedFolders = [...folders.slice(1), rootFolder].filter(Boolean);

  orderedFolders.forEach((folder) => {
    const files = Array.isArray(choices[folder]) ? choices[folder] : [];
    if (folder === rootFolder) {
      const heading = document.createElement("div");
      heading.textContent = folder;
      heading.style.color = "#aaa";
      heading.style.fontSize = "11px";
      heading.style.margin = "4px 0";
      content.append(heading);
      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gap = "5px";
      files.forEach((image) => addImageItem(list, node, image, close));
      content.append(list);
      return;
    }

    const group = document.createElement("details");
    group.style.marginTop = "6px";
    const summary = document.createElement("summary");
    summary.textContent = `${folder} (${files.length})`;
    summary.style.color = "#ccc";
    summary.style.cursor = "pointer";
    summary.style.padding = "5px 2px";
    group.append(summary);

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "5px";
    list.style.marginTop = "5px";
    files.forEach((image) => addImageItem(list, node, image, close));
    group.append(list);
    content.append(group);
  });

  if (!folders.length || folders.every((folder) => !choices[folder]?.length)) {
    const empty = document.createElement("div");
    empty.textContent = "No images found.";
    empty.style.color = "#aaa";
    empty.style.padding = "12px 4px";
    content.append(empty);
  }
}

function closeImagePicker() {
  activePicker?.close();
  activePicker = null;
}

async function uploadImageFile(node, file) {
  const form = new FormData();
  form.append("image", file);
  form.append("type", "input");
  const response = await fetch("/upload/image", { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`Image upload failed (${response.status})`);
  }

  const result = await response.json();
  const choicesResponse = await fetch("/hogkit/load-image/files");
  if (!choicesResponse.ok) {
    throw new Error(`Image list refresh failed (${choicesResponse.status})`);
  }
  node.imageChoices = await choicesResponse.json();
  syncImageChoices(node);

  const image = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  if (getImageFiles(node.imageChoices).includes(image)) {
    setSelectedImage(node, image);
  }
  return image;
}

function showImagePicker(node, event) {
  closeImagePicker();

  const popup = document.createElement("div");
  popup.style.background = "#202020";
  popup.style.border = "1px solid #666";
  popup.style.borderRadius = "5px";
  popup.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.45)";
  popup.style.color = "#ddd";
  popup.style.maxHeight = "520px";
  popup.style.maxWidth = "520px";
  popup.style.minWidth = "320px";
  popup.style.overflow = "hidden";
  popup.style.padding = "8px";
  popup.style.position = "fixed";
  popup.style.zIndex = "10000";

  const header = document.createElement("div");
  header.style.alignItems = "center";
  header.style.display = "flex";
  header.style.gap = "6px";
  header.style.marginBottom = "6px";

  const title = document.createElement("span");
  title.textContent = "Select image";
  title.style.fontWeight = "bold";
  title.style.marginRight = "auto";

  const refresh = makeButton("Refresh", async () => {
    refresh.disabled = true;
    try {
      const response = await fetch("/hogkit/load-image/files");
      if (!response.ok) {
        throw new Error(`Image list refresh failed (${response.status})`);
      }
      node.imageChoices = await response.json();
      syncImageChoices(node);
      renderImagePicker(picker, node);
    } catch (error) {
      console.error(error);
    } finally {
      refresh.disabled = false;
    }
  });

  const uploadInput = document.createElement("input");
  uploadInput.accept = "image/*,video/*";
  uploadInput.type = "file";
  uploadInput.style.display = "none";
  const upload = makeButton("Upload", () => uploadInput.click());
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (!file) {
      return;
    }
    upload.disabled = true;
    try {
      await uploadImageFile(node, file);
      renderImagePicker(picker, node);
    } catch (error) {
      console.error(error);
    } finally {
      upload.disabled = false;
      uploadInput.value = "";
    }
  });

  header.append(title, refresh, upload, uploadInput);
  popup.append(header);

  const content = document.createElement("div");
  content.style.maxHeight = "455px";
  content.style.overflowY = "auto";
  popup.append(content);
  document.body.append(popup);

  const close = () => {
    document.removeEventListener("pointerdown", closeOutside, true);
    document.removeEventListener("keydown", closeEscape, true);
    popup.remove();
    if (activePicker?.popup === popup) {
      activePicker = null;
    }
  };
  const closeOutside = (pointerEvent) => {
    if (!popup.contains(pointerEvent.target)) {
      close();
    }
  };
  const closeEscape = (keyboardEvent) => {
    if (keyboardEvent.key === "Escape") {
      close();
    }
  };
  const picker = { popup, content, close };
  activePicker = picker;
  renderImagePicker(picker, node);
  document.addEventListener("pointerdown", closeOutside, true);
  document.addEventListener("keydown", closeEscape, true);

  const clientX = Number.isFinite(event?.clientX) ? event.clientX : window.innerWidth / 2;
  const clientY = Number.isFinite(event?.clientY) ? event.clientY : window.innerHeight / 2;
  popup.style.left = `${Math.min(clientX, window.innerWidth - popup.offsetWidth - 8)}px`;
  popup.style.top = `${Math.min(clientY, window.innerHeight - popup.offsetHeight - 8)}px`;
}

function drawCanvasButton(ctx, rect, label) {
  ctx.save();
  ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
  ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
}

class ImageSelectorWidget {
  constructor(node) {
    this.type = "custom";
    this.name = SELECTOR_WIDGET;
    this.serialize = false;
    this.node = node;
    this.value = node.selectedImage || "";
    this.browseRect = null;
    this.computeSize = this.computeSize.bind(this);
    this.setValue = this.setValue.bind(this);
    this.draw = this.draw.bind(this);
    this.mouse = this.mouse.bind(this);
    this.onClick = this.onClick.bind(this);
    this.openFileBrowser = this.openFileBrowser.bind(this);
    this.setDirty = this.setDirty.bind(this);
  }

  computeSize(width) {
    return [width, 28];
  }

  setValue(value) {
    this.value = value || "";
    redrawNode(this.node);
  }

  draw(ctx, node, width, y) {
    const browseWidth = 64;
    const gap = 6;
    const selectWidth = Math.max(80, width - browseWidth - gap);
    const height = 24;
    const top = y + 2;
    this.browseRect = { x: selectWidth + gap, y: top, w: browseWidth, h: height };
    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
    ctx.beginPath();
    ctx.roundRect(0, top, selectWidth, height, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, this.value || "Select an image", selectWidth - 28), 8, top + height / 2);

    ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR || "#aaa";
    ctx.beginPath();
    ctx.moveTo(selectWidth - 15, top + 9);
    ctx.lineTo(selectWidth - 7, top + 9);
    ctx.lineTo(selectWidth - 11, top + 15);
    ctx.closePath();
    ctx.fill();
    drawCanvasButton(ctx, this.browseRect, "Upload");
    ctx.restore();
  }

  isBrowsePosition(x, y) {
    const rect = this.browseRect;
    return rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  mouse(event, pos, node) {
    if (event.type !== "pointerdown") {
      return false;
    }
    if (this.isBrowsePosition(pos[0], pos[1])) {
      this.openFileBrowser();
      return true;
    }
    showImagePicker(node, event);
    return true;
  }

  onClick(options) {
    const event = options.e;
    const x = event?.canvasX - this.node.pos[0];
    const y = event?.canvasY - this.node.pos[1];
    if (this.isBrowsePosition(x, y)) {
      this.openFileBrowser();
      return;
    }
    showImagePicker(this.node, event);
  }

  openFileBrowser() {
    this.node.imageUploadInput?.click();
  }

  setDirty() {
    redrawNode(this.node);
  }
}

function setupNode(node, nodeData) {
  const imageWidget = getWidget(node, IMAGE_WIDGET);
  if (!imageWidget) {
    return;
  }

  node.imageChoices = node.imageChoices || getImageChoices(nodeData);
  if (!node.imageSelectorWidget) {
    node.imageInputWidget = imageWidget;
    node.selectedImage = imageWidget.value || "";
    imageWidget.serializeValue = () => node.selectedImage || "";
    const originalCallback = imageWidget.callback;
    imageWidget.callback = function (value) {
      originalCallback?.apply(this, arguments);
      if (typeof value === "string" && value !== node.selectedImage) {
        node.selectedImage = value;
        node.imageSelectorWidget?.setValue(value);
      }
      redrawNode(node);
    };
    hideWidget(imageWidget);
    const uploadWidget = getWidget(node, "upload");
    if (uploadWidget) {
      hideWidget(uploadWidget);
    }
    const uploadInput = document.createElement("input");
    uploadInput.accept = "image/*,video/*";
    uploadInput.type = "file";
    uploadInput.style.position = "fixed";
    uploadInput.style.left = "-10000px";
    uploadInput.addEventListener("change", async () => {
      const file = uploadInput.files?.[0];
      uploadInput.value = "";
      if (!file) {
        return;
      }
      try {
        await uploadImageFile(node, file);
      } catch (error) {
        console.error(error);
      }
    });
    document.body.append(uploadInput);
    node.imageUploadInput = uploadInput;
    const originalOnRemoved = node.onRemoved;
    node.onRemoved = function () {
      uploadInput.remove();
      originalOnRemoved?.apply(this, arguments);
    };
    node.imageSelectorWidget = node.addCustomWidget(new ImageSelectorWidget(node));
    const size = node.computeSize();
    node.setSize([
      Math.max(node.size?.[0] || 0, size[0]),
      Math.max(node.size?.[1] || 0, size[1]),
    ]);
  }
  syncImageChoices(node);
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
