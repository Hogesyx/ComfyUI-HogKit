import json

from comfy_api.latest import io

MISSING = object()


class NodeStatus(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="HogKitNodeStatus",
            display_name="HogKit Node Status",
            category="HogKit/Utilities",
            description="Reports whether the connected node is working, muted, or bypassed.",
            search_aliases=["node mode", "working", "muted", "bypassed"],
            inputs=[
                io.String.Input(
                    "target_status",
                    default="unknown",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[
                io.Boolean.Output("is_working"),
                io.Boolean.Output("is_bypassed"),
                io.Boolean.Output("is_muted"),
                io.String.Output("status"),
            ],
        )

    @classmethod
    def execute(cls, target_status="unknown"):
        if target_status not in {"working", "bypassed", "muted"}:
            target_status = "unknown"

        return io.NodeOutput(
            target_status == "working",
            target_status == "bypassed",
            target_status == "muted",
            target_status,
        )


class NodeStatusIfElseSwitch(io.ComfyNode):
    _CONDITIONS = {
        "True": True,
        "False": False,
        "Is Working": "working",
        "Is Bypassed": "bypassed",
        "Is Muted": "muted",
    }

    @classmethod
    def define_schema(cls):
        template = io.MatchType.Template("node_status_switch")
        return io.Schema(
            node_id="HogKitNodeStatusIfElseSwitch",
            display_name="HogKit Node Status If/Else Switch",
            category="HogKit/Utilities",
            description="Selects on_true or on_false from the connected node's status.",
            search_aliases=["node status switch", "status if", "status branch"],
            inputs=[
                io.Combo.Input(
                    "switch",
                    options=list(cls._CONDITIONS),
                    default="True",
                ),
                io.MatchType.Input("on_true", template=template, optional=True, lazy=True),
                io.MatchType.Input("on_false", template=template, optional=True, lazy=True),
                io.String.Input(
                    "target_status",
                    default="unknown",
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[io.MatchType.Output(template=template, display_name="output")],
        )

    @classmethod
    def _is_true(cls, target_status, switch):
        condition = cls._CONDITIONS.get(switch, True)
        return condition if isinstance(condition, bool) else target_status == condition

    @classmethod
    def check_lazy_status(
        cls,
        switch,
        target_status="unknown",
        on_true=MISSING,
        on_false=MISSING,
    ):
        if cls._is_true(target_status, switch):
            if on_true is None:
                return ["on_true"]
        elif on_false is None:
            return ["on_false"]

    @classmethod
    def execute(
        cls,
        switch="True",
        target_status="unknown",
        on_true=MISSING,
        on_false=MISSING,
    ):
        if on_true is MISSING:
            on_true = None
        if on_false is MISSING:
            on_false = None
        return io.NodeOutput(on_true if cls._is_true(target_status, switch) else on_false)


class _ValueFallback(io.ComfyNode):
    _TYPE = io.String
    _NODE_ID = "HogKitValueFallback"
    _DISPLAY_NAME = "HogKit Value Fallback"
    _DEFAULT = ""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=cls._NODE_ID,
            display_name=cls._DISPLAY_NAME,
            category="HogKit/Utilities",
            description="Uses the fallback when the connected value is null or missing.",
            search_aliases=["null fallback", "none fallback", "default value"],
            inputs=[
                cls._TYPE.Input("value", optional=True, force_input=True),
                cls._TYPE.Input("fallback", default=cls._DEFAULT),
            ],
            outputs=[cls._TYPE.Output("value")],
        )

    @classmethod
    def execute(cls, value=None, fallback=None):
        return io.NodeOutput(fallback if value is None else value)


class StringFallback(_ValueFallback):
    _TYPE = io.String
    _NODE_ID = "HogKitStringFallback"
    _DISPLAY_NAME = "HogKit String Fallback"
    _DEFAULT = ""


class IntegerFallback(_ValueFallback):
    _TYPE = io.Int
    _NODE_ID = "HogKitIntegerFallback"
    _DISPLAY_NAME = "HogKit Integer Fallback"
    _DEFAULT = 0


class FloatFallback(_ValueFallback):
    _TYPE = io.Float
    _NODE_ID = "HogKitFloatFallback"
    _DISPLAY_NAME = "HogKit Float Fallback"
    _DEFAULT = 0.0


class BooleanFallback(_ValueFallback):
    _TYPE = io.Boolean
    _NODE_ID = "HogKitBooleanFallback"
    _DISPLAY_NAME = "HogKit Boolean Fallback"
    _DEFAULT = False


class ShowConvertAnything(io.ComfyNode):
    _MAX_ROWS = 100
    _OUTPUT_TYPES = {"Auto", "String", "Integer", "Float", "Boolean"}

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="HogKitShowConvertAnything",
            display_name="HogKit Show Convert Anything",
            category="HogKit/Utilities",
            description="Displays and passes through multiple values, with optional per-value conversion.",
            search_aliases=["show any", "display any", "pass through", "value inspector"],
            outputs=[
                io.AnyType.Output(f"output{index}", display_name=f"output{index}")
                for index in range(cls._MAX_ROWS)
            ],
            is_output_node=True,
            accept_all_inputs=True,
        )

    @staticmethod
    def _format_value(value):
        if isinstance(value, (str, int, float, bool)) or value is None:
            return str(value)
        try:
            return json.dumps(value, indent=2, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return str(value)

    @classmethod
    def _convert_value(cls, value, output_type, index):
        if output_type == "Auto":
            return value
        try:
            if output_type == "String":
                return str(value)
            if output_type == "Integer":
                return int(value)
            if output_type == "Float":
                return float(value)
            if output_type == "Boolean":
                if isinstance(value, str):
                    normalized = value.strip().lower()
                    if normalized in {"true", "1", "yes", "on"}:
                        return True
                    if normalized in {"false", "0", "no", "off", ""}:
                        return False
                return bool(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError(f"Could not convert value{index} to {output_type}: {error}") from error
        raise ValueError(f"Unknown output type for value{index}: {output_type}")

    @classmethod
    def execute(cls, **kwargs):
        value_inputs = {
            int(name[5:]): value
            for name, value in kwargs.items()
            if name.startswith("value") and name[5:].isdigit()
        }
        if not value_inputs:
            return io.NodeOutput(ui={"text": []})

        last_index = max(value_inputs)
        if last_index >= cls._MAX_ROWS:
            raise ValueError(f"Show Convert Anything supports up to {cls._MAX_ROWS} values.")
        outputs = [None] * (last_index + 1)
        display = [""] * (last_index + 1)
        for index, value in value_inputs.items():
            output_type = kwargs.get(f"output_type{index}", "Auto")
            if output_type not in cls._OUTPUT_TYPES:
                output_type = "Auto"
            output = cls._convert_value(value, output_type, index)
            outputs[index] = output
            display[index] = cls._format_value(output)

        return io.NodeOutput(*outputs, ui={"text": display})
