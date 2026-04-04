import os, sys, functools
from http.server import HTTPServer, SimpleHTTPRequestHandler

directory = "/Users/chrisfiore/Documents/Claude/Projects/DITHER"
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

Handler = functools.partial(SimpleHTTPRequestHandler, directory=directory)
HTTPServer(("", port), Handler).serve_forever()
