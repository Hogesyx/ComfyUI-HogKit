import math

import numpy as np
from PIL import Image
import torch
import nodes
from comfy_api.latest import io


RESOLUTION_ASPECT_RATIOS = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


class AutoResolutionSelector(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="HogKitAutoResolutionSelector",
            display_name="HogKit Auto Resolution Selector",
            category="HogKit/Image",
            inputs=[
                io.Image.Input("image", optional=True),
                io.Int.Input(
                    "override_width",
                    display_name="override width",
                    optional=True,
                    default=0,
                    min=0,
                    max=nodes.MAX_RESOLUTION,
                    step=8,
                    advanced=True,
                    tooltip="Replaces the image width for Auto aspect ratio when greater than zero.",
                ),
                io.Int.Input(
                    "override_height",
                    display_name="override height",
                    optional=True,
                    default=0,
                    min=0,
                    max=nodes.MAX_RESOLUTION,
                    step=8,
                    advanced=True,
                    tooltip="Replaces the image height for Auto aspect ratio when greater than zero.",
                ),
                io.Combo.Input(
                    "aspect_ratio",
                    options=["Auto", *RESOLUTION_ASPECT_RATIOS],
                    default="Auto",
                    tooltip="Use the closest stock aspect ratio from the image or override dimensions, or choose a fixed ratio.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=16.0,
                    step=0.1,
                    tooltip="Target total megapixels. 1.0 MP is approximately 1024x1024 for square.",
                ),
                io.Int.Input(
                    id="multiple",
                    default=8,
                    min=8,
                    max=128,
                    step=4,
                    tooltip="Round each output dimension to this multiple.",
                    advanced=True,
                ),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Int.Output("width"),
                io.Int.Output("height"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image=None,
        override_width=0,
        override_height=0,
        aspect_ratio="Auto",
        megapixels=1.0,
        multiple=8,
    ):
        if aspect_ratio == "Auto":
            if image is not None:
                source_width, source_height = image.shape[2], image.shape[1]
                if override_width is not None and override_width > 0:
                    source_width = override_width
                if override_height is not None and override_height > 0:
                    source_height = override_height
            elif override_width is not None and override_height is not None and override_width > 0 and override_height > 0:
                source_width, source_height = override_width, override_height
            else:
                raise ValueError("Auto aspect ratio requires an image or both override dimensions.")
            aspect_ratio = cls._closest_aspect_ratio(source_width, source_height)

        w_ratio, h_ratio = RESOLUTION_ASPECT_RATIOS[aspect_ratio]
        total_pixels = megapixels * 1024 * 1024
        scale = math.sqrt(total_pixels / (w_ratio * h_ratio))
        width = round(w_ratio * scale / multiple) * multiple
        height = round(h_ratio * scale / multiple) * multiple

        return io.NodeOutput(image, width, height)

    @staticmethod
    def _closest_aspect_ratio(width, height):
        image_ratio = width / height
        return min(
            RESOLUTION_ASPECT_RATIOS,
            key=lambda label: abs(RESOLUTION_ASPECT_RATIOS[label][0] / RESOLUTION_ASPECT_RATIOS[label][1] - image_ratio),
        )


QWEN_ASPECT_RATIOS = {
    "auto": (0, 0),
    "1:1": (1328, 1328),
    "16:9": (1664, 928),
    "9:16": (928, 1664),
    "4:3": (1472, 1104),
    "3:4": (1104, 1472),
    "3:2": (1584, 1056),
    "2:3": (1056, 1584),
}

RESAMPLE_METHODS = {
    "lanczos": Image.LANCZOS,
    "bicubic": Image.BICUBIC,
    "bilinear": Image.BILINEAR,
    "nearest": Image.NEAREST,
}


class QwenImageScaler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="HogKitQwenImageScaler",
            display_name="HogKit Qwen Image Scaler",
            category="HogKit/QwenImage",
            inputs=[
                io.Image.Input("image"),
                io.Combo.Input("aspect_ratio", options=list(QWEN_ASPECT_RATIOS.keys()), default="auto"),
                io.Combo.Input("scale_mode", options=["scale_down_only", "scale_up_and_down"], default="scale_up_and_down"),
                io.Combo.Input("method", options=["pad", "crop"], default="pad"),
                io.Combo.Input("horizontal_bias", options=["center", "left", "right"], default="center"),
                io.Combo.Input("vertical_bias", options=["center", "top", "bottom"], default="center"),
                io.String.Input("padding_color", default="#000000"),
                io.Combo.Input("resample", options=list(RESAMPLE_METHODS.keys()), default="lanczos"),
            ],
            outputs=[
                io.Image.Output(display_name="image"),
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
            ],
        )

    @classmethod
    def execute(cls, image, aspect_ratio, scale_mode, method, horizontal_bias, vertical_bias, padding_color, resample):
        output_images = []
        final_w, final_h = None, None
        np_images = image.cpu().numpy()

        for img_np in np_images:
            img_pil = Image.fromarray((img_np * 255).astype(np.uint8))
            img_w, img_h = img_pil.size

            ratio_key = cls._closest_aspect(img_w, img_h) if aspect_ratio == "auto" else aspect_ratio
            target_w, target_h = QWEN_ASPECT_RATIOS[ratio_key]

            if scale_mode == "scale_down_only" and img_w < target_w and img_h < target_h:
                target_w, target_h = img_w, img_h

            if method == "pad":
                img_out = cls._pad(img_pil, target_w, target_h, padding_color, horizontal_bias, vertical_bias, RESAMPLE_METHODS[resample])
            else:
                img_out = cls._crop(img_pil, target_w, target_h, horizontal_bias, vertical_bias, RESAMPLE_METHODS[resample])

            final_w, final_h = img_out.size
            img_np_out = np.array(img_out).astype(np.float32) / 255.0
            output_images.append(img_np_out)

        out_tensor = torch.from_numpy(np.stack(output_images))
        return io.NodeOutput(out_tensor, final_w, final_h)

    @staticmethod
    def _closest_aspect(w, h):
        img_ratio = w / h
        best = None
        best_diff = float("inf")
        for k, (rw, rh) in QWEN_ASPECT_RATIOS.items():
            if k == "auto":
                continue
            r = rw / rh
            diff = abs(r - img_ratio)
            if diff < best_diff:
                best = k
                best_diff = diff
        return best

    @staticmethod
    def _pad(img, target_w, target_h, color, h_bias, v_bias, resample):
        img = img.copy()
        img.thumbnail((target_w, target_h), resample)
        try:
            new_img = Image.new("RGB", (target_w, target_h), color)
        except ValueError:
            new_img = Image.new("RGB", (target_w, target_h), "#000000")

        x = QwenImageScaler._align_offset(target_w, img.width, h_bias)
        y = QwenImageScaler._align_offset(target_h, img.height, v_bias)
        new_img.paste(img, (x, y))
        return new_img

    @staticmethod
    def _crop(img, target_w, target_h, h_bias, v_bias, resample):
        ratio = max(target_w / img.width, target_h / img.height)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img_resized = img.resize(new_size, resample)

        left = QwenImageScaler._align_offset(img_resized.width, target_w, h_bias)
        top = QwenImageScaler._align_offset(img_resized.height, target_h, v_bias)
        right = left + target_w
        bottom = top + target_h

        return img_resized.crop((left, top, right, bottom))

    @staticmethod
    def _align_offset(container, content, bias):
        if bias == "center":
            return (container - content) // 2
        elif bias in ("left", "top"):
            return 0
        elif bias in ("right", "bottom"):
            return container - content
        return 0
