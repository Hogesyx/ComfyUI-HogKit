"""CPU regression checks; run with ComfyUI's Python (torch required)."""

import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import torch


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "blocks.0.adaln_proj.linear"
KEY_MAP = {PREFIX: "diffusion_model." + PREFIX + ".weight"}


class NativeLoader:
    def __init__(self):
        self.loaded_lora = None

    def load_lora(self, *args):
        return ("native", args)


class H3:
    pass


def load_helper():
    comfy = ModuleType("comfy")
    comfy.lora = ModuleType("comfy.lora")
    comfy.lora.model_lora_keys_unet = Mock(return_value=KEY_MAP)
    comfy.model_base = ModuleType("comfy.model_base")
    comfy.model_base.MiniMaxH3 = H3
    comfy.sd = ModuleType("comfy.sd")
    comfy.sd.load_lora_for_models = Mock(return_value=("patched model", "patched clip"))
    comfy.utils = ModuleType("comfy.utils")
    comfy.utils.load_torch_file = Mock()
    folders = ModuleType("folder_paths")
    folders.get_full_path_or_raise = Mock(return_value="fixture.safetensors")
    nodes = ModuleType("nodes")
    nodes.LoraLoader = NativeLoader
    modules = {"comfy": comfy, "folder_paths": folders, "nodes": nodes}
    modules.update({"comfy." + name: getattr(comfy, name) for name in ("lora", "model_base", "sd", "utils")})
    spec = importlib.util.spec_from_file_location("hogkit_lora_compat_test", ROOT / "lora_compat.py")
    helper = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(helper)
    return helper


compat = load_helper()


def fixture(target_dim=2, source_dim=5):
    generator = torch.Generator().manual_seed(41)
    table = torch.randn(30, 2, generator=generator)
    matrix = torch.randn(5, 2, generator=generator)
    offset = torch.randn(5, generator=generator)
    grid = table @ matrix.T + offset
    dm = torch.nn.Module()
    dm.blocks = torch.nn.ModuleList([torch.nn.Module()])
    dm.blocks[0].adaln_proj = torch.nn.Module()
    dm.blocks[0].adaln_proj.linear = torch.nn.Linear(target_dim, 7)
    if target_dim == 2:
        dm.register_buffer("adaln_t_table", table)
    state = {
        PREFIX + ".lora_A.weight": torch.randn(3, source_dim, generator=generator),
        PREFIX + ".lora_B.weight": torch.randn(7, 3, generator=generator),
        PREFIX + ".alpha": torch.tensor(1.5),
        "unrelated.lora_A.weight": torch.randn(3, 5, generator=generator),
    }
    return dm, state, grid, matrix, offset


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        compat._BASIS_CACHE.clear()
        compat.comfy.sd.load_lora_for_models.reset_mock()

    def test_dense_to_curve_preserves_rank_alpha_bias_and_input(self):
        dm, state, grid, _, _ = fixture()
        original = {key: value.clone() for key, value in state.items()}
        state[PREFIX + ".diff_b"] = torch.arange(7, dtype=torch.float32)
        with patch.object(compat, "_dense_grid", return_value=grid):
            result = compat.rebase_h3_lora(state, KEY_MAP, dm)
        self.assertEqual(result[PREFIX + ".lora_A.weight"].shape, (3, 2))
        self.assertIs(result[PREFIX + ".alpha"], state[PREFIX + ".alpha"])
        self.assertIs(result["unrelated.lora_A.weight"], state["unrelated.lora_A.weight"])
        expected = .5 * (grid @ state[PREFIX + ".lora_A.weight"].T @ state[PREFIX + ".lora_B.weight"].T)
        expected += state[PREFIX + ".diff_b"]
        actual = .5 * (dm.adaln_t_table @ result[PREFIX + ".lora_A.weight"].T @ result[PREFIX + ".lora_B.weight"].T)
        actual += result[PREFIX + ".diff_b"]
        torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)
        for key in original:
            torch.testing.assert_close(state[key], original[key])

    def test_all_native_pair_formats_and_kohya_alias(self):
        for a_suffix, b_suffix in compat._PAIRS:
            with self.subTest(a_suffix=a_suffix):
                dm, state, grid, _, _ = fixture()
                prefix = "lora_unet_blocks_0_adaln_proj_linear"
                renamed = {prefix + a_suffix: state[PREFIX + ".lora_A.weight"],
                           prefix + b_suffix: state[PREFIX + ".lora_B.weight"]}
                with patch.object(compat, "_dense_grid", return_value=grid):
                    result = compat.rebase_h3_lora(renamed, {prefix: KEY_MAP[PREFIX]}, dm)
                self.assertEqual(result[prefix + a_suffix].shape[1], 2)
                self.assertIn(prefix + ".diff_b", result)

    def test_matching_dense_and_curve_pairs_are_unchanged(self):
        for dimension in (2, 5):
            dm, state, *_ = fixture(dimension, dimension)
            self.assertIs(compat.rebase_h3_lora(state, KEY_MAP, dm), state)

    def test_curve_to_curve_with_different_basis(self):
        dm, state, _, _, _ = fixture(source_dim=2)
        source = dm.adaln_t_table @ torch.tensor([[2., 0.], [0., .5]]) + torch.tensor([1., -2.])
        state["adaln_t_table"] = source
        result = compat.rebase_h3_lora(state, KEY_MAP, dm)
        expected = .5 * source @ state[PREFIX + ".lora_A.weight"].T @ state[PREFIX + ".lora_B.weight"].T
        actual = .5 * dm.adaln_t_table @ result[PREFIX + ".lora_A.weight"].T @ result[PREFIX + ".lora_B.weight"].T
        actual += result[PREFIX + ".diff_b"]
        torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)
        self.assertNotIn("adaln_t_table", result)

    def test_curve_to_dense_requires_actual_source_table(self):
        dm, state, grid, *_ = fixture(target_dim=5, source_dim=2)
        with self.assertRaisesRegex(ValueError, "source adaln_t_table"):
            compat.rebase_h3_lora(state, KEY_MAP, dm)
        source_dm, *_ = fixture()
        state["adaln_t_table"] = source_dm.adaln_t_table
        with patch.object(compat, "_live_dense_grid", return_value=grid):
            result = compat.rebase_h3_lora(state, KEY_MAP, dm)
        expected = .5 * source_dm.adaln_t_table @ state[PREFIX + ".lora_A.weight"].T @ state[PREFIX + ".lora_B.weight"].T
        actual = .5 * grid @ result[PREFIX + ".lora_A.weight"].T @ result[PREFIX + ".lora_B.weight"].T
        actual += result[PREFIX + ".diff_b"]
        torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)

    def test_bad_basis_and_unsupported_adapters_fail(self):
        dm, state, grid, *_ = fixture()
        with patch.object(compat, "_dense_grid", return_value=torch.randn_like(grid)):
            with self.assertRaisesRegex(ValueError, "residual"):
                compat.rebase_h3_lora(state, KEY_MAP, dm)
        for suffix in (".dora_scale", ".lora_mid.weight", ".reshape_weight"):
            bad = dict(state, **{PREFIX + suffix: torch.ones(1)})
            with self.assertRaisesRegex(ValueError, "DoRA/LoCon/reshape"):
                compat.rebase_h3_lora(bad, KEY_MAP, dm)

    def test_stacked_strengths_are_additive(self):
        dm, state, grid, *_ = fixture()
        other = {key: value * .7 for key, value in state.items() if not key.endswith(".alpha")}
        with patch.object(compat, "_dense_grid", return_value=grid):
            results = [compat.rebase_h3_lora(s, KEY_MAP, dm) for s in (state, other)]
        actual = torch.zeros(30, 7)
        expected = torch.zeros_like(actual)
        for source, result, strength in zip((state, other), results, (0.8, -0.3)):
            scale = float(source.get(PREFIX + ".alpha", 3.)) / 3
            expected += strength * scale * (grid @ source[PREFIX + ".lora_A.weight"].T @ source[PREFIX + ".lora_B.weight"].T)
            actual += strength * (scale * (dm.adaln_t_table @ result[PREFIX + ".lora_A.weight"].T @ result[PREFIX + ".lora_B.weight"].T) + result[PREFIX + ".diff_b"])
        torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)

    def test_qwen_other_models_and_zero_strength_delegate_exactly(self):
        dm, *_ = fixture()
        h3 = H3()
        h3.diffusion_model = dm
        for model, strength in ((SimpleNamespace(model=SimpleNamespace(diffusion_model=dm)), 1.),
                                (SimpleNamespace(model=h3), 0.), (None, 1.)):
            args = (model, object(), "qwen.safetensors", strength, .6)
            with patch.object(compat, "rebase_h3_lora", side_effect=AssertionError("must not adapt")):
                self.assertEqual(compat.HogKitLoraLoader().load_lora(*args), ("native", args))

    def test_loader_cache_is_not_mutated_and_metadata_preserved(self):
        dm, state, grid, *_ = fixture()
        base = H3()
        base.diffusion_model = dm
        model = SimpleNamespace(model=base)
        loader = compat.HogKitLoraLoader()
        metadata = {"ss_network_alpha": "1.5"}
        loader.loaded_lora = ("fixture.safetensors", state, metadata)
        with patch.object(compat, "_dense_grid", return_value=grid):
            loader.load_lora(model, None, "h3.safetensors", .7, 0.)
        args, kwargs = compat.comfy.sd.load_lora_for_models.call_args
        self.assertEqual(args[3:], (.7, 0.))
        self.assertIs(kwargs["lora_metadata"], metadata)
        self.assertEqual(loader.loaded_lora[1][PREFIX + ".lora_A.weight"].shape[1], 5)
        self.assertEqual(args[2][PREFIX + ".lora_A.weight"].shape[1], 2)

    def test_all_four_nodes_use_shared_loader(self):
        source = (ROOT / "lora_nodes.py").read_text(encoding="utf-8")
        self.assertEqual(source.count("loader = HogKitLoraLoader()"), 4)
        self.assertNotIn("loader = LoraLoader()", source)

    def test_basis_cache_reuses_fit_and_tracks_table_updates(self):
        dm, state, grid, *_ = fixture()
        with patch.object(compat, "_dense_grid", return_value=grid), \
                patch.object(compat, "_fit_affine", wraps=compat._fit_affine) as fit:
            compat.rebase_h3_lora(state, KEY_MAP, dm)
            compat.rebase_h3_lora(state, KEY_MAP, dm)
            self.assertEqual(fit.call_count, 1)
            dm.adaln_t_table.add_(1.)
            compat.rebase_h3_lora(state, KEY_MAP, dm)
            self.assertEqual(fit.call_count, 2)

    def test_inference_table_has_no_version_counter(self):
        dm, state, grid, *_ = fixture()
        with torch.inference_mode():
            dm.adaln_t_table = dm.adaln_t_table.clone()
        with patch.object(compat, "_dense_grid", return_value=grid):
            result = compat.rebase_h3_lora(state, KEY_MAP, dm)
        self.assertEqual(result[PREFIX + ".lora_A.weight"].shape, (3, 2))


if __name__ == "__main__":
    unittest.main()
