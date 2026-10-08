"""Optional CPU integration check against an installed ComfyUI backend."""
import os
import unittest


@unittest.skipUnless(os.environ.get('COMFYUI_PATH'), 'Set COMFYUI_PATH to run native integration checks')
class NativeIntegrationTests(unittest.TestCase):
    def test_native_h3_stacking_and_qwen_parity(self):
        import importlib.util
        from pathlib import Path
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch

        ROOT = Path(__file__).resolve().parents[1]
        self.addCleanup(setattr, sys, 'path', list(sys.path))
        self.addCleanup(setattr, sys, 'argv', sys.argv)
        sys.path.insert(0, os.environ['COMFYUI_PATH'])
        sys.argv = [sys.argv[0], '--cpu']
        import torch
        import comfy.model_base
        import comfy.model_patcher
        import comfy.lora
        from nodes import LoraLoader

        spec = importlib.util.spec_from_file_location('hogkit_lora_compat_smoke', ROOT / 'lora_compat.py')
        compat = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compat)
        torch.set_num_threads(8)

        def model_fixture(cls, width):
            model = cls.__new__(cls)
            torch.nn.Module.__init__(model)
            model.model_config = SimpleNamespace(unet_config={})
            model.diffusion_model = torch.nn.Module()
            dm = model.diffusion_model
            dm.blocks = torch.nn.ModuleList([torch.nn.Module()])
            dm.blocks[0].adaln_proj = torch.nn.Module()
            dm.blocks[0].adaln_proj.linear = torch.nn.Linear(width, 7)
            return comfy.model_patcher.ModelPatcher(model, torch.device('cpu'), torch.device('cpu'))

        prefix = 'blocks.0.adaln_proj.linear'
        wk = 'diffusion_model.' + prefix + '.weight'
        bk = wk.removesuffix('.weight') + '.bias'
        table = torch.randn(30, 2)
        v, c = torch.randn(5, 2), torch.randn(5)
        grid = table @ v.T + c
        state = {prefix + '.lora_A.weight': torch.randn(3, 5),
                 prefix + '.lora_B.weight': torch.randn(7, 3), prefix + '.alpha': torch.tensor(1.5)}
        model = model_fixture(comfy.model_base.MiniMaxH3, 2)
        model.model.diffusion_model.register_buffer('adaln_t_table', table)
        loader = compat.HogKitLoraLoader()
        with patch.object(compat.folder_paths, 'get_full_path_or_raise', return_value='fixture'), \
             patch.object(compat.comfy.utils, 'load_torch_file', return_value=(state, {})), \
             patch.object(compat, '_dense_grid', return_value=grid):
            first, _ = loader.load_lora(model, None, 'fixture', .8, 0)
            stacked, _ = loader.load_lora(first, None, 'fixture', -.3, 0)
        weight = model.model.state_dict()[wk].detach().clone()
        bias = model.model.state_dict()[bk].detach().clone()
        patched_weight = comfy.lora.calculate_weight(stacked.patches[wk], weight.clone(), wk)
        patched_bias = comfy.lora.calculate_weight(stacked.patches[bk], bias.clone(), bk)
        actual = table @ (patched_weight-weight).T + patched_bias-bias
        expected = .5 * .5 * grid @ state[prefix + '.lora_A.weight'].T @ state[prefix + '.lora_B.weight'].T
        torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)
        assert not model.patches and len(stacked.patches[wk]) == 2
        print('PASS: actual ComfyUI H3 key mapping, native adapter, bias patch and chained strengths')

        for cls in (comfy.model_base.QwenImage, comfy.model_base.QwenImage21):
            qwen = model_fixture(cls, 5)
            # A misleading curve-like attribute must not trigger H3 adaptation.
            qwen.model.diffusion_model.register_buffer('adaln_t_table', table)
            with patch.object(compat.folder_paths, 'get_full_path_or_raise', return_value='fixture'), \
                 patch.object(compat.comfy.utils, 'load_torch_file', return_value=(state, {})), \
                 patch.object(compat, 'rebase_h3_lora', side_effect=AssertionError('Qwen must stay native')):
                native, _ = LoraLoader().load_lora(qwen, None, 'fixture', .7, 0)
                hogkit, _ = compat.HogKitLoraLoader().load_lora(qwen, None, 'fixture', .7, 0)
                # A dual loader can reuse the H3 file cache on its Qwen side.
                mixed, _ = loader.load_lora(qwen, None, 'fixture', .7, 0)
            qw = qwen.model.state_dict()[wk].detach().clone()
            native_w = comfy.lora.calculate_weight(native.patches[wk], qw.clone(), wk)
            hogkit_w = comfy.lora.calculate_weight(hogkit.patches[wk], qw.clone(), wk)
            torch.testing.assert_close(hogkit_w, native_w, atol=0, rtol=0)
            mixed_w = comfy.lora.calculate_weight(mixed.patches[wk], qw.clone(), wk)
            torch.testing.assert_close(mixed_w, native_w, atol=0, rtol=0)
            assert bk not in hogkit.patches
            print('PASS:', cls.__name__, 'matches native loader exactly')
