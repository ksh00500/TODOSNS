const http = require('node:http');
const net = require('node:net');
function createProxy({ apiPort = 4000, webPort = 3000 } = {}) {
  const portFor = (url) => /^\/(api(?:\/|$)|socket\.io(?:\/|\?))/.test(url) ? apiPort : webPort;
  const server = http.createServer((request, response) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: portFor(request.url), path: request.url, method: request.method, headers: request.headers }, (result) => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('개발 서비스가 시작 중이거나 중지되어 있습니다.');
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
  });
  server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(portFor(request.url), '127.0.0.1', () => {
    const headers = request.rawHeaders.reduce((lines, value, index, raw) => index % 2 === 0 ? [...lines, `${value}: ${raw[index + 1]}`] : lines, []);
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('error', () => socket.destroy());
  upstream.on('close', () => socket.destroy());
  });
  return server;
}
module.exports = { createProxy };
if (require.main === module) createProxy().listen(8080, '0.0.0.0', () => console.log('Sandbox development proxy listening on port 8080'));
