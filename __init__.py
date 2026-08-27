from .lora_nodes import (
    LoraDualChainLoaderWithMetadata,
    LoraLoaderWithPrompt,
    LoraLoaderWithPromptSingle,
    LoraSingleChainLoaderWithMetadata,
)
from .image_nodes import AutoResolutionSelector, QwenImageScaler, RecursiveLoadImage
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
            LoraSingleChainLoaderWithMetadata,
            LoraDualChainLoaderWithMetadata,
            RecursiveLoadImage,
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
