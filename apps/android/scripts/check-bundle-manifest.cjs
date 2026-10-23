const fs = require('node:fs');

// Android bundles encode XML as aapt2 XmlNode protobufs.
function fields(bytes) {
  const result = [];
  let offset = 0;
  function integer() {
    let value = 0, shift = 0;
    for (;;) {
      if (offset >= bytes.length || shift > 49) throw new Error('Invalid protobuf integer');
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
  }
  while (offset < bytes.length) {
    const tag = integer(), wire = tag & 7, number = Math.floor(tag / 8);
    if (wire === 0) result.push([number, integer()]);
    else if (wire === 2) {
      const length = integer();
      if (offset + length > bytes.length) throw new Error('Truncated protobuf field');
      result.push([number, bytes.subarray(offset, offset + length)]);
      offset += length;
    } else if (wire === 5) offset += 4;
    else if (wire === 1) offset += 8;
    else throw new Error('Unexpected protobuf wire type');
  }
  return result;
}
const stringField = (values, number) => values.find(([key, value]) => key === number && Buffer.isBuffer(value))?.[1].toString('utf8');
const summary = {};
function visit(bytes) {
  const element = fields(bytes).find(([key]) => key === 1)?.[1];
  if (!element) return;
  const values = fields(element), name = stringField(values, 3);
  if (name === 'manifest' || name === 'uses-sdk') {
    summary[name] = {};
    for (const [, attribute] of values.filter(([key]) => key === 4)) {
      const attr = fields(attribute);
      summary[name][stringField(attr, 2)] = stringField(attr, 3);
    }
  }
  for (const [, child] of values.filter(([key]) => key === 5)) visit(child);
}
if (!/^\d+$/.test(process.argv[3] ?? '')) throw new Error('Expected version code is required');
visit(fs.readFileSync(process.argv[2]));
console.log(JSON.stringify(summary, null, 2));
if (summary.manifest?.package !== 'kr.kro.mungsil' || summary.manifest?.versionCode !== process.argv[3] || summary['uses-sdk']?.minSdkVersion !== '24' || summary['uses-sdk']?.targetSdkVersion !== '36') process.exitCode = 1;
if (process.argv[4] && summary.manifest?.versionName !== process.argv[4]) process.exitCode = 1;
