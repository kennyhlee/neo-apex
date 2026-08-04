"""R2-backed blob presigning. R2 is DataCore's blob backend the way LanceDB
is its table backend — no other service talks to R2 directly."""
import os
from functools import lru_cache

import boto3
from botocore.config import Config


def _ttl() -> int:
    return int(os.environ.get("DATACORE_R2_URL_TTL_SECONDS", "900"))


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["DATACORE_R2_ENDPOINT"],
        aws_access_key_id=os.environ["DATACORE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["DATACORE_R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", region_name="auto"),
    )


def build_storage_key(tenant_id: str, application_id: str, document_id: str, filename: str) -> str:
    return f"{tenant_id}/{application_id}/{document_id}/{filename}"


def presign_upload(storage_key: str, content_type: str) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": os.environ["DATACORE_R2_BUCKET"],
            "Key": storage_key,
            "ContentType": content_type,
        },
        ExpiresIn=_ttl(),
    )


def presign_download(storage_key: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": os.environ["DATACORE_R2_BUCKET"], "Key": storage_key},
        ExpiresIn=_ttl(),
    )
