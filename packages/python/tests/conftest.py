import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeServer:
    """A local HTTP server that records requests and answers with queued replies, or with `route` when set."""

    def __init__(self):
        self.requests = []
        self.replies = []
        self.route = None  # (method, path) -> (status, payload)
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self, method):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                fake.requests.append({"method": method, "path": self.path, "headers": dict(self.headers), "body": body})
                if fake.route:
                    status, payload = fake.route(method, self.path)
                    ctype, headers = "application/json", {}
                elif fake.replies:
                    status, payload, ctype, headers = fake.replies.pop(0)
                else:
                    status, payload, ctype, headers = 201, {"id": "20260930T100000Z-i", "url": "http://n/u", "feed_url": "http://n/f", "read_url": "http://n/r"}, "application/json", {}
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                for k, v in headers.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                self._handle("POST")

            def do_GET(self):
                self._handle("GET")

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
