const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '../..');
const output = resolve(root, 'outputs/daytona');
const keyPath = resolve(process.argv[2] || resolve(root, '.daytona-private/daytona-api-key'));
const archivePath = resolve(output, 'mungsil-source.tar.gz');
const manifestPath = resolve(output, 'source-manifest.json');
const expectedHostname = '27e0977d-d4b9-45f6-a3c3-08427bca549f';

async function main() {
  if (!existsSync(keyPath)) throw new Error('DAYTONA_KEY_FILE_REQUIRED');
  const apiKey = readFileSync(keyPath, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!apiKey || apiKey.length > 2048 || /\s/.test(apiKey)) throw new Error('DAYTONA_KEY_FILE_INVALID');
  const { Daytona } = require(resolve(output, 'tooling/node_modules/@daytonaio/sdk'));
  const daytona = new Daytona({ apiKey, apiUrl: 'https://app.daytona.io/api', otelEnabled: false, requestTimeoutMs: 45000 });
  try {
    const sandbox = await daytona.get('mungsil');
    if (sandbox.name !== 'mungsil') throw new Error('DAYTONA_TARGET_MISMATCH');
    const identity = await sandbox.process.executeCommand('hostname', '/', undefined, 15);
    if (identity.exitCode !== 0 || identity.result.trim() !== expectedHostname) throw new Error('DAYTONA_TARGET_MISMATCH');

    const archive = readFileSync(archivePath);
    const archiveSha256 = createHash('sha256').update(archive).digest('hex');
    const manifestSha256 = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
    const remoteDirectory = `/tmp/mungsil-import-${archiveSha256.slice(0, 12)}-${Date.now()}`;
    await sandbox.fs.createFolder(remoteDirectory, '700');
    await sandbox.fs.uploadFile(archivePath, `${remoteDirectory}/mungsil-source.tar.gz`, 120);
    await sandbox.fs.uploadFile(manifestPath, `${remoteDirectory}/source-manifest.json`, 30);
    const verification = await sandbox.process.executeCommand(
      `sha256sum '${remoteDirectory}/mungsil-source.tar.gz' '${remoteDirectory}/source-manifest.json'`, '/', undefined, 15,
    );
    const hashes = verification.result.trim().split(/\r?\n/).map((line) => line.split(/\s+/)[0]);
    if (verification.exitCode !== 0 || hashes.length !== 2 || hashes[0] !== archiveSha256 || hashes[1] !== manifestSha256) {
      throw new Error('DAYTONA_TRANSFER_HASH_MISMATCH');
    }
    const receipt = { sandboxId: sandbox.id, sandboxName: sandbox.name, remoteDirectory, archiveSha256, manifestSha256, archiveBytes: archive.length, verifiedAt: new Date().toISOString() };
    writeFileSync(resolve(output, 'transfer-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await daytona[Symbol.asyncDispose]();
  }
}

main().catch((error) => {
  const allowedCodes = new Set(['DAYTONA_KEY_FILE_REQUIRED', 'DAYTONA_KEY_FILE_INVALID', 'DAYTONA_TARGET_MISMATCH', 'DAYTONA_TRANSFER_HASH_MISMATCH']);
  const status = Number(error.statusCode || error.response?.status) || undefined;
  // SDK errors can include request configuration; never print credentials or full errors.
  console.error(JSON.stringify({ error: allowedCodes.has(error.message) ? error.message : 'DAYTONA_TRANSFER_FAILED', status }));
  process.exitCode = 1;
});
