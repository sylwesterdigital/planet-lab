"""Dependency-free validation for stored and shared PlanetLab blueprints."""
import json

MAX_PLAN = 2 * 1024 * 1024


def valid_blueprint(blueprint):
    """Accept JSON-safe, bounded plans with the structures expected by the UI.

    The limit applies to UTF-8 serialized bytes, not Python character counts;
    NaN and Infinity are rejected even though Python's default encoder allows
    them. This deliberately does not constrain future blueprint fields.
    """
    if not isinstance(blueprint, dict) or not isinstance(blueprint.get('config'), dict):
        return False
    if 'place' in blueprint and not isinstance(blueprint['place'], dict):
        return False
    try:
        encoded = json.dumps(blueprint, ensure_ascii=False, allow_nan=False,
                             separators=(',', ':')).encode('utf-8')
    except (TypeError, ValueError, OverflowError, RecursionError):
        return False
    return len(encoded) <= MAX_PLAN
