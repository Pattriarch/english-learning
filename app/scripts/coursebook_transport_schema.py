"""Constrain known identity echoes in new transport schemas, never responses."""
from copy import deepcopy

ECHO_FIELDS = frozenset(("unitId", "requestSha256", "candidateSha256", "bundleSha256",
    "sourceSetSha256", "baseFile", "baseSha256", "baseCandidateSha256", "inputSha256"))


def bind_echo_fields(strict_schema, payload):
    result = deepcopy(strict_schema)
    for key in ECHO_FIELDS & set(result.get("properties", {})):
        field = result["properties"][key]
        value = payload.get(key)
        if field.get("type") == "string" and isinstance(value, str):
            # Native schema builders may reuse one dict for several hashes.
            # Replace this property rather than mutating an aliased dict.
            result["properties"][key] = {**deepcopy(field), "enum": [value]}
    return result


def permitted_transport(strict_schema, payload, recorded=None):
    """Keep an exact known legacy schema; reject arbitrary recorded variants."""
    current = bind_echo_fields(strict_schema, payload)
    if recorded is None:
        return current
    if recorded != strict_schema and recorded != current:
        raise ValueError("Recorded transport schema is not the exact legacy or bound-echo contract")
    return deepcopy(recorded)
