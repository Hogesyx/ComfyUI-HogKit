# Changelog

## 0.2.2

### Added

- Added a full, scrollable notes preview when hovering over a LoRA panel with valid non-empty metadata notes.
- Added hover support for the single-chain panel and both panels of the dual-chain loader in classic and Nodes 2.0 renderers.

### Fixed

- Fixed newly added chain rows not visually updating after selecting a LoRA in Nodes 2.0.
- Assigned unique identities to rebuilt custom widgets so the Vue renderer cannot remain bound to stale row instances.
- Made the active row repaint itself directly after LoRA selection, metadata loading, toggles, and strength changes.

## 0.2.1

### Fixed

- Made custom LoRA row hit testing tolerate controls that are absent from the single-chain layout.
- Fixed `rect is undefined` when interacting with a single-chain LoRA row in Nodes 2.0.

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
