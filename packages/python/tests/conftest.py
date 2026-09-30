import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeServer:
    """A local HTTP server that records requests and answers with queued replies."""

    def __init__(self):
        self.requests = []
        self.replies = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                fake.requests.append({"method": "POST", "path": self.path, "headers": dict(self.headers), "body": body})
                status, payload, ctype, headers = fake.replies.pop(0) if fake.replies else (201, {"id": "i", "url": "u", "feed_url": "f", "read_url": "r"}, "application/json", {})
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                for k, v in headers.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def reply(self, status, payload, ctype="application/json", headers=None):
        self.replies.append((status, payload, ctype, headers or {}))


@pytest.fixture
def server():
    s = FakeServer()
    yield s
    s.httpd.shutdown()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("NOTEFEED_URL", raising=False)
    monkeypatch.delenv("NOTEFEED_FEED", raising=False)
    monkeypatch.delenv("NOTEFEED_PASSWORD", raising=False)
