import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

app.registerExtension({
  name: "HogKit.ImageScaler",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "HogKitImageScaler") return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onCreated?.apply(this, arguments);
      const display = ComfyWidgets.STRING(this, "resolved_resolution",
        ["STRING", { multiline: true }], app).widget;
      display.value = "Run to resolve the input image dimensions.";
      display.serialize = false;
      display.inputEl.readOnly = true;
      display.options ||= {};
      display.options.read_only = true;
      display.options.getMinHeight = () => 48;
      display.options.getMaxHeight = () => 64;
      display.inputEl.style.setProperty("--comfy-widget-min-height", "48px");
      display.inputEl.style.setProperty("--comfy-widget-max-height", "64px");
      return result;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = onExecuted?.apply(this, arguments);
      const display = this.widgets?.find(w => w.name === "resolved_resolution");
      if (display && message?.text) {
        display.value = message.text.join("\n");
        app.graph?.setDirtyCanvas(true, false);
      }
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const result = onConfigure?.apply(this, arguments);
      const values = data?.widgets_values;
      // Older workflows stored MP and multiple before fit and resolution rule.
      if (Array.isArray(values) && typeof values[1] === "number"
          && typeof values[2] === "number" && ["Pad", "Crop", "Stretch"].includes(values[4])) {
        const restored = {
          aspect_ratio: values[0], fit: values[4], resolution_rule: values[3],
          megapixels: values[1], multiple: values[2],
        };
        for (const [name, value] of Object.entries(restored)) {
          const widget = this.widgets?.find(w => w.name === name);
          if (widget) widget.value = value;
        }
      }
      return result;
    };
  },
});
