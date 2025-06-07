const { Kernel } = require('../core/kernel');
const fs = require('node:fs/promises');
const path = require('node:path');
const tar = require('tar');

async function snap(outPath: string) {
  const kernel = await Kernel.create();
  const state = kernel.snapshot();
  await fs.writeFile(outPath, JSON.stringify(state, null, 2));
  console.log(`Snapshot saved to ${outPath}`);
}

async function makepkg(dir: string) {
  const metaPath = path.join(dir, 'pkg.json');
  const raw = await fs.readFile(metaPath, 'utf-8');
  const meta = JSON.parse(raw);
  const outName = `${meta.name ?? path.basename(dir)}-${meta.version ?? '0.0.0'}.tar.gz`;
  await tar.create({ gzip: true, file: outName, cwd: dir }, ['.']);
  console.log(`Package created: ${outName}`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command) {
    console.log('Usage: helios <snap|makepkg> <path>');
    process.exit(1);
  }
  switch (command) {
    case 'snap':
      if (!arg) throw new Error('snap requires output path');
      await snap(arg);
      break;
    case 'makepkg':
      if (!arg) throw new Error('makepkg requires directory');
      await makepkg(arg);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

