# ComfyUI-HogKit

ComfyUI custom nodes for LoRA workflows, image sizing, and workflow utilities.

## Requirements

- A current ComfyUI build with the Node 2.0 / V3 custom-node API.
- ComfyUI's normal Python dependencies. HogKit does not add a separate requirements file.

This project is a breaking-change project. Older HogKit node IDs and workflow layouts are not kept as compatibility aliases.

## Breaking change in 0.2.0

The former `HogKitLoraChainLoaderWithMetadata` node has been replaced by two purpose-specific nodes:

- `HogKitLoraSingleChainLoaderWithMetadata` for one model/CLIP pipeline and one LoRA per row.
- `HogKitLoraDualChainLoaderWithMetadata` for two model/CLIP pipelines and paired LoRAs per row.

Workflows containing the former chain-loader node must replace it with the appropriate new node. The metadata sidecar format is unchanged, so existing `.metadata.json` files continue to work.

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
- **HogKit LoRA Single Chain Loader with Metadata** applies a configurable LoRA stack to one model and optional CLIP.
- **HogKit LoRA Dual Chain Loader with Metadata** applies paired LoRA stacks to two model/CLIP pipelines and combines prompt fragments from metadata.

All four loaders automatically handle ordinary dense MiniMax H3 AdaLN LoRAs on
pruned/curve H3 checkpoints. The conversion preserves LoRA rank and alpha and
restores the constant term with a native additive bias patch, so strengths and
multiple stacked LoRAs keep working. It runs only when ComfyUI identifies the
loaded model as MiniMax H3. Qwen Image, Qwen Image 2.1, and other models use the
native ComfyUI loader unchanged; compatible H3 pairs also stay unchanged.

HogKit fits its bundled H3 timestep grid to the loaded checkpoint's curve table
and rejects fits with relative residual above 0.005. Curve-trained LoRAs need
their source `adaln_t_table` tensor to convert to dense models or another curve
basis. Mismatched DoRA, LoCon, and reshape adapters are rejected rather than
partially applied. A dimension match alone cannot identify an undocumented
different curve basis. This addresses AdaLN basis mismatches; it cannot make a
LoRA trained for a different architecture compatible.

The helper requires no extra node or network download. Do not load the same
LoRA again in a separate AdaLN-fix node. It does not repair patches already
applied by upstream loaders. Resource credits are in [data/NOTICE.md](data/NOTICE.md).
Restart ComfyUI after updating HogKit to load the Python changes.

The chain loader stores metadata beside each LoRA. For example:

```text
models/loras/style.safetensors
models/loras/style.metadata.json
```

Hover over a selected LoRA panel to preview the complete `notes` value from its metadata. The preview is available on the single-chain loader and on both LoRA panels in the dual-chain loader. It appears only when the sidecar contains valid JSON with a non-empty string `notes` value.

The metadata editor writes only to the resolved LoRA folder. The ComfyUI process must have permission to write there.

Both chain loaders support the classic canvas and Nodes 2.0 renderers. The node and sidebar maintain independent canvas geometry, so adding a row, selecting a LoRA, changing its strength, toggling it, editing metadata, or removing it remains interactive across redraws, resizing, and expansion.

The stack uses one stable widget with zoom-correct sizing and ComfyUI's native widget font. Single LoRAs use compact cards; paired LoRAs occupy separate lines within each card. Drag the grip to reorder: the card follows the pointer and neighboring cards animate into place. Releasing commits the new order; cancelling preserves the original order.

### Image

- **HogKit Load Image** loads images from the ComfyUI input directory or one-level subfolders. Use the folder selector to filter images, the refresh button to rescan the input directory, and the native upload control to browse for a new image. The selected image is previewed on the node.
- **HogKit Auto Resolution Selector** selects a stock aspect ratio and target dimensions from an image or override dimensions. It passes the image through and outputs `width` and `height`.
- **HogKit Image Scaler** crops or pads an image to a standard aspect ratio at source resolution, then resizes once to aligned output dimensions. It outputs the image, width, height, actual megapixels, and a resolution summary.
- **HogKit Qwen Image Scaler** pads or crops images to the selected Qwen Image resolution.

#### HogKit Image Scaler

1. Choose an aspect ratio, or **Auto** for the closest standard ratio to the input. Auto compares proportional ratio differences consistently for portrait and landscape images.
2. Choose **Pad** to add borders at source resolution, **Crop** to trim original pixels to the selected ratio, or **Stretch** to change proportions during the final resize. Positioning, padding color, and resampling are under advanced inputs.
3. Set **megapixels** to **0** to use the fitted pixel area, or enter an explicit target. Pad includes added borders in the area; Crop uses the remaining image area; Stretch uses the original input area. As in ComfyUI's Resolution Selector, 1 MP means 1024 × 1024 pixels.
4. Set **multiple** to the required dimension alignment (default 32). **0** uses the standard alignment of 8; it does not infer model requirements from image dimensions.
5. Choose **Closest**, **At least target MP**, or **At most target MP**. The latter two constrain total pixel area relative to the fitted area or explicit MP override. The aligned size balances proportional area and aspect-ratio error around the ideal target.

For example, a 1600 × 900 input fitted to square has a 1600 × 1600 Pad canvas or a 900 × 900 Crop region. With MP 0, alignment and the resolution rule apply to those respective areas. With an explicit 1 MP target, both resolve to a 1024 × 1024 output when the multiple allows it. Crop and Pad operate without interpolation; resampling happens once, after fitting.

Alignment can change the final ratio and actual MP slightly. The result display updates after execution and includes source, fit, and output dimensions. The `resolution` output also contains this summary. Images can be enlarged or reduced in all fitting modes; there is no separate scale-mode selector.

This node calculates generic dimensions; it does not select Qwen's exact recommended resolution buckets. For example, requesting 4 MP and multiple 32 is not a guarantee of Qwen's 2400 × 1792 bucket.

Padding accepts PIL color names and hex colors, including alpha for RGBA images. Invalid padding colors report an error. Grayscale, RGB, RGBA, and image batches retain their channels and floating-point precision.

The HogKit Load Image selector supports both the main Nodes 2.0 node and sidebar at different widths. Selecting or uploading an image updates both views without changing either view's control hitboxes.

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
python -m unittest discover -s tests -p "test_lora_*.py" -v
node --check web/node_status.js
node --check web/show_convert_anything.js
node --check web/lora_chain_loader_with_metadata.js
node --test tests/lora_chain_widget.test.cjs
node --check web/recursive_load_image.js
```

Use ComfyUI's Python for the LoRA checks (PyTorch is required). Set
`COMFYUI_PATH` to the directory containing ComfyUI's `nodes.py` to also run the
optional CPU integration check against its native patcher and Qwen model classes.

## License

Licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html). See [LICENSE](LICENSE) for the license notice and official full text.

Commercial use, modification, and redistribution are permitted under GPLv3's copyleft terms.
