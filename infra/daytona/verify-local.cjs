const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createProxy } = require('./dev-proxy.cjs');

function environmentChecks() {
  const writes = new Map();
  const source = readFileSync(resolve(__dirname, 'setup-environment.cjs'), 'utf8');
  const context = (alreadyExists) => ({
    __dirname, console: { log() {} }, require(name) {
      if (name === 'node:fs') return {
        existsSync: () => alreadyExists, mkdirSync() {},
        writeFileSync: (path, value, options) => writes.set(path, { value, mode: options.mode }),
      };
      return require(name);
    },
  });
  vm.runInNewContext(source, context(false));
  assert.equal(writes.size, 5);
  for (const entry of writes.values()) assert.equal(entry.mode, 0o600);
  const env = writes.get(resolve(__dirname, '../../.env')).value;
  assert.match(env, /DATABASE_URL=postgresql:\/\/mungsil_runtime:[a-f0-9]{48}@127\.0\.0\.1:5432\/mungsil_dev/);
  assert.match(env, /GOOGLE_AUTH_ENABLED=false/);
  assert.match(env, /PUSH_ENABLED=false/);
  assert.match(env, /SMTP_HOST=127\.0\.0\.1/);
  assert.match(env, /MINIO_ENDPOINT=http:\/\/127\.0\.0\.1:9000/);
  assert.throws(() => vm.runInNewContext(source, context(true)), /refusing to overwrite/);
}

const listen = (server) => new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => accept(server.address().port));
});
const request = (port, path, method = 'GET', body = '') => new Promise((accept, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'Idempotency-Key': 'synthetic-proxy-check' } }, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => accept({ status: response.statusCode, body: data }));
  });
  req.on('error', reject);
  req.end(body);
});
async function main() {
  environmentChecks();
  console.log('Synthetic environment checks passed.');
  const upgradedSockets = new Set();
  const api = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => res.end(JSON.stringify({ target: 'api', path: req.url, key: req.headers['idempotency-key'], body })));
  });
  api.on('upgrade', (req, socket) => {
    upgradedSockets.add(socket);
    socket.on('close', () => upgradedSockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.on('data', (chunk) => socket.write(chunk));
  });
  const web = http.createServer((req, res) => res.end('synthetic-web:' + req.url));
  let proxy;
  try {
    const apiPort = await listen(api);
    const webPort = await listen(web);
    proxy = createProxy({ apiPort, webPort });
    const port = await listen(proxy);
    console.log('Loopback servers listening.');
    assert.equal((await request(port, '/today')).body, 'synthetic-web:/today');
    const mutation = JSON.parse((await request(port, '/api/v1/todos', 'POST', 'synthetic-body')).body);
    assert.deepEqual(mutation, { target: 'api', path: '/api/v1/todos', key: 'synthetic-proxy-check', body: 'synthetic-body' });
    assert.equal(JSON.parse((await request(port, '/socket.io/?transport=polling')).body).target, 'api');
    console.log('HTTP routing checks passed.');
    await new Promise((accept, reject) => {
      let response = '';
      let sent = false;
      const socket = net.connect(port, '127.0.0.1', () => socket.write('GET /socket.io/?transport=websocket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Upgrade forwarding timed out')); }, 5000);
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        response += chunk;
        if (!sent && response.includes('101 Switching Protocols')) { sent = true; socket.write('synthetic-upgrade'); }
        if (response.includes('synthetic-upgrade')) { clearTimeout(timeout); socket.destroy(); accept(); }
      });
    });
    console.log('Upgrade forwarding passed.');
    for (const socket of upgradedSockets) socket.destroy();
    api.closeAllConnections();
    await new Promise((accept) => api.close(accept));
    assert.equal((await request(port, '/api/v1/ready')).status, 502);
    console.log('PASS: private synthetic environment, overwrite refusal, web/API routing, POST body/key preservation, upgrade forwarding, unavailable-service response');
  } finally {
    for (const socket of upgradedSockets) socket.destroy();
    for (const server of [proxy, web, api]) {
      if (server) { server.closeAllConnections(); server.close(); }
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
