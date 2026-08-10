import hashlib
import math
import os

import numpy as np
from aiohttp import web
from PIL import Image, ImageOps, ImageSequence
import torch
import comfy.model_management
import folder_paths
import node_helpers
import nodes
from comfy_api.latest import InputImpl, io
from server import PromptServer


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

def _get_input_root_name():
    input_dir = os.path.normpath(folder_paths.get_input_directory())
    return os.path.basename(input_dir) or "input"


def _get_input_image_choices():
    input_dir = folder_paths.get_input_directory()
    input_dir_real = os.path.realpath(input_dir)
    root_folder = _get_input_root_name()
    choices = {root_folder: []}

    with os.scandir(input_dir) as entries:
        for entry in entries:
            if entry.is_file() and folder_paths.is_within_directory(input_dir_real, entry.path):
                choices[root_folder].append(entry.name)
                continue

            if not entry.is_dir(follow_symlinks=False) or not folder_paths.is_within_directory(input_dir_real, entry.path):
                continue

            files = []
            with os.scandir(entry.path) as subfolder_entries:
                for subfolder_entry in subfolder_entries:
                    if subfolder_entry.is_file() and folder_paths.is_within_directory(input_dir_real, subfolder_entry.path):
                        files.append(subfolder_entry.name)

            image_files = folder_paths.filter_files_content_types(files, ["image"])
            if image_files:
                folder_name = f"{entry.name}/" if entry.name == root_folder else entry.name
                choices[folder_name] = sorted(image_files)

    choices[root_folder] = sorted(folder_paths.filter_files_content_types(choices[root_folder], ["image"]))
    return {
        root_folder: choices[root_folder],
        **{folder: choices[folder] for folder in sorted(choices) if folder != root_folder},
    }


def _get_input_image_path(folder, image):
    choices = _get_input_image_choices()
    if folder not in choices or image not in choices[folder]:
        raise ValueError(f"Invalid image selection: {folder}/{image}")

    root_folder = next(iter(choices))
    folder_path = folder.rstrip("/")
    relative_path = image if folder == root_folder else os.path.join(folder_path, image)
    return folder_paths.get_annotated_filepath(relative_path)


class RecursiveLoadImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        image_choices = _get_input_image_choices()
        root_folder = next(iter(image_choices))
        return io.Schema(
            node_id="HogKitLoadImage",
            search_aliases=["load image", "open image", "import image", "recursive image"],
            display_name="HogKit Load Image",
            category="HogKit/Image",
            essentials_category="Basics",
            description="Loads an image from the ComfyUI input directory or one of its immediate subfolders.",
            inputs=[
                io.Combo.Input(
                    "folder",
                    options=list(image_choices),
                    default=root_folder,
                    tooltip="Select the input subfolder. Only one level of subfolders is shown.",
                    extra_dict={"image_choices": image_choices},
                ),
                io.Combo.Input(
                    "image",
                    options=image_choices[root_folder],
                    upload=io.UploadType.image,
                ),
            ],
            outputs=[
                io.Image.Output(),
                io.Mask.Output(),
            ],
        )

    @classmethod
    def execute(cls, folder, image):
        image_path = _get_input_image_path(folder, image)

        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        components = InputImpl.VideoFromFile(image_path).get_components()
        if components.images.shape[0] > 0:
            mask = (
                (1.0 - components.alpha[..., -1]).to(device=device, dtype=dtype)
                if components.alpha is not None
                else torch.zeros((components.images.shape[0], 64, 64), dtype=dtype, device=device)
            )
            return io.NodeOutput(components.images.to(device=device, dtype=dtype), mask)

        image_file = node_helpers.pillow(Image.open, image_path)
        output_images = []
        output_masks = []
        width, height = None, None

        for frame in ImageSequence.Iterator(image_file):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            has_alpha = "A" in frame.getbands()
            frame = frame.convert("RGB")

            if not output_images:
                width, height = frame.size

            if frame.size != (width, height):
                continue

            image_array = np.array(frame).astype(np.float32) / 255.0
            output_images.append(torch.from_numpy(image_array)[None,].to(dtype=dtype))

            if has_alpha:
                mask_array = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask_array)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
            output_masks.append(mask.unsqueeze(0).to(dtype=dtype))

        output_image = torch.cat(output_images, dim=0)
        output_mask = torch.cat(output_masks, dim=0)
        return io.NodeOutput(output_image.to(device=device, dtype=dtype), output_mask.to(device=device, dtype=dtype))

    @classmethod
    def fingerprint_inputs(cls, folder, image):
        image_path = _get_input_image_path(folder, image)
        image_hash = hashlib.sha256()
        with open(image_path, "rb") as image_file:
            image_hash.update(image_file.read())
        return image_hash.digest().hex()

    @classmethod
    def validate_inputs(cls, folder, image):
        try:
            image_path = _get_input_image_path(folder, image)
        except ValueError:
            return f"Invalid image file: {folder}/{image}"
        if not os.path.isfile(image_path):
            return f"Invalid image file: {folder}/{image}"
        return True


@PromptServer.instance.routes.get("/hogkit/load-image/files")
async def get_load_image_files(request):
    return web.json_response(_get_input_image_choices())

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
