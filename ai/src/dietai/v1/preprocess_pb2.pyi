from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ImageInput(_message.Message):
    __slots__ = ("encoded", "image_id")
    ENCODED_FIELD_NUMBER: _ClassVar[int]
    IMAGE_ID_FIELD_NUMBER: _ClassVar[int]
    encoded: bytes
    image_id: str
    def __init__(self, encoded: _Optional[bytes] = ..., image_id: _Optional[str] = ...) -> None: ...

class ConfigOverride(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class Step(_message.Message):
    __slots__ = ("name", "elapsed_ms", "params_json")
    NAME_FIELD_NUMBER: _ClassVar[int]
    ELAPSED_MS_FIELD_NUMBER: _ClassVar[int]
    PARAMS_JSON_FIELD_NUMBER: _ClassVar[int]
    name: str
    elapsed_ms: float
    params_json: str
    def __init__(self, name: _Optional[str] = ..., elapsed_ms: _Optional[float] = ..., params_json: _Optional[str] = ...) -> None: ...

class Point(_message.Message):
    __slots__ = ("x", "y")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ...) -> None: ...

class Box(_message.Message):
    __slots__ = ("x", "y", "w", "h")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    W_FIELD_NUMBER: _ClassVar[int]
    H_FIELD_NUMBER: _ClassVar[int]
    x: int
    y: int
    w: int
    h: int
    def __init__(self, x: _Optional[int] = ..., y: _Optional[int] = ..., w: _Optional[int] = ..., h: _Optional[int] = ...) -> None: ...

class Ellipse(_message.Message):
    __slots__ = ("cx", "cy", "major", "minor", "angle")
    CX_FIELD_NUMBER: _ClassVar[int]
    CY_FIELD_NUMBER: _ClassVar[int]
    MAJOR_FIELD_NUMBER: _ClassVar[int]
    MINOR_FIELD_NUMBER: _ClassVar[int]
    ANGLE_FIELD_NUMBER: _ClassVar[int]
    cx: float
    cy: float
    major: float
    minor: float
    angle: float
    def __init__(self, cx: _Optional[float] = ..., cy: _Optional[float] = ..., major: _Optional[float] = ..., minor: _Optional[float] = ..., angle: _Optional[float] = ...) -> None: ...

class ImageOutput(_message.Message):
    __slots__ = ("encoded", "artifact_id", "width", "height")
    ENCODED_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    encoded: bytes
    artifact_id: str
    width: int
    height: int
    def __init__(self, encoded: _Optional[bytes] = ..., artifact_id: _Optional[str] = ..., width: _Optional[int] = ..., height: _Optional[int] = ...) -> None: ...

class CheckQualityRequest(_message.Message):
    __slots__ = ("image", "config")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    image: ImageInput
    config: ConfigOverride
    def __init__(self, image: _Optional[_Union[ImageInput, _Mapping]] = ..., config: _Optional[_Union[ConfigOverride, _Mapping]] = ...) -> None: ...

class CheckQualityResponse(_message.Message):
    __slots__ = ("passed", "blur_score", "mean_brightness", "dark_ratio", "bright_ratio", "resolution_ok", "warnings", "steps")
    PASSED_FIELD_NUMBER: _ClassVar[int]
    BLUR_SCORE_FIELD_NUMBER: _ClassVar[int]
    MEAN_BRIGHTNESS_FIELD_NUMBER: _ClassVar[int]
    DARK_RATIO_FIELD_NUMBER: _ClassVar[int]
    BRIGHT_RATIO_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_OK_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    passed: bool
    blur_score: float
    mean_brightness: float
    dark_ratio: float
    bright_ratio: float
    resolution_ok: bool
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[Step]
    def __init__(self, passed: _Optional[bool] = ..., blur_score: _Optional[float] = ..., mean_brightness: _Optional[float] = ..., dark_ratio: _Optional[float] = ..., bright_ratio: _Optional[float] = ..., resolution_ok: _Optional[bool] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[Step, _Mapping]]] = ...) -> None: ...

class DecodeHit(_message.Message):
    __slots__ = ("format", "text", "raw", "corners")
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    RAW_FIELD_NUMBER: _ClassVar[int]
    CORNERS_FIELD_NUMBER: _ClassVar[int]
    format: str
    text: str
    raw: bytes
    corners: _containers.RepeatedCompositeFieldContainer[Point]
    def __init__(self, format: _Optional[str] = ..., text: _Optional[str] = ..., raw: _Optional[bytes] = ..., corners: _Optional[_Iterable[_Union[Point, _Mapping]]] = ...) -> None: ...

class RungAttempt(_message.Message):
    __slots__ = ("rung", "params_json", "elapsed_ms", "hits", "rejected", "skipped")
    RUNG_FIELD_NUMBER: _ClassVar[int]
    PARAMS_JSON_FIELD_NUMBER: _ClassVar[int]
    ELAPSED_MS_FIELD_NUMBER: _ClassVar[int]
    HITS_FIELD_NUMBER: _ClassVar[int]
    REJECTED_FIELD_NUMBER: _ClassVar[int]
    SKIPPED_FIELD_NUMBER: _ClassVar[int]
    rung: str
    params_json: str
    elapsed_ms: float
    hits: _containers.RepeatedCompositeFieldContainer[DecodeHit]
    rejected: _containers.RepeatedCompositeFieldContainer[DecodeHit]
    skipped: bool
    def __init__(self, rung: _Optional[str] = ..., params_json: _Optional[str] = ..., elapsed_ms: _Optional[float] = ..., hits: _Optional[_Iterable[_Union[DecodeHit, _Mapping]]] = ..., rejected: _Optional[_Iterable[_Union[DecodeHit, _Mapping]]] = ..., skipped: _Optional[bool] = ...) -> None: ...

class DecodeBarcodeRequest(_message.Message):
    __slots__ = ("image", "ladder", "zxing")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    LADDER_FIELD_NUMBER: _ClassVar[int]
    ZXING_FIELD_NUMBER: _ClassVar[int]
    image: ImageInput
    ladder: ConfigOverride
    zxing: ConfigOverride
    def __init__(self, image: _Optional[_Union[ImageInput, _Mapping]] = ..., ladder: _Optional[_Union[ConfigOverride, _Mapping]] = ..., zxing: _Optional[_Union[ConfigOverride, _Mapping]] = ...) -> None: ...

class DecodeBarcodeResponse(_message.Message):
    __slots__ = ("success", "success_rung", "success_index", "hits", "attempts", "warnings", "steps")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_RUNG_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_INDEX_FIELD_NUMBER: _ClassVar[int]
    HITS_FIELD_NUMBER: _ClassVar[int]
    ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    success_rung: str
    success_index: int
    hits: _containers.RepeatedCompositeFieldContainer[DecodeHit]
    attempts: _containers.RepeatedCompositeFieldContainer[RungAttempt]
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[Step]
    def __init__(self, success: _Optional[bool] = ..., success_rung: _Optional[str] = ..., success_index: _Optional[int] = ..., hits: _Optional[_Iterable[_Union[DecodeHit, _Mapping]]] = ..., attempts: _Optional[_Iterable[_Union[RungAttempt, _Mapping]]] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[Step, _Mapping]]] = ...) -> None: ...

class LocateInvoiceQrRequest(_message.Message):
    __slots__ = ("image", "ladder", "zxing")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    LADDER_FIELD_NUMBER: _ClassVar[int]
    ZXING_FIELD_NUMBER: _ClassVar[int]
    image: ImageInput
    ladder: ConfigOverride
    zxing: ConfigOverride
    def __init__(self, image: _Optional[_Union[ImageInput, _Mapping]] = ..., ladder: _Optional[_Union[ConfigOverride, _Mapping]] = ..., zxing: _Optional[_Union[ConfigOverride, _Mapping]] = ...) -> None: ...

class LocateInvoiceQrResponse(_message.Message):
    __slots__ = ("left", "right", "attempts", "warnings", "steps")
    LEFT_FIELD_NUMBER: _ClassVar[int]
    RIGHT_FIELD_NUMBER: _ClassVar[int]
    ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    left: DecodeHit
    right: DecodeHit
    attempts: _containers.RepeatedCompositeFieldContainer[RungAttempt]
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[Step]
    def __init__(self, left: _Optional[_Union[DecodeHit, _Mapping]] = ..., right: _Optional[_Union[DecodeHit, _Mapping]] = ..., attempts: _Optional[_Iterable[_Union[RungAttempt, _Mapping]]] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[Step, _Mapping]]] = ...) -> None: ...

class PreprocessLabelRequest(_message.Message):
    __slots__ = ("image", "config")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    image: ImageInput
    config: ConfigOverride
    def __init__(self, image: _Optional[_Union[ImageInput, _Mapping]] = ..., config: _Optional[_Union[ConfigOverride, _Mapping]] = ...) -> None: ...

class PreprocessLabelResponse(_message.Message):
    __slots__ = ("image", "quad", "quad_method", "glare_ratio", "warnings", "steps")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    QUAD_FIELD_NUMBER: _ClassVar[int]
    QUAD_METHOD_FIELD_NUMBER: _ClassVar[int]
    GLARE_RATIO_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    image: ImageOutput
    quad: _containers.RepeatedCompositeFieldContainer[Point]
    quad_method: str
    glare_ratio: float
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[Step]
    def __init__(self, image: _Optional[_Union[ImageOutput, _Mapping]] = ..., quad: _Optional[_Iterable[_Union[Point, _Mapping]]] = ..., quad_method: _Optional[str] = ..., glare_ratio: _Optional[float] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[Step, _Mapping]]] = ...) -> None: ...

class VlmImage(_message.Message):
    __slots__ = ("image", "num_bytes", "scale")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    NUM_BYTES_FIELD_NUMBER: _ClassVar[int]
    SCALE_FIELD_NUMBER: _ClassVar[int]
    image: ImageOutput
    num_bytes: int
    scale: float
    def __init__(self, image: _Optional[_Union[ImageOutput, _Mapping]] = ..., num_bytes: _Optional[int] = ..., scale: _Optional[float] = ...) -> None: ...

class PreprocessFoodRequest(_message.Message):
    __slots__ = ("image", "config")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    image: ImageInput
    config: ConfigOverride
    def __init__(self, image: _Optional[_Union[ImageInput, _Mapping]] = ..., config: _Optional[_Union[ConfigOverride, _Mapping]] = ...) -> None: ...

class PreprocessFoodResponse(_message.Message):
    __slots__ = ("whole", "dishes_enabled", "dishes", "crops", "plates_enabled", "plates", "warnings", "steps")
    WHOLE_FIELD_NUMBER: _ClassVar[int]
    DISHES_ENABLED_FIELD_NUMBER: _ClassVar[int]
    DISHES_FIELD_NUMBER: _ClassVar[int]
    CROPS_FIELD_NUMBER: _ClassVar[int]
    PLATES_ENABLED_FIELD_NUMBER: _ClassVar[int]
    PLATES_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    whole: VlmImage
    dishes_enabled: bool
    dishes: _containers.RepeatedCompositeFieldContainer[Box]
    crops: _containers.RepeatedCompositeFieldContainer[VlmImage]
    plates_enabled: bool
    plates: _containers.RepeatedCompositeFieldContainer[Ellipse]
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[Step]
    def __init__(self, whole: _Optional[_Union[VlmImage, _Mapping]] = ..., dishes_enabled: _Optional[bool] = ..., dishes: _Optional[_Iterable[_Union[Box, _Mapping]]] = ..., crops: _Optional[_Iterable[_Union[VlmImage, _Mapping]]] = ..., plates_enabled: _Optional[bool] = ..., plates: _Optional[_Iterable[_Union[Ellipse, _Mapping]]] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[Step, _Mapping]]] = ...) -> None: ...
