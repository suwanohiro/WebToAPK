from __future__ import annotations

import base64
import binascii
import http.client
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from io import BytesIO
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from xml.sax.saxutils import escape

from PIL import Image, ImageOps, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
PACKAGE_RE = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$")
MAX_ICON_BASE64 = 45_000
MAX_PAGE_BYTES = 2_000_000
MAX_FAVICON_BYTES = 2_000_000


class FaviconLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        attributes = dict(attrs)
        rel = set((attributes.get("rel") or "").lower().split())
        href = attributes.get("href")
        if href and rel.intersection({"icon", "mask-icon", "apple-touch-icon"}):
            size_match = re.search(r"(\d+)x(\d+)", attributes.get("sizes") or "", re.IGNORECASE)
            size = int(size_match.group(1)) if size_match else 0
            self.links.append((size, href))


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: str) -> None:
        super().__init__(host, port, timeout=5)
        self.address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self.address, self.port), self.timeout)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, address: str) -> None:
        super().__init__(host, port, timeout=5, context=ssl.create_default_context())
        self.address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def fetch_public_url(url: str, max_bytes: int) -> tuple[bytes, str, str]:
    current_url = url
    for _ in range(4):
        parsed = urlsplit(current_url)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            raise ValueError("URL must use HTTP or HTTPS")
        if parsed.username or parsed.password:
            raise ValueError("URL credentials are not allowed")

        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        public_addresses = []
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise ValueError("URL resolves to a non-public address")
            public_addresses.append(address[4][0])
        if not public_addresses:
            raise ValueError("URL did not resolve to a public address")

        if parsed.scheme.lower() == "https":
            connection = PinnedHTTPSConnection(parsed.hostname, port, public_addresses[0])
        else:
            connection = PinnedHTTPConnection(parsed.hostname, port, public_addresses[0])
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        host_header = parsed.hostname.encode("idna").decode("ascii")
        if ":" in host_header:
            host_header = f"[{host_header}]"
        if port != (443 if parsed.scheme.lower() == "https" else 80):
            host_header += f":{port}"

        try:
            connection.request(
                "GET",
                path,
                headers={
                    "Host": host_header,
                    "User-Agent": "WebToAPK-Favicon-Fetcher/1.0",
                    "Accept": "text/html,image/*;q=0.9,*/*;q=0.5",
                    "Accept-Encoding": "identity",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ValueError("redirect has no location")
                current_url = urljoin(current_url, location)
                continue
            if response.status != 200:
                raise ValueError(f"HTTP status {response.status}")
            content_length = response.getheader("Content-Length")
            if content_length and int(content_length) > max_bytes:
                raise ValueError("response exceeds size limit")
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("response exceeds size limit")
            return body, current_url, response.getheader("Content-Type", "")
        finally:
            connection.close()

    raise ValueError("too many redirects")


def normalize_icon(icon_bytes: bytes, allowed_formats: set[str]) -> bytes:
    try:
        with Image.open(BytesIO(icon_bytes)) as source:
            if source.format not in allowed_formats:
                raise ValueError("unsupported icon image format")
            if max(source.size) > 4096:
                raise ValueError("icon dimensions must not exceed 4096 pixels")
            source.load()
            icon = ImageOps.fit(
                source.convert("RGBA"),
                (192, 192),
                method=Image.Resampling.LANCZOS,
            )
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("icon data is not a valid supported image") from exc

    encoded_icon = BytesIO()
    icon.save(encoded_icon, format="PNG", optimize=True)
    return encoded_icon.getvalue()


def fetch_favicon(target_url: str) -> bytes | None:
    candidates: list[str] = []
    page_url = target_url
    try:
        page, page_url, content_type = fetch_public_url(target_url, MAX_PAGE_BYTES)
        if "html" in content_type.lower():
            parser = FaviconLinkParser()
            parser.feed(page.decode("utf-8", errors="replace"))
            parser.links.sort(key=lambda link: link[0], reverse=True)
            candidates.extend(urljoin(page_url, href) for _, href in parser.links)
    except (ValueError, OSError, http.client.HTTPException, ssl.SSLError):
        pass

    page_parts = urlsplit(page_url)
    candidates.append(f"{page_parts.scheme}://{page_parts.netloc}/favicon.ico")
    for candidate in dict.fromkeys(candidates):
        try:
            image, _, _ = fetch_public_url(candidate, MAX_FAVICON_BYTES)
            return normalize_icon(image, {"PNG", "WEBP", "ICO", "JPEG", "GIF", "BMP"})
        except (ValueError, OSError, http.client.HTTPException, ssl.SSLError):
            continue

    print("::warning::Could not retrieve the website favicon; using the built-in icon")
    return None


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
        try:
            icon_bytes = normalize_icon(icon_bytes, {"PNG", "WEBP"})
        except ValueError as exc:
            raise ValueError("icon_base64 must contain a valid PNG or WebP image") from exc
    else:
        icon_bytes = fetch_favicon(target_url)

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
        r'(?m)^(\s*buildConfigField\("boolean", "IS_FULLSCREEN", )"(?:true|false)"(\))',
        lambda m: m.group(1) + '"' + ("true" if fullscreen else "false") + '"' + m.group(2),
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
