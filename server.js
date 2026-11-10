/* TextLens bridge: serves the frontend and runs the compiled C program.
 * Usage (from the project folder):  gcc -std=c99 -o textlens main.c  &&  node bridge/server.js
 * Then open http://localhost:3000
 * The browser never runs C. This script starts ./textlens --json for each request. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'frontend');
const BIN = path.join(ROOT, process.platform === 'win32' ? 'textlens.exe' : 'textlens');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

/* Run: textlens --json [--word W] [--find F --replace R --ignore-case], text on stdin. */
function analyze(req, res) {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 400000) { req.destroy(); }
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch (e) { return send(res, 400, 'text/plain', 'Bad JSON'); }
    const args = ['--json'];
    if (typeof body.word === 'string' && body.word) args.push('--word', body.word);
    if (typeof body.find === 'string' && body.find) {
      args.push('--find', body.find, '--replace', typeof body.replace === 'string' ? body.replace : '');
      if (body.ignoreCase) args.push('--ignore-case');
    }
    const child = spawn(BIN, args);      /* no shell, so user text cannot inject commands */
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => send(res, 500, 'text/plain', 'Cannot start ./textlens. Compile it first.'));
    child.on('close', (code) => {
      if (res.headersSent) return;
      code === 0 ? send(res, 200, 'application/json; charset=utf-8', out) : send(res, 500, 'text/plain', 'C program failed');
    });
    child.stdin.on('error', () => {});
    child.stdin.end(typeof body.text === 'string' ? body.text : '');
  });
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/health') {
    return send(res, fs.existsSync(BIN) ? 200 : 503, 'application/json', JSON.stringify({ engine: 'c' }));
  }
  if (req.method === 'POST' && url === '/api/analyze') return analyze(req, res);
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed');
  const file = path.normalize(path.join(WEB, url === '/' ? 'index.html' : url));
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`TextLens bridge running at http://localhost:${PORT}`));
