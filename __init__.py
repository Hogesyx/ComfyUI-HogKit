from .lora_nodes import (
    LoraChainLoaderWithMetadata,
    LoraLoaderWithPrompt,
    LoraLoaderWithPromptSingle,
)
from .image_nodes import AutoResolutionSelector, QwenImageScaler
from .utility_nodes import (
    BooleanFallback,
    FloatFallback,
    IntegerFallback,
    NodeStatus,
    NodeStatusIfElseSwitch,
    ShowConvertAnything,
    StringFallback,
)
from comfy_api.latest import ComfyExtension, io

WEB_DIRECTORY = "./web"

class PluginExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            LoraLoaderWithPrompt,
            LoraLoaderWithPromptSingle,
            LoraChainLoaderWithMetadata,
            AutoResolutionSelector,
            QwenImageScaler,
            NodeStatus,
            NodeStatusIfElseSwitch,
            StringFallback,
            IntegerFallback,
            FloatFallback,
            BooleanFallback,
            ShowConvertAnything,
        ]


async def comfy_entrypoint() -> PluginExtension:
    return PluginExtension()

__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
