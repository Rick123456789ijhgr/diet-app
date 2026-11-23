from dietai.v1 import preprocess_pb2 as _preprocess_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ParseLabelRequest(_message.Message):
    __slots__ = ("image", "config")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    image: _preprocess_pb2.ImageInput
    config: _preprocess_pb2.ConfigOverride
    def __init__(self, image: _Optional[_Union[_preprocess_pb2.ImageInput, _Mapping]] = ..., config: _Optional[_Union[_preprocess_pb2.ConfigOverride, _Mapping]] = ...) -> None: ...

class LabelQuantity(_message.Message):
    __slots__ = ("value", "unit")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    UNIT_FIELD_NUMBER: _ClassVar[int]
    value: str
    unit: str
    def __init__(self, value: _Optional[str] = ..., unit: _Optional[str] = ...) -> None: ...

class LabelCell(_message.Message):
    __slots__ = ("field", "basis", "quantity")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    BASIS_FIELD_NUMBER: _ClassVar[int]
    QUANTITY_FIELD_NUMBER: _ClassVar[int]
    field: str
    basis: str
    quantity: LabelQuantity
    def __init__(self, field: _Optional[str] = ..., basis: _Optional[str] = ..., quantity: _Optional[_Union[LabelQuantity, _Mapping]] = ...) -> None: ...

class LabelFieldValues(_message.Message):
    __slots__ = ("field", "values")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    VALUES_FIELD_NUMBER: _ClassVar[int]
    field: str
    values: _containers.RepeatedCompositeFieldContainer[LabelQuantity]
    def __init__(self, field: _Optional[str] = ..., values: _Optional[_Iterable[_Union[LabelQuantity, _Mapping]]] = ...) -> None: ...

class OcrTextBox(_message.Message):
    __slots__ = ("text", "x", "y", "w", "h", "score")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    W_FIELD_NUMBER: _ClassVar[int]
    H_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    text: str
    x: float
    y: float
    w: float
    h: float
    score: float
    def __init__(self, text: _Optional[str] = ..., x: _Optional[float] = ..., y: _Optional[float] = ..., w: _Optional[float] = ..., h: _Optional[float] = ..., score: _Optional[float] = ...) -> None: ...

class LabelRuleResult(_message.Message):
    __slots__ = ("rule", "passed", "detail")
    RULE_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    rule: str
    passed: bool
    detail: str
    def __init__(self, rule: _Optional[str] = ..., passed: _Optional[bool] = ..., detail: _Optional[str] = ...) -> None: ...

class ParseLabelResponse(_message.Message):
    __slots__ = ("cells", "columns", "fields", "lines", "boxes", "image", "quad", "checks", "ocr_engine", "warnings", "steps")
    CELLS_FIELD_NUMBER: _ClassVar[int]
    COLUMNS_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    LINES_FIELD_NUMBER: _ClassVar[int]
    BOXES_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    QUAD_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    OCR_ENGINE_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    cells: _containers.RepeatedCompositeFieldContainer[LabelCell]
    columns: _containers.RepeatedScalarFieldContainer[str]
    fields: _containers.RepeatedCompositeFieldContainer[LabelFieldValues]
    lines: _containers.RepeatedScalarFieldContainer[str]
    boxes: _containers.RepeatedCompositeFieldContainer[OcrTextBox]
    image: _preprocess_pb2.ImageOutput
    quad: _containers.RepeatedCompositeFieldContainer[_preprocess_pb2.Point]
    checks: _containers.RepeatedCompositeFieldContainer[LabelRuleResult]
    ocr_engine: str
    warnings: _containers.RepeatedScalarFieldContainer[str]
    steps: _containers.RepeatedCompositeFieldContainer[_preprocess_pb2.Step]
    def __init__(self, cells: _Optional[_Iterable[_Union[LabelCell, _Mapping]]] = ..., columns: _Optional[_Iterable[str]] = ..., fields: _Optional[_Iterable[_Union[LabelFieldValues, _Mapping]]] = ..., lines: _Optional[_Iterable[str]] = ..., boxes: _Optional[_Iterable[_Union[OcrTextBox, _Mapping]]] = ..., image: _Optional[_Union[_preprocess_pb2.ImageOutput, _Mapping]] = ..., quad: _Optional[_Iterable[_Union[_preprocess_pb2.Point, _Mapping]]] = ..., checks: _Optional[_Iterable[_Union[LabelRuleResult, _Mapping]]] = ..., ocr_engine: _Optional[str] = ..., warnings: _Optional[_Iterable[str]] = ..., steps: _Optional[_Iterable[_Union[_preprocess_pb2.Step, _Mapping]]] = ...) -> None: ...
