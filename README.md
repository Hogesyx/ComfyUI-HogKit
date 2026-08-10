# ComfyUI-HogKit

ComfyUI custom nodes for LoRA workflows, image sizing, and workflow utilities.

## Requirements

- A current ComfyUI build with the Node 2.0 / V3 custom-node API.
- ComfyUI's normal Python dependencies. HogKit does not add a separate requirements file.

This project is a breaking-change project. Older HogKit node IDs and workflow layouts are not kept as compatibility aliases.

## Installation

Clone the repository into ComfyUI's `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Hogesyx/ComfyUI-HogKit.git
```

Restart ComfyUI after installation or after updating the plugin.

## Nodes

### LoRA

- **HogKit LoRA Dual Loader with Prompt** applies up to two LoRAs and appends an optional prompt fragment.
- **HogKit LoRA Single Loader with Prompt** is the single-model/single-CLIP version.
- **HogKit LoRA Chain Loader with Metadata** applies a configurable LoRA stack and combines prompt fragments from metadata.

The chain loader stores metadata beside each LoRA. For example:

```text
models/loras/style.safetensors
models/loras/style.metadata.json
```

The metadata editor writes only to the resolved LoRA folder. The ComfyUI process must have permission to write there.

### Image

- **HogKit Load Image** loads images from the ComfyUI input directory and includes files in nested subfolders.
- **HogKit Auto Resolution Selector** selects a stock aspect ratio and target dimensions from an image or override dimensions. It passes the image through and outputs `width` and `height`.
- **HogKit Qwen Image Scaler** pads or crops images to the selected Qwen Image resolution.

For Auto Resolution Selector, `override_width` and `override_height` are advanced inputs. With an image connected, either nonzero override can replace its corresponding dimension when calculating the aspect ratio. Without an image, Auto mode requires both overrides.

### Utilities

- **HogKit Node Status** reports whether a connected node is working, muted, or bypassed.
- **HogKit Node Status If/Else Switch** routes `on_true` or `on_false` from a target node's status. Its `target` connection is virtual and is not submitted as a backend dependency.
- **HogKit String/Integer/Float/Boolean Fallback** uses the in-node fallback only when the connected value is missing or `None`.
- **HogKit Show Convert Anything** displays and routes multiple values through one node, with optional per-value conversion. `Auto` preserves the incoming value and type.

## Development checks

Run these from the plugin directory:

```bash
python -m py_compile *.py
node --check web/node_status.js
node --check web/show_convert_anything.js
node --check web/lora_chain_loader_with_metadata.js
```

## License

Licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html). See [LICENSE](LICENSE) for the license notice and official full text.

Commercial use, modification, and redistribution are permitted under GPLv3's copyleft terms.
