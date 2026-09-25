# Changelog

## 0.2.8

### Changed

- Aligned HogKit's custom LoRA dialogs, metadata fields, chooser, tooltip, and recursive image picker with ComfyUI's runtime font, widget colors, text colors, borders, and spacing instead of fixed dark-theme CSS values.
- Kept JSON/metadata editing monospace while matching ComfyUI's native text scale.
- Marked Show Convert Anything's display as a proper read-only widget instead of dimming it with a custom opacity override.

### Fixed

- Matched the recursive image selector's canvas text to ComfyUI's native widget font so it renders consistently with built-in node controls.

## 0.2.7

### Fixed

- Matched LoRA row, strength, toggle, edit, remove, and settings text to ComfyUI's native widget typography using the live `NODE_SUBTEXT_SIZE` and `NODE_FONT` values instead of hard-coded canvas fonts.
- Restored vertical breathing room to LoRA rows after the compact-row change so controls no longer visually crowd or overlap.

## 0.2.6

### Fixed

- Made LoRA rows more compact, kept them in place while dragging, and applied the reorder on release. Metadata details now appear on hover.

## 0.2.5

### Fixed

- Kept LoRA row drag/reordering attached to the active custom widget instead of rebuilding the widget tree during an in-progress pointer gesture.
- Stopped Nodes 2.0 from forcing node heights through legacy `computeSize()` / `setSize()` paths, allowing the Vue renderer and ResizeObserver to remain the height source of truth.
- Switched hidden backend widgets to ComfyUI's modern visibility facade while retaining the legacy hidden-widget fallback for older frontends.
- Capped the Show Convert Anything read-only display widget to a compact height so multiline output no longer inflates the node.

## 0.2.4

### Fixed

- Kept Nodes 2.0 canvas geometry and control hitboxes separate for the main node and sidebar, so selecting a LoRA no longer makes the metadata and remove buttons unclickable until resize.
- Kept custom-widget redraw callbacks for every mounted Nodes 2.0 host instead of allowing the sidebar renderer to replace the main node renderer.
- Applied the same multi-host redraw and hitbox handling to the recursive image selector, keeping its selector and upload controls synchronized at different node/sidebar widths.

## 0.2.3

### Fixed

- Fixed unreliable toggle, metadata, remove, strength, and settings controls after resizing or expanding a chain loader in Nodes 2.0.
- Normalized Vue-hosted widget pointer coordinates against the canvas's rendered bounds while preserving classic-canvas event handling.

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
