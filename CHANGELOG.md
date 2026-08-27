# Changelog

## 0.2.0

### Breaking changes

- Replaced `HogKitLoraChainLoaderWithMetadata` with separate single- and dual-chain loaders.
- Added `HogKitLoraSingleChainLoaderWithMetadata` for one model/CLIP pipeline and one LoRA per row.
- Added `HogKitLoraDualChainLoaderWithMetadata` for paired LoRAs across two model/CLIP pipelines.
- Existing workflows must replace the former chain-loader node; no compatibility alias is provided.

### Nodes 2.0

- Added explicit Vue-hosted widget redraws after LoRA and image-selector state changes.
- Made frontend prototype patching idempotent.
- Switched dynamic LoRA widget cleanup to ComfyUI's widget-removal lifecycle.
- Preserved original lifecycle callback return values and synchronized node resizing through `setSize()`.
