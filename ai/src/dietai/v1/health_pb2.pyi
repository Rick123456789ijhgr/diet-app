from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class GetInfoRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetInfoResponse(_message.Message):
    __slots__ = ("service_version", "vlm_model")
    SERVICE_VERSION_FIELD_NUMBER: _ClassVar[int]
    VLM_MODEL_FIELD_NUMBER: _ClassVar[int]
    service_version: str
    vlm_model: str
    def __init__(self, service_version: _Optional[str] = ..., vlm_model: _Optional[str] = ...) -> None: ...
