"""H3 AdaLN basis conversion before ComfyUI's ordinary additive LoRA loading.

The affine projection follows the H3 PowerLoraStack AdaLN port. See data/NOTICE.md.
Only MiniMaxH3 models enter this path; other architectures delegate to LoraLoader.
"""

import logging
from functools import lru_cache
from pathlib import Path
from weakref import WeakKeyDictionary

import torch
import comfy.lora
import comfy.model_base
import comfy.sd
import comfy.utils
import folder_paths
from nodes import LoraLoader


LOG = logging.getLogger(__name__)
MAX_RESIDUAL = 5e-3
_BASIS_CACHE = WeakKeyDictionary()
_PAIRS = (
    (".lora_down.weight", ".lora_up.weight"),
    ("_lora.down.weight", "_lora.up.weight"),
    (".lora_A.weight", ".lora_B.weight"),
    (".lora.down.weight", ".lora.up.weight"),
    (".lora_A", ".lora_B"),
    (".lora_linear_layer.down.weight", ".lora_linear_layer.up.weight"),
    (".lora_A.default.weight", ".lora_B.default.weight"),
)


def _cpu(tensor):
    return tensor.detach().to(device="cpu", dtype=torch.float32)


@lru_cache(maxsize=1)
def _dense_grid():
    path = Path(__file__).parent / "data" / "h3_silu_temb_grid.safetensors"
    return _cpu(comfy.utils.load_torch_file(str(path), safe_load=True)["silu_t_emb_grid"])


def _fit_affine(source, target):
    """source(t) ~= offset + target(t) @ matrix.T; solve on CPU in float64."""
    source, target = _cpu(source).double(), _cpu(target).double()
    if source.ndim != 2 or target.ndim != 2 or source.shape[0] != target.shape[0]:
        raise ValueError("HogKit H3 AdaLN: source and target timestep grids must have matching rows.")
    design = torch.cat((torch.ones(target.shape[0], 1, dtype=torch.float64), target), dim=1)
    solution = torch.linalg.lstsq(design, source).solution
    residual = float((design @ solution - source).norm() / source.norm().clamp(min=1e-12))
    if not torch.isfinite(solution).all() or not residual <= MAX_RESIDUAL:
        raise ValueError(f"HogKit H3 AdaLN: basis fit residual {residual:.3g} exceeds {MAX_RESIDUAL}; "
                         "this checkpoint needs its own matching timestep basis.")
    return solution[1:].T.float().contiguous(), solution[0].float(), residual


def _target_basis(diffusion_model, table):
    # Cloned ModelPatchers share the diffusion model. Cache without keeping it alive.
    try:
        version = table._version
    except RuntimeError:  # Inference tensors have no version counter; tables are immutable.
        version = None
    signature = (id(table), version)
    cached = _BASIS_CACHE.get(diffusion_model)
    if cached is None or cached[0] != signature:
        cached = (signature, _fit_affine(_dense_grid(), table))
        _BASIS_CACHE[diffusion_model] = cached
    return cached[1]


def _source_table(state):
    tables = [value for key, value in state.items()
              if key == "adaln_t_table" or key.endswith(".adaln_t_table")]
    if len(tables) > 1:
        raise ValueError("HogKit H3 AdaLN: ambiguous source timestep tables in LoRA.")
    return tables[0] if tables else None


def _live_dense_grid(diffusion_model, rows):
    embedder = diffusion_model.time_embedder
    iw, ib = _cpu(embedder.proj_in.weight), _cpu(embedder.proj_in.bias)
    ow, ob = _cpu(embedder.proj_out.weight), _cpu(embedder.proj_out.bias)
    half = iw.shape[1] // 2
    t = torch.linspace(0, 1, rows)[:, None]
    freqs = torch.exp(-torch.log(torch.tensor(10000.0)) * torch.arange(half) / half)
    emb = torch.cat(((t * freqs).cos(), (t * freqs).sin()), dim=1)
    return torch.nn.functional.silu(torch.nn.functional.silu(emb @ iw.T + ib) @ ow.T + ob)


def rebase_h3_lora(state, key_map, diffusion_model):
    """Return a copy only when conversion is needed; never mutate cached file tensors.

    DoRA, LoCon and explicit reshaping require different mathematics. Refuse these
    for an incompatible AdaLN layer before any model patches are applied.
    """
    table = getattr(diffusion_model, "adaln_t_table", None)
    source_table = _source_table(state)
    out = None
    converted = 0
    affines = {}
    for prefix, target_key in key_map.items():
        if not isinstance(target_key, str) or not target_key.endswith(".adaln_proj.linear.weight"):
            continue
        pair = next(((prefix + a, prefix + b) for a, b in _PAIRS if prefix + b in state), None)
        if pair is None:
            continue
        a_key, b_key = pair
        if a_key not in state:
            raise ValueError(f"HogKit H3 AdaLN: incomplete LoRA pair for {prefix}.")
        a, b = state[a_key], state[b_key]
        module_name = target_key.removeprefix("diffusion_model.").removesuffix(".weight")
        layer = diffusion_model.get_submodule(module_name)
        if a.ndim != 2 or b.ndim != 2 or a.shape[0] != b.shape[1] or b.shape[0] != layer.weight.shape[0]:
            raise ValueError(f"HogKit H3 AdaLN: malformed LoRA dimensions for {prefix}.")
        target_dim = layer.weight.shape[1]
        source_dim = a.shape[1]
        # Equal-width curves may still use a different basis when the LoRA supplies its table.
        rebase_tables = source_table is not None and table is not None and source_dim == source_table.shape[1]
        if source_dim == target_dim and not rebase_tables:
            continue
        if any(prefix + suffix in state for suffix in
               (".dora_scale", ".lora_magnitude_vector", ".lora_mid.weight", ".reshape_weight")):
            raise ValueError(f"HogKit H3 AdaLN: {prefix} needs conversion but uses DoRA/LoCon/reshape; "
                             "only ordinary linear LoRA pairs are supported.")
        affine_key = (source_dim, target_dim, rebase_tables)
        if affine_key not in affines:
            if rebase_tables:
                affine = _fit_affine(source_table, table)
            elif table is not None and source_dim == _dense_grid().shape[1] and target_dim == table.shape[1]:
                affine = _target_basis(diffusion_model, table)
            elif table is None and source_table is not None and source_dim == source_table.shape[1]:
                # Reverse projection requires the LoRA's actual source basis, never a guessed one.
                v, c, residual = _fit_affine(_live_dense_grid(diffusion_model, source_table.shape[0]), source_table)
                matrix = torch.linalg.pinv(v)
                affine = matrix, -(matrix @ c), residual
            else:
                raise ValueError(f"HogKit H3 AdaLN: cannot map {prefix} width {source_dim} to {target_dim}. "
                                 "Curve-trained LoRAs need their source adaln_t_table for conversion.")
            affines[affine_key] = affine
        affine = affines[affine_key]
        matrix, offset, residual = affine
        if matrix.shape != (source_dim, target_dim):
            raise ValueError(f"HogKit H3 AdaLN: incompatible source basis for {prefix}.")
        a32, b32 = _cpu(a), _cpu(b)
        rank = a.shape[0]
        alpha = state.get(prefix + ".alpha")
        scale = float(alpha) / rank if alpha is not None else 1.0
        bias = scale * (b32 @ (a32 @ offset))
        bias_key = prefix + ".diff_b"
        if bias_key in state:
            bias = bias + _cpu(state[bias_key])
        if getattr(layer, "bias", None) is None:
            raise ValueError(f"HogKit H3 AdaLN: {prefix} has no bias for the required offset patch.")
        if out is None:
            out = dict(state)
        # Keep float32 to avoid extra bf16 rounding after projection; rank and alpha stay unchanged.
        out[a_key] = a32 @ matrix
        out[bias_key] = bias
        converted += 1
    if converted:
        # Basis sidecars are conversion metadata, not patches.
        for key in list(out):
            if key == "adaln_t_table" or key.endswith(".adaln_t_table"):
                del out[key]
        LOG.info("HogKit H3 AdaLN: converted %d layers; basis residual %.3g", converted, affine[2])
    return out if out is not None else state


class HogKitLoraLoader(LoraLoader):
    def load_lora(self, model, clip, lora_name, strength_model, strength_clip):
        h3_class = getattr(comfy.model_base, "MiniMaxH3", None)
        if (strength_model == 0 or model is None or h3_class is None
                or not isinstance(model.model, h3_class)):
            return super().load_lora(model, clip, lora_name, strength_model, strength_clip)

        path = folder_paths.get_full_path_or_raise("loras", lora_name)
        if self.loaded_lora is None or self.loaded_lora[0] != path:
            state, metadata = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
            self.loaded_lora = (path, state, metadata)
        state = self.loaded_lora[1]
        metadata = self.loaded_lora[2] if len(self.loaded_lora) > 2 else None
        key_map = comfy.lora.model_lora_keys_unet(model.model, {})
        adapted = rebase_h3_lora(state, key_map, model.model.diffusion_model)
        return comfy.sd.load_lora_for_models(model, clip, adapted, strength_model, strength_clip,
                                            lora_metadata=metadata)
