import { parseGuide } from '@pvme/guide-parser';
import './style.css';

const samples = import.meta.glob<string>('../../test/fixtures/*.txt', { query: '?raw', import: 'default', eager: true });
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><h1>PvME Guide Parser</h1><label>Sample <select id="sample"></select></label></header>
  <p class="hint">Source structure; Discord message sends are planned by the bot.</p>
  <p id="status" role="status"></p>
  <main>
    <section><h2>Source</h2><textarea id="source" aria-label="Guide source" spellcheck="false"></textarea></section>
    <section><h2>Parsed JSON / AST</h2><div id="json" aria-label="Parsed JSON" tabindex="0"></div></section>
  </main>
  <section class="diagnostics"><h2>Diagnostics</h2><div id="diagnostics"></div></section>`;

const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const select = document.querySelector<HTMLSelectElement>('#sample')!;
const output = document.querySelector<HTMLDivElement>('#json')!;
const diagnostics = document.querySelector<HTMLDivElement>('#diagnostics')!;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}

function json(value: unknown, path: string[] = [], prefix = '', comma = ''): HTMLElement {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (typeof value !== 'string' || text.length <= 160) return node('div', prefix + text + comma);
    const detail = node('details');
    detail.append(node('summary', `${prefix}${text.slice(0, 120)}… (${value.length} characters)${comma}`));
    detail.addEventListener('toggle', () => {
      if (detail.open && detail.childElementCount === 1) detail.append(node('pre', text + comma));
    });
    return detail;
  }
  const array = Array.isArray(value), entries = Object.entries(value);
  const opening = array ? '[' : '{', closing = array ? ']' : '}';
  if (!entries.length) return node('div', prefix + opening + closing + comma);
  const detail = node('details'), summary = node('summary');
  detail.dataset.path = path.join('.');
  detail.open = path.length === 0 || (path[0] === 'messages' && path.length <= 2);
  detail.append(summary);
  let built = false;
  function update() {
    summary.textContent = prefix + (detail.open ? opening : `${opening}…${closing}${comma} (${entries.length} ${array ? 'items' : 'keys'})`);
    if (!detail.open || built) return;
    built = true;
    const children = node('div'); children.className = 'json-children';
    entries.forEach(([key, child], index) => children.append(json(child, [...path, key], array ? '' : `${JSON.stringify(key)}: `, index < entries.length - 1 ? ',' : '')));
    detail.append(children, node('div', closing + comma));
  }
  detail.addEventListener('toggle', update);
  update();
  return detail;
}

function render() {
  const doc = parseGuide(source.value);
  output.replaceChildren(json(doc)); diagnostics.replaceChildren();
  document.querySelector('#status')!.textContent = `${doc.messages.length} source messages · ${doc.sections.length} sections · ${doc.references.length} references · ${doc.diagnostics.length} diagnostics`;
  for (const d of doc.diagnostics) {
    const button = node('button', `L${d.range.start.line}:${d.range.start.column} ${d.severity} ${d.code}: ${d.message}`);
    button.dataset.severity = d.severity;
    button.onclick = () => { source.focus(); source.setSelectionRange(d.range.start.offset, d.range.end.offset); };
    diagnostics.append(button);
  }
  if (!doc.diagnostics.length) diagnostics.textContent = 'No diagnostics.';
}

for (const path of Object.keys(samples).sort()) {
  const option = node('option', path.split('/').at(-1)!); option.value = path; select.append(option);
}
select.value = Object.keys(samples).find(path => path.endsWith('style-guide.txt'))!;
select.onchange = () => { source.value = samples[select.value]; source.setSelectionRange(0, 0); render(); };
source.oninput = render;
source.value = samples[select.value]; source.setSelectionRange(0, 0); render();
