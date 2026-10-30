#!/usr/bin/env python3
"""Verify the local Studio upload -> render -> download contract without model calls.

Requires a local administrator credential file. --bootstrap creates the first local
administrator only on an empty instance. Test media and credentials remain in .local/.
"""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request

from dev import ENV_FILE, ROOT, read_env


class Studio:
    def __init__(self, base):
        self.base = base
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, path, data=None, content_type="application/json"):
        body = json.dumps(data).encode() if data is not None and content_type == "application/json" else data
        request = urllib.request.Request(self.base + path, data=body, method=method, headers={"Content-Type": content_type})
        return self.client.open(request, timeout=15)

    def api(self, method, path, data=None):
        with self.request(method, path, data) as response:
            value = json.load(response)
        if value.get("code") != 0:
            raise RuntimeError(f"Studio rejected {method} {path}: code {value.get('code')}")
        return value["data"]


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, indent=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap", action="store_true", help="create the first local administrator on an empty instance")
    args = parser.parse_args()
    settings = read_env(ENV_FILE)
    base = f"http://127.0.0.1:{int(settings['STUDIO_PORT'])}"
    admin = Studio(base)
    credentials_path = ROOT / ".local/studio-admin.json"
    first_user = admin.api("GET", "/api/auth/settings")["firstUser"]
    if first_user:
        if not args.bootstrap:
            raise RuntimeError("Empty local Studio: pass --bootstrap to create a local test administrator")
        credentials = json.loads(credentials_path.read_text()) if credentials_path.exists() else {
            "username": "elink-local-admin", "password": secrets.token_urlsafe(24),
        }
        if not credentials_path.exists():
            write_private(credentials_path, credentials)
        admin.api("POST", "/api/auth/register", {**credentials, "displayName": "Elink Local Admin", "acceptedTerms": True})
    elif credentials_path.exists():
        credentials = json.loads(credentials_path.read_text())
        admin.api("POST", "/api/auth/login", credentials)
    else:
        raise RuntimeError("Existing Studio requires .local/studio-admin.json; existing accounts are never overwritten")
    print("PASS native Studio login (credentials remain in .local/studio-admin.json)")

    second_path = ROOT / ".local/studio-test-user.json"
    if second_path.exists():
        second_credentials = json.loads(second_path.read_text())
    else:
        second_credentials = {"username": "elink-test-" + secrets.token_hex(4), "password": secrets.token_urlsafe(24)}
        admin.api("POST", "/api/admin/users", {**second_credentials, "displayName": "Local isolation test", "role": "user", "status": "active"})
        write_private(second_path, second_credentials)
    other = Studio(base)
    other.api("POST", "/api/auth/login", second_credentials)
    fixtures = ROOT / ".local/media-verification"
    fixtures.mkdir(exist_ok=True)
    source = fixtures / "source.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)], check=True)
    boundary = "elink-" + secrets.token_hex(12)
    body = bytearray()
    for key, value in {"kind": "media", "width": "320", "height": "180", "durationMs": "1000"}.items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="local-test.mp4"\r\nContent-Type: video/mp4\r\n\r\n'.encode())
    body.extend(source.read_bytes())
    body.extend(f'\r\n--{boundary}--\r\n'.encode())
    with admin.request("POST", "/api/resources", bytes(body), f"multipart/form-data; boundary={boundary}") as response:
        upload = json.load(response)
    if upload.get("code") != 0:
        raise RuntimeError("Studio upload failed")
    resource_id = upload["data"]["resource"]["id"]
    print("PASS media upload")

    for client in (Studio(base), other):
        for path in (f"/api/resources/{resource_id}", f"/api/resources/{resource_id}/file"):
            try:
                with client.request("GET", path):
                    raise RuntimeError("Resource access isolation failed")
            except urllib.error.HTTPError as error:
                if error.code not in (401, 403, 404):
                    raise
    print("PASS resource metadata and download isolation (anonymous and second user)")

    task = admin.api("POST", "/api/timeline/renders", {"timeline": {
        "version": 2, "durationMs": 1000,
        "tracks": [{"id": "v1", "kind": "video", "visible": True}],
        "clips": [{"id": "clip1", "kind": "video", "trackId": "v1", "startMs": 0,
                   "durationMs": 1000, "sourceStartMs": 0, "volume": 1,
                   "directMedia": {"id": "media1", "kind": "video", "storageKey": "resource:" + resource_id}}],
    }})
    deadline = time.monotonic() + 90
    while task["status"] not in ("succeeded", "failed", "cancelled") and time.monotonic() < deadline:
        time.sleep(1)
        task = admin.api("GET", "/api/tasks/" + task["id"])
    if task["status"] != "succeeded":
        raise RuntimeError(f"Render did not succeed; inspect local task {task['id']} ({task['status']})")
    result = json.loads(task["resultJson"])
    if not isinstance(result, dict) or not result.get("resourceId"):
        raise RuntimeError("Render result did not contain a resource reference")
    output = fixtures / "rendered.mp4"
    with admin.request("GET", f"/api/resources/{result['resourceId']}/file") as response:
        output.write_bytes(response.read(16 << 20))
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)], check=True, capture_output=True, text=True)
    media = json.loads(probe.stdout)
    video = next(stream for stream in media["streams"] if stream["codec_type"] == "video")
    if video["width"] != 1920 or video["height"] != 1080 or not .9 <= float(media["format"]["duration"]) <= 1.2:
        raise RuntimeError("Rendered video dimensions or duration did not match the contract")
    for client in (Studio(base), other):
        for path in ("/api/tasks/" + task["id"], f"/api/resources/{result['resourceId']}/file"):
            try:
                with client.request("GET", path):
                    raise RuntimeError("Task or rendered resource ownership isolation failed")
            except urllib.error.HTTPError as error:
                if error.code not in (401, 403, 404):
                    raise
    report = {"status": "passed", "taskId": task["id"], "sourceResourceId": resource_id,
              "resultResourceId": result["resourceId"], "width": video["width"], "height": video["height"],
              "duration": media["format"]["duration"], "modelCalls": 0}
    (fixtures / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS queued timeline render -> authenticated download -> ffprobe (1920x1080, 1 second)")
    print("PASS task ownership isolation; no model requests or model charges")


if __name__ == "__main__":
    main()
