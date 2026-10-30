#!/usr/bin/env python3
"""Local-only orchestration. Secrets and data are never read from production."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".local/dev.env"
PROJECT = "elink-platform-dev"


def studio_source_revision():
    """Identify owned source, including edits, without treating the import SHA as a build."""
    studio = ROOT / "apps/studio"
    if (studio / ".git").exists():
        raise ValueError("Studio must be owned source, not a nested Git checkout")
    for required in ("backend/go.mod", "web/package.json", "LICENSE", "NOTICE", "Dockerfile"):
        if not (studio / required).is_file():
            raise ValueError(f"Missing owned Studio source: {required}; restore the repository checkout")
    result = run("git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "apps/studio", capture_output=True)
    digest = hashlib.sha256()
    for name in sorted(set(result.stdout.split(b"\0")) - {b""}):
        path = ROOT / os.fsdecode(name)
        if path.is_symlink():
            content = os.fsencode(os.readlink(path))
            mode = b"symlink"
        elif path.is_file():
            content = path.read_bytes()
            mode = b"executable" if path.stat().st_mode & 0o111 else b"file"
        else:
            continue
        digest.update(name + b"\0" + mode + b"\0" + hashlib.sha256(content).digest())
    return "owned-" + digest.hexdigest()[:20]


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def read_env(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, separator, value = line.partition("=")
            if not separator:
                raise ValueError(f"Invalid environment entry in {path.name}")
            values[key] = value
    return values


def init():
    studio_source_revision()
    ENV_FILE.parent.mkdir(mode=0o700, exist_ok=True)
    if ENV_FILE.exists():
        print("Preserving existing .local/dev.env and local credentials.")
        return
    overrides = read_env(ROOT / ".env") if (ROOT / ".env").exists() else {}
    console_port = overrides.get("CONSOLE_PORT", "3100")
    studio_port = overrides.get("STUDIO_PORT", "3101")
    for port in (console_port, studio_port):
        if not port.isdigit() or not 1024 <= int(port) <= 65535:
            raise ValueError("Local ports must be integers between 1024 and 65535")
    if console_port == studio_port:
        raise ValueError("Console and Studio must have different ports")
    public_url = overrides.get("NEW_API_PUBLIC_URL", "http://localhost:3000").rstrip("/")
    internal_url = overrides.get("NEW_API_INTERNAL_URL", "http://host.docker.internal:3000").rstrip("/")
    for value in (public_url, internal_url):
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
            raise ValueError("new-api URLs must be HTTP(S) origins without credentials or paths")
    password = secrets.token_hex(24)
    values = {
        "CONSOLE_PORT": console_port, "STUDIO_PORT": studio_port,
        "NEW_API_PUBLIC_URL": public_url, "NEW_API_INTERNAL_URL": internal_url,
        "CANVAS_IMAGE_TAG": "owned-dev", "CANVAS_BACKEND_IMAGE": "elink-studio-backend:dev",
        "CANVAS_WEB_IMAGE": "elink-studio-web:dev", "CANVAS_YINGCE_AGENT_IMAGE": "elink-studio-agent:dev",
        "POSTGRES_DB": "studio", "POSTGRES_USER": "studio", "POSTGRES_PASSWORD": password,
        "DATABASE_URL": f"postgresql://studio:{password}@postgres:5432/studio?sslmode=disable",
        "YINGCE_AGENT_TOKEN": secrets.token_hex(32),
        "CANVAS_UPDATER_TOKEN": "local-updater-disabled",
        "CANVAS_REGISTRATION_ENABLED": "false", "CANVAS_ALLOW_PRIVATE_UPSTREAMS": "false",
        "CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS": urllib.parse.urlsplit(internal_url).hostname,
        "CANVAS_CORS_ORIGINS": f"http://localhost:{studio_port},http://127.0.0.1:{studio_port}",
        "CANVAS_PUBLIC_BASE_URL": f"http://localhost:{studio_port}",
    }
    descriptor = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("# Local development only. Generated secrets; never commit this file.\n")
        for key, value in values.items():
            output.write(f"{key}={value}\n")
    print("Created .local/dev.env with unique local database and Agent credentials.")


def compose(*args, **kwargs):
    # Environment values override stale import pins in existing local env files.
    # Preserve all existing credentials and data; these values describe source builds only.
    environment = dict(kwargs.pop("env", os.environ))
    environment["STUDIO_COMMIT"] = studio_source_revision()
    environment["STUDIO_BASE_IMAGE"] = "elink-studio-source:dev"
    return run("docker", "compose", "--project-directory", str(ROOT), "--project-name", PROJECT,
               "--env-file", str(ENV_FILE), "-f", "apps/studio/docker-compose.deploy.yml",
               "-f", "ops/dev/compose.yaml", *args, env=environment, **kwargs)


def check():
    values = read_env(ENV_FILE)
    endpoints = {
        "Console": f"http://localhost:{values['CONSOLE_PORT']}/",
        "Platform API": f"http://localhost:{values['CONSOLE_PORT']}/api/health/ready",
        "Studio": f"http://localhost:{values['STUDIO_PORT']}/api/health/ready",
        "new-api": values["NEW_API_PUBLIC_URL"] + "/api/status",
    }
    failed = False
    for name, endpoint in endpoints.items():
        try:
            with urllib.request.urlopen(endpoint, timeout=5) as response:
                if response.status != 200:
                    raise ValueError("unexpected status")
            print(f"OK {name}: {endpoint}")
        except (urllib.error.URLError, TimeoutError, ValueError):
            print(f"UNAVAILABLE {name}: {endpoint}")
            failed = True
    if failed:
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "config", "up", "down", "status", "check", "logs", "source-version"))
    args = parser.parse_args()
    if args.action == "source-version":
        print(studio_source_revision())
        return
    if args.action in ("init", "config", "up"):
        init()
    elif not ENV_FILE.exists():
        raise ValueError("Run dev:init before using this local environment")
    if args.action == "init":
        return
    if args.action == "config":
        # Never print the expanded configuration: it contains database/Agent credentials.
        compose("config", "--quiet")
        print("Compose configuration is valid.")
    elif args.action == "up":
        compose("config", "--quiet")
        revision = studio_source_revision()
        run("docker", "build", "-t", "elink-studio-source:dev", "--build-arg", f"BUILD_COMMIT={revision}", "-f", "apps/studio/backend/Dockerfile", "apps/studio")
        compose("build")
        compose("up", "-d", "--wait", "--wait-timeout", "240")
        check()
    elif args.action == "down":
        compose("down")  # Deliberately retain all data volumes.
    elif args.action == "status":
        compose("ps", "-a")
    elif args.action == "logs":
        compose("logs", "--tail", "80")
    elif args.action == "check":
        check()


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, ValueError) as error:
        print(f"Local setup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
