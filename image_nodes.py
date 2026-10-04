import hashlib
import math
import os

import numpy as np
from aiohttp import web
from PIL import Image, ImageColor, ImageOps, ImageSequence
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
                choices[folder_name] = sorted(f"{entry.name}/{image}" for image in image_files)

    choices[root_folder] = sorted(folder_paths.filter_files_content_types(choices[root_folder], ["image"]))
    return {
        root_folder: choices[root_folder],
        **{folder: choices[folder] for folder in sorted(choices) if folder != root_folder},
    }


def _get_input_image_path(image):
    choices = _get_input_image_choices()
    if image not in {image for files in choices.values() for image in files}:
        raise ValueError(f"Invalid image selection: {image}")

    return folder_paths.get_annotated_filepath(image)


class RecursiveLoadImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        image_choices = _get_input_image_choices()
        image_files = [image for files in image_choices.values() for image in files]
        return io.Schema(
            node_id="HogKitLoadImage",
            search_aliases=["load image", "open image", "import image", "recursive image"],
            display_name="HogKit Load Image",
            category="HogKit/Image",
            essentials_category="Basics",
            description="Loads an image from the ComfyUI input directory or one of its immediate subfolders.",
            inputs=[
                io.Combo.Input(
                    "image",
                    options=image_files,
                    upload=io.UploadType.image,
                    tooltip="Select an image from the input directory or one of its immediate subfolders.",
                    extra_dict={"image_choices": image_choices},
                ),
            ],
            outputs=[
                io.Image.Output(),
                io.Mask.Output(),
            ],
        )

    @classmethod
    def execute(cls, image):
        image_path = _get_input_image_path(image)

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
    def fingerprint_inputs(cls, image):
        image_path = _get_input_image_path(image)
        image_hash = hashlib.sha256()
        with open(image_path, "rb") as image_file:
            image_hash.update(image_file.read())
        return image_hash.digest().hex()

    @classmethod
    def validate_inputs(cls, image):
        try:
            image_path = _get_input_image_path(image)
        except ValueError:
            return f"Invalid image file: {image}"
        if not os.path.isfile(image_path):
            return f"Invalid image file: {image}"
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


class ImageScaler(io.ComfyNode):
    RULES = ["Closest", "At least target MP", "At most target MP"]

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="HogKitImageScaler",
            display_name="HogKit Image Scaler",
            category="HogKit/Image",
            description="Crop or pad to a standard ratio at source resolution, then resize once to aligned dimensions. Zero megapixels uses the fitted pixel area.",
            inputs=[
                io.Image.Input("image"),
                io.Combo.Input("aspect_ratio", options=["Auto", *RESOLUTION_ASPECT_RATIOS], default="Auto",
                               tooltip="Auto selects the closest standard ratio to the input image."),
                io.Combo.Input("fit", options=["Pad", "Crop", "Stretch"], default="Pad",
                               tooltip="Fit to the ratio first: Pad adds source-resolution borders, Crop trims the source, Stretch changes proportions. Then apply MP and alignment rules."),
                io.Combo.Input("resolution_rule", options=cls.RULES, default="Closest",
                               tooltip="Choose the nearest aligned size, or constrain output pixel area to at least/at most the target."),
                io.Float.Input("megapixels", default=0.0, min=0.0, max=16.0, step=0.1,
                               tooltip="0 uses pixel area after cropping or padding. Stretch uses input area. Positive values override it. 1 MP = 1024 × 1024 pixels."),
                io.Int.Input("multiple", default=32, min=0, max=128, step=1,
                             tooltip="Both dimensions must be divisible by this value. 0 uses the standard alignment of 8."),
                io.Combo.Input("horizontal_bias", options=["center", "left", "right"], default="center", advanced=True),
                io.Combo.Input("vertical_bias", options=["center", "top", "bottom"], default="center", advanced=True),
                io.String.Input("padding_color", default="#000000", advanced=True,
                                tooltip="Padding color, including optional alpha (for example #00000000)."),
                io.Combo.Input("resample", options=list(RESAMPLE_METHODS), default="lanczos", advanced=True),
            ],
            outputs=[io.Image.Output("image"), io.Int.Output("width"), io.Int.Output("height"),
                     io.Float.Output("actual_megapixels"), io.String.Output("resolution")],
        )

    @staticmethod
    def select_resolution(source_width, source_height, aspect_ratio, megapixels, multiple, resolution_rule):
        if source_width < 1 or source_height < 1:
            raise ValueError("Input image dimensions must be positive.")
        if not math.isfinite(megapixels) or megapixels < 0:
            raise ValueError("Megapixels must be finite and nonnegative.")
        if multiple < 0 or multiple > 128:
            raise ValueError("Multiple must be between 0 and 128.")
        multiple = int(multiple) or 8
        if resolution_rule not in ImageScaler.RULES:
            raise ValueError(f"Unknown resolution rule: {resolution_rule}")
        aspect_ratio = ImageScaler._select_ratio(source_width, source_height, aspect_ratio)
        a, b = RESOLUTION_ASPECT_RATIOS[aspect_ratio]
        target = megapixels * 1024 * 1024 if megapixels else source_width * source_height
        ideal_w = math.sqrt(target * a / b)
        ideal_h = math.sqrt(target * b / a)
        limit = nodes.MAX_RESOLUTION // multiple
        best = None
        # Search the aligned grid. Log-distance balances relative area and ratio
        # errors, rather than gaining a closer MP count through a distorted ratio.
        for wi in range(1, limit + 1):
            width = wi * multiple
            lower, upper = 1, limit
            if resolution_rule == "At least target MP":
                lower = max(lower, math.ceil(target / (width * multiple)))
            elif resolution_rule == "At most target MP":
                upper = min(upper, math.floor(target / (width * multiple)))
            if lower > upper:
                continue
            for hi in {max(lower, min(upper, math.floor(ideal_h / multiple))),
                       max(lower, min(upper, math.ceil(ideal_h / multiple)))}:
                height = hi * multiple
                score = math.log(width / ideal_w) ** 2 + math.log(height / ideal_h) ** 2
                candidate = (score, abs(width * height - target), width, height)
                if best is None or candidate < best:
                    best = candidate
        if best is None:
            raise ValueError("No resolution satisfies the MP rule and alignment within ComfyUI's dimension limit. Adjust megapixels or multiple.")
        return best[2], best[3], aspect_ratio

    @staticmethod
    def _select_ratio(width, height, aspect_ratio):
        if aspect_ratio == "Auto":
            source_ratio = width / height
            return min(RESOLUTION_ASPECT_RATIOS, key=lambda name:
                       abs(math.log((RESOLUTION_ASPECT_RATIOS[name][0] / RESOLUTION_ASPECT_RATIOS[name][1]) / source_ratio)))
        if aspect_ratio not in RESOLUTION_ASPECT_RATIOS:
            raise ValueError(f"Unknown aspect ratio: {aspect_ratio}")
        return aspect_ratio

    @staticmethod
    def _fit_dimensions(width, height, aspect_ratio, fit):
        a, b = RESOLUTION_ASPECT_RATIOS[aspect_ratio]
        if fit == "Stretch":
            return width, height
        if width * b >= height * a:
            if fit == "Pad":
                return width, (width * b + a - 1) // a
            return max(1, height * a // b), height
        if fit == "Pad":
            return (height * a + b - 1) // b, height
        return width, max(1, width * b // a)

    @staticmethod
    def _align_offset(container, content, bias):
        if bias == "center":
            return (container - content) // 2
        return container - content if bias in ("right", "bottom") else 0

    @staticmethod
    def _resize(image, width, height, resample):
        if image.shape[1:3] == (height, width):
            return image.clone()
        # PIL's floating-point channels retain precision, unlike an RGB uint8
        # conversion, and support Lanczos alongside the other existing filters.
        data = image.detach().float().cpu().numpy()
        batches = []
        for frame in data:
            channels = [np.asarray(Image.fromarray(frame[..., c]).resize(
                (width, height), RESAMPLE_METHODS[resample]), dtype=np.float32)
                for c in range(frame.shape[-1])]
            batches.append(np.stack(channels, axis=-1))
        return torch.from_numpy(np.stack(batches)).to(device=image.device, dtype=image.dtype).clamp(0, 1)

    @classmethod
    def execute(cls, image, aspect_ratio="Auto", megapixels=0.0, multiple=32,
                resolution_rule="Closest", fit="Pad", horizontal_bias="center",
                vertical_bias="center", padding_color="#000000", resample="lanczos"):
        if image.ndim != 4 or image.shape[0] < 1 or min(image.shape[1:3]) < 1 or image.shape[-1] not in (1, 3, 4):
            raise ValueError("Expected a nonempty IMAGE batch with 1, 3, or 4 channels.")
        if resample not in RESAMPLE_METHODS or fit not in ("Pad", "Crop", "Stretch"):
            raise ValueError("Unknown fit or resampling method.")
        if horizontal_bias not in ("center", "left", "right") or vertical_bias not in ("center", "top", "bottom"):
            raise ValueError("Unknown image alignment.")
        source_h, source_w = image.shape[1:3]
        ratio = cls._select_ratio(source_w, source_h, aspect_ratio)
        fitted_w, fitted_h = cls._fit_dimensions(source_w, source_h, ratio, fit)
        width, height, _ = cls.select_resolution(fitted_w, fitted_h, ratio,
                                                    megapixels, multiple, resolution_rule)
        # Crop and pad operate on original pixels. Only the final operation
        # interpolates, so fit does not introduce a preliminary resize.
        fitted = image
        if fit == "Crop":
            x = cls._align_offset(source_w, fitted_w, horizontal_bias)
            y = cls._align_offset(source_h, fitted_h, vertical_bias)
            fitted = image[:, y:y + fitted_h, x:x + fitted_w, :]
        elif fit == "Pad":
            mode = {1: "L", 3: "RGB", 4: "RGBA"}[image.shape[-1]]
            try:
                color = ImageColor.getcolor(padding_color, mode)
            except (ValueError, TypeError) as error:
                raise ValueError(f"Invalid padding color: {padding_color}") from error
            if (fitted_w, fitted_h) != (source_w, source_h):
                values = (color,) if isinstance(color, int) else color
                background = image.new_tensor(values).div(255)
                fitted = background.view(1, 1, 1, -1).expand(image.shape[0], fitted_h, fitted_w, -1).clone()
                x = cls._align_offset(fitted_w, source_w, horizontal_bias)
                y = cls._align_offset(fitted_h, source_h, vertical_bias)
                fitted[:, y:y + source_h, x:x + source_w, :] = image
        result = cls._resize(fitted, width, height, resample)
        actual_mp = width * height / (1024 * 1024)
        fit_summary = "Stretch" if fit == "Stretch" else f"{fit} {fitted_w} × {fitted_h}"
        summary = (f"{source_w} × {source_h} → {fit_summary} → {width} × {height}\n"
                   f"{ratio} | actual ratio {width / height:.4f} | {actual_mp:.4f} MP")
        return io.NodeOutput(result, width, height, actual_mp, summary, ui={"text": [summary]})


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
