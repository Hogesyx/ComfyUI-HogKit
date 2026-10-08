# H3 AdaLN compatibility resources

`h3_silu_temb_grid.safetensors` is redistributed unchanged from
[Larryvrh/ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo),
licensed under Apache-2.0. The complete license is in `LICENSE-Apache-2.0.txt`.
The tensor contains 1,025 samples of the H3 dense SiLU timestep embedding.

The affine AdaLN projection and offset restoration in `lora_compat.py` were
informed by [cicalooo/ComfyUI-H3-PowerLoraStack](https://github.com/cicalooo/ComfyUI-H3-PowerLoraStack)
(`h3lora/adaln.py`, Apache-2.0). HogKit implements this independently using
ComfyUI's native key mappings and additive LoRA/bias patches.

The rest of HogKit retains its existing GPL-3.0-only license. No network download
or installation of either project is required to use the compatibility helper.
