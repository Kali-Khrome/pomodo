#!/usr/bin/env python3
import gzip, json, os, re, sys, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
ENV = ROOT / '.env'
if ENV.exists():
    for line in ENV.read_text().splitlines():
        k, _, v = line.partition('=')
        if k.strip() and not k.lstrip().startswith('#'):
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))

TOKEN = os.environ.get('NOTION_TOKEN', '')
PORT = int(os.environ.get('PORT', 4747))
NOTION_VERSION = '2022-06-28'
DEV = '--dev' in sys.argv
TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml'}
HOST = re.compile(r'(localhost|127\.0\.0\.1)(:\d+)?')
ALLOW = [
    ('POST', r'/v1/search'),
    ('GET', r'/v1/databases/[\w-]+'),
    ('POST', r'/v1/databases/[\w-]+/query'),
    ('POST', r'/v1/pages'),
    ('GET', r'/v1/pages/[\w-]+'),
    ('PATCH', r'/v1/pages/[\w-]+'),
]

if not TOKEN:
    from mock import mock


def load():
    files = {}
    for p in (ROOT / 'public').iterdir():
        if p.is_file():
            raw = p.read_bytes()
            files['/' + p.name] = (TYPES.get(p.suffix, 'application/octet-stream'), raw, gzip.compress(raw, 9))
    return files


FILES = None if DEV else load()


class Handler(BaseHTTPRequestHandler):
    server_version, sys_version = 'PomoDo', ''

    def log_message(self, *_):
        pass

    def send(self, code, body=b'', ctype='application/json', headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def json(self, code, obj):
        self.send(code, json.dumps(obj).encode())

    def route(self):
        # Blocks DNS-rebinding: only accept requests addressed to this machine.
        if not HOST.fullmatch(self.headers.get('Host', '')):
            return self.send(403)
        path = self.path.split('?')[0]
        if path.startswith('/api/'):
            return self.api(path[4:])
        if self.command not in ('GET', 'HEAD'):
            return self.send(405)
        f = (FILES or load()).get('/index.html' if path == '/' else path)
        if not f:
            return self.send(404, b'Not found', 'text/plain')
        ctype, raw, gz = f
        headers = {'Vary': 'Accept-Encoding', 'Cache-Control': 'no-cache'}
        if 'gzip' in self.headers.get('Accept-Encoding', ''):
            self.send(200, gz, ctype, {**headers, 'Content-Encoding': 'gzip'})
        else:
            self.send(200, raw, ctype, headers)

    def api(self, path):
        # A custom header forces a CORS preflight, so other websites can't drive the proxy.
        if self.headers.get('X-PomoDo') != '1':
            return self.json(403, {'message': 'Forbidden'})
        if not any(m == self.command and re.fullmatch(p, path) for m, p in ALLOW):
            return self.json(404, {'message': 'Not allowed'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > 1_000_000:
            return self.json(413, {'message': 'Too large'})
        body = self.rfile.read(n) if n else None
        if not TOKEN:
            return self.json(*mock(self.command, path, json.loads(body or b'{}')))
        req = urllib.request.Request('https://api.notion.com' + path, data=body, method=self.command, headers={
            'Authorization': f'Bearer {TOKEN}',
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                code, out = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, out = e.code, e.read()
        except OSError as e:
            return self.json(502, {'message': f'Could not reach Notion: {e}'})
        self.send(code, out)

    do_GET = do_HEAD = do_POST = do_PATCH = route


if __name__ == '__main__':
    print(f'PomoDo. running at http://localhost:{PORT}' + ('' if TOKEN else '  (demo data: add NOTION_TOKEN to .env)'))
    try:
        ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
