/**
 * Builds lika-delat.html – the whole calculator in one file that works when it
 * is opened straight from disk (no web server, no network).
 *
 *   node scripts/build-standalone.mjs
 *
 * The page shell is index.html. The stylesheet, the favicon and the ES modules
 * under assets/js are inlined. There are no dependencies: the modules are
 * simple enough to be bundled by wrapping each one in a function that returns
 * its exports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = path.join(ROOT, 'lika-delat.html');

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Bundle the ES module graph starting at `entry` into one script. */
export function bundle(entry) {
  const seen = new Set();
  const modules = [];

  const load = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const dependencies = [];

    let code = read(file).replace(
      /^import\s+\{([^}]+)\}\s+from\s+'([^']+)';?[ \t]*$/gm,
      (match, names, specifier) => {
        const dependency = path.posix.join(path.posix.dirname(file), specifier);
        dependencies.push(dependency);
        const bindings = names.split(',').map((n) => n.trim()).filter(Boolean)
          .map((n) => n.replace(/\s+as\s+/, ': '));
        return `const { ${bindings.join(', ')} } = __modules[${JSON.stringify(dependency)}];`;
      },
    );
    if (/^import\b/m.test(code)) throw new Error(`${file}: only "import { a, b } from './file.js'" is supported`);

    const exported = [];
    code = code.replace(/^export\s+(function|const|class)\s+([A-Za-z_$][\w$]*)/gm, (match, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
    if (/^export\b/m.test(code)) throw new Error(`${file}: only "export function|const|class" is supported`);

    dependencies.forEach(load);
    modules.push([
      `// ---- ${file} ----`,
      `__modules[${JSON.stringify(file)}] = (() => {`,
      code.trimEnd(),
      `return { ${exported.join(', ')} };`,
      '})();',
    ].join('\n'));
  };

  load(entry);
  return ['const __modules = {};', ...modules].join('\n\n');
}

function replaceOnce(html, needle, replacement) {
  if (html.split(needle).length !== 2) throw new Error(`index.html: expected exactly one ${needle}`);
  return html.replace(needle, () => replacement);
}

export function buildStandalone() {
  const css = read('assets/css/styles.css').trimEnd();
  const favicon = Buffer.from(read('assets/favicon.svg')).toString('base64');
  const script = bundle('assets/js/app.js').replace(/<\/script/gi, '<\\/script');

  let html = read('index.html');
  html = replaceOnce(html, '<!DOCTYPE html>\n',
    '<!DOCTYPE html>\n<!-- Lika delat, fristående version. Skapad av scripts/build-standalone.mjs – ändra källfilerna, inte den här filen. -->\n');
  html = replaceOnce(html, '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
    `<link rel="icon" href="data:image/svg+xml;base64,${favicon}">`);
  html = replaceOnce(html, '<link rel="stylesheet" href="assets/css/styles.css">', `<style>\n${css}\n  </style>`);
  html = replaceOnce(html, '<script type="module" src="assets/js/app.js"></script>',
    `<script type="module">\n${script}\n  </script>`);
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = buildStandalone();
  fs.writeFileSync(OUTPUT, html);
  console.log(`${path.relative(ROOT, OUTPUT)}: ${(html.length / 1024).toFixed(0)} kB`);
}
