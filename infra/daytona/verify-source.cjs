const { readFileSync, lstatSync } = require('node:fs');
const { resolve, relative, isAbsolute, sep } = require('node:path');
const { createHash } = require('node:crypto');

function verifySource(root, manifest) {
  root = resolve(root);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('No source files in manifest.');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.split('/').some((part) => !part || part === '..' || part === '.')) throw new Error('Unsafe source path.');
    const target = resolve(root, entry.path);
    const relation = relative(root, target);
    if (!relation || isAbsolute(relation) || relation === '..' || relation.startsWith('..' + sep) || seen.has(entry.path)) throw new Error('Unsafe or duplicate source path.');
    seen.add(entry.path);
    let segment = root;
    for (const part of entry.path.split('/')) {
      segment = resolve(segment, part);
      if (lstatSync(segment).isSymbolicLink()) throw new Error('Source symlinks are not allowed.');
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error(`Source size mismatch: ${entry.path}`);
    const hash = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (hash !== entry.sha256) throw new Error(`Source hash mismatch: ${entry.path}`);
  }
  return seen.size;
}

module.exports = { verifySource };
if (require.main === module) {
  const root = resolve(process.argv[2] || resolve(__dirname, '../..'));
  const manifestPath = process.argv[3];
  if (!manifestPath) throw new Error('Pass the source manifest path.');
  console.log(`Verified ${verifySource(root, JSON.parse(readFileSync(manifestPath, 'utf8')))} source files.`);
}
