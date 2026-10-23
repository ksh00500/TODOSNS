const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '../..');
const output = resolve(root, 'outputs/daytona');
mkdirSync(output, { recursive: true });
const candidates = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0').filter(Boolean))].sort();
const forbidden = /(^|\/)(\.git|\.codex|\.agents|\.daytona-private|node_modules|outputs|work|coverage|test-results|playwright-report|\.next|\.gradle|\.kotlin|build|dist|secrets)(\/|$)|(^|\/)\.env(?!\.example$)|(^|\/)(local|keystore)\.properties$|google-services\.json$|firebase-adminsdk|\.(pem|key|jks|keystore|p12|pfx|aab|apk|dump|log)$/i;
const safeSecretExample = (path) => /^infra\/secrets\/(?:\.gitignore|[^/]+\.example)$/.test(path);
const files = candidates.filter((path) => (!forbidden.test(path) || safeSecretExample(path)) && existsSync(resolve(root, path)) && lstatSync(resolve(root, path)).isFile());
const excluded = candidates.filter((path) => !files.includes(path));
const manifest = files.map((path) => {
  const data = readFileSync(resolve(root, path));
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]/.test(data.toString('utf8')) || /"type"\s*:\s*"service_account"/.test(data.toString('utf8'))) {
    throw new Error(`Credential-like material found in export candidate: ${path}`);
  }
  return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
writeFileSync(resolve(output, 'source-files.txt'), files.join('\n') + '\n');
writeFileSync(resolve(output, 'source-manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), files: manifest, excluded }, null, 2) + '\n');
execFileSync('tar', ['-czf', resolve(output, 'mungsil-source.tar.gz'), '-T', resolve(output, 'source-files.txt')], { cwd: root, stdio: 'inherit' });
const archive = readFileSync(resolve(output, 'mungsil-source.tar.gz'));
console.log(JSON.stringify({ files: files.length, sourceBytes: manifest.reduce((sum, file) => sum + file.bytes, 0), archiveBytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), excluded }, null, 2));
