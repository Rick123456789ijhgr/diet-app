from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ImageRef(_message.Message):
    __slots__ = ("image_id", "width", "height", "description", "truth_json")
    IMAGE_ID_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TRUTH_JSON_FIELD_NUMBER: _ClassVar[int]
    image_id: str
    width: int
    height: int
    description: str
    truth_json: str
    def __init__(self, image_id: _Optional[str] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., description: _Optional[str] = ..., truth_json: _Optional[str] = ...) -> None: ...

class GetConfigSchemasRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetConfigSchemasResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class PutImageRequest(_message.Message):
    __slots__ = ("encoded", "name")
    ENCODED_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    encoded: bytes
    name: str
    def __init__(self, encoded: _Optional[bytes] = ..., name: _Optional[str] = ...) -> None: ...

class PutImageResponse(_message.Message):
    __slots__ = ("image",)
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    image: ImageRef
    def __init__(self, image: _Optional[_Union[ImageRef, _Mapping]] = ...) -> None: ...

class SynthesizeRequest(_message.Message):
    __slots__ = ("scene", "params_json")
    SCENE_FIELD_NUMBER: _ClassVar[int]
    PARAMS_JSON_FIELD_NUMBER: _ClassVar[int]
    scene: str
    params_json: str
    def __init__(self, scene: _Optional[str] = ..., params_json: _Optional[str] = ...) -> None: ...

class SynthesizeResponse(_message.Message):
    __slots__ = ("image",)
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    image: ImageRef
    def __init__(self, image: _Optional[_Union[ImageRef, _Mapping]] = ...) -> None: ...

class DegradeRequest(_message.Message):
    __slots__ = ("image_id", "degradation_json")
    IMAGE_ID_FIELD_NUMBER: _ClassVar[int]
    DEGRADATION_JSON_FIELD_NUMBER: _ClassVar[int]
    image_id: str
    degradation_json: str
    def __init__(self, image_id: _Optional[str] = ..., degradation_json: _Optional[str] = ...) -> None: ...

class DegradeResponse(_message.Message):
    __slots__ = ("image",)
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    image: ImageRef
    def __init__(self, image: _Optional[_Union[ImageRef, _Mapping]] = ...) -> None: ...

class RenderViewRequest(_message.Message):
    __slots__ = ("image_id", "view", "config_json")
    IMAGE_ID_FIELD_NUMBER: _ClassVar[int]
    VIEW_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    image_id: str
    view: str
    config_json: str
    def __init__(self, image_id: _Optional[str] = ..., view: _Optional[str] = ..., config_json: _Optional[str] = ...) -> None: ...

class RenderViewResponse(_message.Message):
    __slots__ = ("image", "data_json")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    DATA_JSON_FIELD_NUMBER: _ClassVar[int]
    image: ImageRef
    data_json: str
    def __init__(self, image: _Optional[_Union[ImageRef, _Mapping]] = ..., data_json: _Optional[str] = ...) -> None: ...

class GetArtifactRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetArtifactResponse(_message.Message):
    __slots__ = ("encoded", "content_type")
    ENCODED_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    encoded: bytes
    content_type: str
    def __init__(self, encoded: _Optional[bytes] = ..., content_type: _Optional[str] = ...) -> None: ...

class SweepRequest(_message.Message):
    __slots__ = ("target", "params_json")
    TARGET_FIELD_NUMBER: _ClassVar[int]
    PARAMS_JSON_FIELD_NUMBER: _ClassVar[int]
    target: str
    params_json: str
    def __init__(self, target: _Optional[str] = ..., params_json: _Optional[str] = ...) -> None: ...

class SweepResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class RunBatchRequest(_message.Message):
    __slots__ = ("folder", "recursive", "limit", "config_json")
    FOLDER_FIELD_NUMBER: _ClassVar[int]
    RECURSIVE_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    folder: str
    recursive: bool
    limit: int
    config_json: str
    def __init__(self, folder: _Optional[str] = ..., recursive: _Optional[bool] = ..., limit: _Optional[int] = ..., config_json: _Optional[str] = ...) -> None: ...

class RunBatchResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class ListE1RunsRequest(_message.Message):
    __slots__ = ("root",)
    ROOT_FIELD_NUMBER: _ClassVar[int]
    root: str
    def __init__(self, root: _Optional[str] = ...) -> None: ...

class ListE1RunsResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class GetE1RunRequest(_message.Message):
    __slots__ = ("run_dir",)
    RUN_DIR_FIELD_NUMBER: _ClassVar[int]
    run_dir: str
    def __init__(self, run_dir: _Optional[str] = ...) -> None: ...

class GetE1RunResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...

class StartE1RunRequest(_message.Message):
    __slots__ = ("arms", "n_codes", "root")
    ARMS_FIELD_NUMBER: _ClassVar[int]
    N_CODES_FIELD_NUMBER: _ClassVar[int]
    ROOT_FIELD_NUMBER: _ClassVar[int]
    arms: _containers.RepeatedScalarFieldContainer[str]
    n_codes: int
    root: str
    def __init__(self, arms: _Optional[_Iterable[str]] = ..., n_codes: _Optional[int] = ..., root: _Optional[str] = ...) -> None: ...

class StartE1RunResponse(_message.Message):
    __slots__ = ("json",)
    JSON_FIELD_NUMBER: _ClassVar[int]
    json: str
    def __init__(self, json: _Optional[str] = ...) -> None: ...
