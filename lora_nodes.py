import json
import os
import random

import folder_paths
from aiohttp import web
from comfy_api.latest import io
from server import PromptServer
from nodes import LoraLoader


class LoraLoaderWithPrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        loras = ["None"] + folder_paths.get_filename_list("loras")
        return io.Schema(
            node_id="HogKitLoraLoaderWithPrompt",
            display_name="HogKit LoRA Dual Loader with Prompt",
            category="HogKit",
            inputs=[
                io.String.Input("prompt_input", force_input=True),
                io.Model.Input("model"),
                io.Boolean.Input("enable", default=True),
                io.Clip.Input("clip", optional=True),
                io.Model.Input("model_2", optional=True),
                io.Clip.Input("clip_2", optional=True),
                io.Combo.Input("lora", options=loras, optional=True, default="None"),
                io.Combo.Input("lora_2", options=loras, optional=True, default="None"),
                io.Float.Input("strength", optional=True, default=1.0, min=0.0, max=2.0, step=0.01),
                io.Float.Input("strength_2", optional=True, default=1.0, min=0.0, max=2.0, step=0.01),
                io.String.Input("lora_prompt", optional=True, default="", multiline=True),
            ],
            outputs=[
                io.String.Output(display_name="prompt_output"),
                io.Model.Output(display_name="MODEL"),
                io.Clip.Output(display_name="CLIP"),
                io.Model.Output(display_name="MODEL_2"),
                io.Clip.Output(display_name="CLIP_2"),
            ],
        )

    @classmethod
    def execute(cls, prompt_input="", model=None, enable=True, clip=None, model_2=None, clip_2=None, lora="None", lora_2="None", strength=1.0, strength_2=1.0, lora_prompt=""):
        if not enable or (lora == "None" and lora_2 == "None") or (strength == 0.0 and strength_2 == 0.0):
            return io.NodeOutput(prompt_input, model, clip, model_2, clip_2)

        loader = LoraLoader()
        model_out = model
        clip_out = clip
        if lora != "None" and strength != 0.0:
            model_out, clip_out = loader.load_lora(model, clip, lora, strength, strength)

        model_2_out = model_2
        clip_2_out = clip_2
        if model_2 is not None and lora_2 != "None" and strength_2 != 0.0:
            model_2_out, clip_2_out = loader.load_lora(model_2, clip_2, lora_2, strength_2, strength_2)

        # Prompt logic
        if lora_prompt.strip() and (lora != "None" or lora_2 != "None"):
            if prompt_input.strip():
                final_prompt = prompt_input + " " + lora_prompt
            else:
                final_prompt = lora_prompt
        else:
            final_prompt = prompt_input

        return io.NodeOutput(final_prompt, model_out, clip_out, model_2_out, clip_2_out)

class LoraLoaderWithPromptSingle(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        loras = ["None"] + folder_paths.get_filename_list("loras")
        return io.Schema(
            node_id="HogKitLoraLoaderWithPromptSingle",
            display_name="HogKit LoRA Single Loader with Prompt",
            category="HogKit",
            inputs=[
                io.String.Input("prompt_input", force_input=True),
                io.Model.Input("model"),
                io.Boolean.Input("enable", default=True),
                io.Clip.Input("clip", optional=True),
                io.Combo.Input("lora", options=loras, optional=True, default="None"),
                io.Float.Input("strength", optional=True, default=1.0, min=0.0, max=2.0, step=0.01),
                io.String.Input("lora_prompt", optional=True, default="", multiline=True),
            ],
            outputs=[
                io.String.Output(display_name="prompt_output"),
                io.Model.Output(display_name="MODEL"),
                io.Clip.Output(display_name="CLIP"),
            ],
        )

    @classmethod
    def execute(cls, prompt_input="", model=None, enable=True, clip=None, lora="None", strength=1.0, lora_prompt=""):
        if not enable or lora == "None" or strength == 0.0:
            return io.NodeOutput(prompt_input, model, clip)

        loader = LoraLoader()
        model_out, clip_out = loader.load_lora(model, clip, lora, strength, strength)

        if lora_prompt.strip() and lora != "None":
            final_prompt = f"{prompt_input} {lora_prompt}".strip() if prompt_input.strip() else lora_prompt
        else:
            final_prompt = prompt_input

        return io.NodeOutput(final_prompt, model_out, clip_out)


def _default_metadata():
    return {
        "schema_version": 1,
        "name": "",
        "positive_prompt": "",
        "negative_prompt": "",
        "strength": 1.0,
        "recommended": {
            "positive_prompt": "",
            "negative_prompt": "",
            "strength": 1.0,
            "min_strength": 0.0,
            "max_strength": 2.0,
        },
        "notes": "",
    }


def metadata_path_for_lora_name(lora_name):
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path:
        return None

    base_path, _ = os.path.splitext(lora_path)
    return f"{base_path}.metadata.json"


def load_or_create_lora_metadata(lora_name):
    metadata = _default_metadata()
    metadata_path = metadata_path_for_lora_name(lora_name)
    if not metadata_path:
        metadata["notes"] = "LoRA file was not found when metadata was requested."
        return metadata, None

    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as metadata_file:
                loaded = json.load(metadata_file)
            if isinstance(loaded, dict):
                metadata = merge_lora_metadata(metadata, loaded)
        except (OSError, ValueError) as exc:
            print(f"[LoraChainLoaderWithMetadata] Error reading metadata '{metadata_path}': {exc}")
    else:
        write_lora_metadata(metadata_path, metadata)

    return metadata, metadata_path


def merge_lora_metadata(default_metadata, loaded_metadata):
    merged = default_metadata.copy()
    recommended = merged["recommended"].copy()

    loaded_recommended = loaded_metadata.get("recommended")
    if isinstance(loaded_recommended, dict):
        recommended.update(loaded_recommended)

    merged.update({k: v for k, v in loaded_metadata.items() if k != "recommended"})
    merged["recommended"] = recommended
    return merged


def write_lora_metadata(metadata_path, metadata):
    with open(metadata_path, "w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2, ensure_ascii=False)
        metadata_file.write("\n")


class LoraChainLoaderWithMetadata(io.ComfyNode):
    """
    Applies multiple LoRAs in order and keeps a sidecar metadata JSON next to each LoRA.

    Sidecar naming:
        lora.safetensors -> lora.metadata.json
    """
    @classmethod
    def define_schema(cls):
        loras = ["None"] + folder_paths.get_filename_list("loras")
        return io.Schema(
            node_id="HogKitLoraChainLoaderWithMetadata",
            display_name="HogKit LoRA Chain Loader with Metadata",
            category="HogKit",
            inputs=[
                io.Model.Input("model_1"),
                io.Clip.Input("clip_1", optional=True),
                io.String.Input("positive_input_1", optional=True, force_input=True, default=""),
                io.String.Input("negative_input_1", optional=True, force_input=True, default=""),
                io.Model.Input("model_2", optional=True),
                io.Clip.Input("clip_2", optional=True),
                io.String.Input("positive_input_2", optional=True, force_input=True, default=""),
                io.String.Input("negative_input_2", optional=True, force_input=True, default=""),
                io.Int.Input("select_row", optional=True, default=0, min=-1),
                io.String.Input(
                    "lora_stack",
                    optional=True,
                    default='{"rows":[],"delimiter":", ","exclusive":false}',
                    extra_dict={"lora_choices": loras},
                ),
            ],
            outputs=[
                io.Model.Output(display_name="MODEL_1"),
                io.Clip.Output(display_name="CLIP_1"),
                io.String.Output(display_name="positive_1"),
                io.String.Output(display_name="negative_1"),
                io.Model.Output(display_name="MODEL_2"),
                io.Clip.Output(display_name="CLIP_2"),
                io.String.Output(display_name="positive_2"),
                io.String.Output(display_name="negative_2"),
            ],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        model_1,
        clip_1=None,
        positive_input_1="",
        negative_input_1="",
        model_2=None,
        clip_2=None,
        positive_input_2="",
        negative_input_2="",
        select_row=0,
        lora_stack='{"rows":[],"delimiter":", ","exclusive":false}',
        **kwargs,
    ):
        stack_config = cls._parse_lora_stack_config(lora_stack)
        rows = stack_config["rows"]
        metadata_state = {
            "lora_stack": lora_stack,
            "positive_input_1": positive_input_1,
            "negative_input_1": negative_input_1,
            "positive_input_2": positive_input_2,
            "negative_input_2": negative_input_2,
            "select_row": select_row,
            "metadata_files": [],
        }
        found_enabled = False
        for row in rows:
            if not row.get("enabled", True):
                continue
            if stack_config["exclusive"] and found_enabled:
                continue
            lora_names = list(cls._iter_enabled_lora_names(row))
            if not lora_names:
                continue
            found_enabled = True
            for role, lora_name in lora_names:
                metadata_path = metadata_path_for_lora_name(lora_name)
                if metadata_path and os.path.exists(metadata_path):
                    stat = os.stat(metadata_path)
                    metadata_state["metadata_files"].append((role, lora_name, stat.st_mtime_ns, stat.st_size))
                else:
                    metadata_state["metadata_files"].append((role, lora_name, None, None))
        return json.dumps(metadata_state, ensure_ascii=False)

    @classmethod
    def execute(
        cls,
        model_1,
        clip_1=None,
        positive_input_1="",
        negative_input_1="",
        model_2=None,
        clip_2=None,
        positive_input_2="",
        negative_input_2="",
        select_row=0,
        lora_stack='{"rows":[],"delimiter":", ","exclusive":false}',
        **kwargs,
    ):
        stack_config = cls._parse_lora_stack_config(lora_stack)
        select_row_applied = cls._apply_select_row(stack_config, select_row)
        delimiter = stack_config["delimiter"]
        positive_parts_1 = [positive_input_1.strip()] if positive_input_1 and positive_input_1.strip() else []
        negative_parts_1 = [negative_input_1.strip()] if negative_input_1 and negative_input_1.strip() else []
        positive_parts_2 = [positive_input_2.strip()] if positive_input_2 and positive_input_2.strip() else []
        negative_parts_2 = [negative_input_2.strip()] if negative_input_2 and negative_input_2.strip() else []
        loader = LoraLoader()
        found_enabled = False

        for lora_row in stack_config["rows"]:
            enabled = lora_row.get("enabled", True)
            lora_name = lora_row.get("lora_1", "None")

            if not enabled:
                continue
            if stack_config["exclusive"] and found_enabled:
                continue
            if not any(True for _ in cls._iter_enabled_lora_names(lora_row)):
                continue
            found_enabled = True

            if lora_row.get("lora_1_enabled", True) and lora_name != "None":
                model_1, clip_1 = cls._apply_lora_side(
                    loader,
                    model_1,
                    clip_1,
                    lora_name,
                    positive_parts_1,
                    negative_parts_1,
                )

            lora_2_name = lora_row.get("lora_2", "None")
            if lora_row.get("lora_2_enabled", False) and lora_2_name != "None" and model_2 is not None:
                model_2, clip_2 = cls._apply_lora_side(
                    loader,
                    model_2,
                    clip_2,
                    lora_2_name,
                    positive_parts_2,
                    negative_parts_2,
                )

        result = (
            model_1,
            clip_1,
            delimiter.join(positive_parts_1),
            delimiter.join(negative_parts_1),
            model_2,
            clip_2,
            delimiter.join(positive_parts_2),
            delimiter.join(negative_parts_2),
        )
        if select_row_applied:
            return io.NodeOutput(*result, ui={"lora_stack_sync": [cls._serialize_stack_config(stack_config)]})
        return io.NodeOutput(*result)

    @staticmethod
    def _apply_lora_side(
        loader,
        model,
        clip,
        lora_name,
        positive_parts,
        negative_parts,
    ):
        metadata, _ = load_or_create_lora_metadata(lora_name)
        strength = LoraChainLoaderWithMetadata._coerce_float(metadata.get("strength"), 1.0)

        if strength != 0.0:
            clip_strength = strength if clip is not None else 0.0
            model, clip = loader.load_lora(model, clip, lora_name, strength, clip_strength)

        LoraChainLoaderWithMetadata._append_prompt_part(positive_parts, metadata.get("positive_prompt"))
        LoraChainLoaderWithMetadata._append_prompt_part(negative_parts, metadata.get("negative_prompt"))
        return model, clip

    @staticmethod
    def _parse_lora_stack_config(lora_stack):
        default_config = {
            "rows": [],
            "delimiter": ", ",
            "exclusive": False,
        }

        if not isinstance(lora_stack, str) or not lora_stack.strip():
            return default_config

        try:
            parsed = json.loads(lora_stack)
        except json.JSONDecodeError as exc:
            print(f"[LoraChainLoaderWithMetadata] Invalid lora_stack JSON: {exc}")
            return default_config

        if not isinstance(parsed, dict):
            return default_config

        rows = parsed.get("rows", [])
        delimiter = parsed.get("delimiter", ", ")
        default_config["rows"] = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
        default_config["delimiter"] = delimiter if isinstance(delimiter, str) else ", "
        default_config["exclusive"] = bool(parsed.get("exclusive", False))
        return default_config

    @staticmethod
    def _iter_enabled_lora_names(row):
        lora_name = row.get("lora_1", "None")
        if row.get("lora_1_enabled", True) and lora_name != "None":
            yield "1", lora_name

        lora_2_name = row.get("lora_2", "None")
        if row.get("lora_2_enabled", False) and lora_2_name != "None":
            yield "2", lora_2_name

    @staticmethod
    def _append_prompt_part(parts, value):
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())

    @staticmethod
    def _coerce_float(value, fallback):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _apply_select_row(stack_config, select_row):
        rows = stack_config.get("rows", [])
        if not rows:
            return False
        try:
            select_value = int(select_row)
        except (TypeError, ValueError):
            return False

        # 0 disables external row selection override for this run.
        if select_value == 0:
            return False
        # -1 picks a random row from the current list.
        if select_value == -1:
            row_index = random.randint(0, len(rows) - 1)
        else:
            row_index = select_value - 1

        if row_index < 0 or row_index >= len(rows):
            return False

        rows[row_index]["enabled"] = True
        if stack_config.get("exclusive", False):
            for index, row in enumerate(rows):
                if index != row_index:
                    row["enabled"] = False
        return True

    @staticmethod
    def _serialize_stack_config(stack_config):
        return json.dumps({
            "rows": stack_config.get("rows", []),
            "delimiter": stack_config.get("delimiter", ", "),
            "exclusive": bool(stack_config.get("exclusive", False)),
        }, ensure_ascii=False)


@PromptServer.instance.routes.get("/lora/metadata")
async def get_lora_metadata(request):
    lora_name = request.query.get("lora", "")
    if not lora_name or lora_name == "None":
        return web.json_response({"error": "Missing LoRA name."}, status=400)

    metadata, metadata_path = load_or_create_lora_metadata(lora_name)
    return web.json_response({
        "lora": lora_name,
        "metadata_path": metadata_path,
        "metadata": metadata,
    })

@PromptServer.instance.routes.post("/lora/metadata")
async def save_lora_metadata(request):
    payload = await request.json()
    lora_name = payload.get("lora", "")
    metadata = payload.get("metadata")

    if not lora_name or lora_name == "None":
        return web.json_response({"error": "Missing LoRA name."}, status=400)
    if not isinstance(metadata, dict):
        return web.json_response({"error": "Metadata must be a JSON object."}, status=400)

    metadata_path = metadata_path_for_lora_name(lora_name)
    if not metadata_path:
        return web.json_response({"error": "LoRA file was not found."}, status=404)

    metadata = merge_lora_metadata(_default_metadata(), metadata)
    write_lora_metadata(metadata_path, metadata)
    return web.json_response({
        "lora": lora_name,
        "metadata_path": metadata_path,
        "metadata": metadata,
    })
