from __future__ import annotations

import base64
import binascii
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
PACKAGE_RE = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$")
MAX_ICON_BASE64 = 45_000


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def main() -> int:
    app_name = required("APP_NAME")
    package_name = required("PACKAGE_NAME")
    target_url = required("TARGET_URL")
    fullscreen_text = required("FULLSCREEN").lower()
    icon_base64 = os.environ.get("ICON_BASE64", "").strip()

    if not PACKAGE_RE.fullmatch(package_name):
        raise ValueError("package_name must contain at least two dot-separated valid segments")
    try:
        parsed_url = urlsplit(target_url)
        _ = parsed_url.port
        valid_url = parsed_url.scheme.lower() in {"http", "https"} and parsed_url.hostname is not None
    except ValueError:
        valid_url = False
    if not valid_url or any(character.isspace() for character in target_url):
        raise ValueError("target_url must start with http:// or https://")
    if fullscreen_text not in {"true", "false"}:
        raise ValueError("fullscreen must be true or false")
    if any(ord(character) < 32 or ord(character) == 127 for character in app_name):
        raise ValueError("app_name must not contain control characters")

    icon_bytes = None
    if icon_base64:
        if len(icon_base64) > MAX_ICON_BASE64:
            raise ValueError("icon_base64 exceeds 45,000 characters")
        if icon_base64.startswith("data:image"):
            icon_base64 = icon_base64.split(",", 1)[-1]
        try:
            icon_bytes = base64.b64decode(icon_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("icon_base64 is not valid Base64") from exc
        if not icon_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("icon_base64 must contain a PNG image")

    fullscreen = fullscreen_text == "true"
    strings_path = ANDROID / "app/src/main/res/values/strings.xml"
    strings_text = strings_path.read_text(encoding="utf-8")
    strings_text, strings_count = re.subn(
        r'<string name="app_name">.*?</string>',
        f'<string name="app_name">{escape(app_name)}</string>',
        strings_text,
        count=1,
    )
    if strings_count != 1:
        raise ValueError(f"could not find app_name string in {strings_path}")

    gradle_path = ANDROID / "app/build.gradle.kts"
    gradle_text = gradle_path.read_text(encoding="utf-8")
    gradle_text, application_id_count = re.subn(
        r'(?m)^(\s*applicationId\s*=\s*")[^"]*(")',
        lambda m: m.group(1) + package_name + m.group(2),
        gradle_text,
        count=1,
    )
    gradle_text, app_name_count = re.subn(
        r'(?m)^(\s*resValue\("string", "app_name", ).*$',
        lambda m: m.group(1) + '"' + app_name.replace("\\", "\\\\").replace('"', '\\"') + '")',
        gradle_text,
        count=1,
    )
    escaped_url = target_url.replace("\\", "\\\\").replace('"', '\\"')
    escaped_field = '"' + "\\" + '"' + escaped_url + "\\" + '"' + '"' + ")"
    gradle_text, url_count = re.subn(
        r'(?m)^(\s*buildConfigField\("String", "TARGET_URL", ).*$',
        lambda m: m.group(1) + escaped_field,
        gradle_text,
        count=1,
    )
    gradle_text, fullscreen_count = re.subn(
        r'(?m)^(\s*buildConfigField\("boolean", "IS_FULLSCREEN", )(?:true|false)(\))',
        lambda m: m.group(1) + ("true" if fullscreen else "false") + m.group(2),
        gradle_text,
        count=1,
    )
    if not all((application_id_count, app_name_count, url_count, fullscreen_count)):
        raise ValueError(f"could not find all app settings in {gradle_path}")

    strings_path.write_text(strings_text, encoding="utf-8")
    gradle_path.write_text(gradle_text, encoding="utf-8")

    if icon_bytes is not None:
        icon_path = ANDROID / "app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png"
        icon_path.parent.mkdir(parents=True, exist_ok=True)
        icon_path.write_bytes(icon_bytes)
        for fallback_name in ("ic_launcher.png", "ic_launcher_round.png"):
            fallback_path = ANDROID / "app/src/main/res/mipmap-xxxhdpi" / fallback_name
            fallback_path.write_bytes(icon_bytes)

    print(f"Configured {app_name} ({package_name})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        raise SystemExit(1)
