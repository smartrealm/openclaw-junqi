import assert from 'node:assert/strict';
import test from 'node:test';
import { FATAL_ERROR_OVERLAY_ID, showFatalErrorOverlay } from './fatalErrorOverlay';

class FakeElement {
  id = '';
  textContent = '';
  readonly style = { cssText: '' };
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children.splice(0, this.children.length, ...children);
    for (const child of children) child.parentNode = this;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  readonly body = new FakeElement('body');
  readonly documentElement = new FakeElement('html');

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  getElementById(id: string): FakeElement | null {
    const find = (node: FakeElement): FakeElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    };
    return find(this.body) ?? find(this.documentElement);
  }
}

function documentWithReactRoot() {
  const doc = new FakeDocument();
  const appRoot = doc.createElement('div');
  appRoot.id = 'app-root';
  const reactOwnedNode = doc.createElement('main');
  appRoot.appendChild(reactOwnedNode);
  doc.body.appendChild(appRoot);
  return { doc, appRoot, reactOwnedNode };
}

test('fatal overlay leaves React-owned app-root children untouched', () => {
  const { doc, appRoot, reactOwnedNode } = documentWithReactRoot();

  const overlay = showFatalErrorOverlay(
    'JS Error',
    '<script>must remain text</script>',
    doc as unknown as Document,
  ) as unknown as FakeElement;

  assert.deepEqual(appRoot.children, [reactOwnedNode]);
  assert.equal(overlay.id, FATAL_ERROR_OVERLAY_ID);
  assert.equal(overlay.parentNode, doc.body);
  assert.equal(overlay.children[0]?.textContent, 'JS Error');
  assert.equal(overlay.children[1]?.textContent, '<script>must remain text</script>');
  assert.equal(overlay.children[1]?.children.length, 0);
});

test('fatal overlay reuses its own host for later errors', () => {
  const { doc } = documentWithReactRoot();
  const first = showFatalErrorOverlay('First', 'one', doc as unknown as Document);
  const second = showFatalErrorOverlay('Second', 'two', doc as unknown as Document);

  assert.equal(second, first);
  assert.equal(doc.body.children.filter((node) => node.id === FATAL_ERROR_OVERLAY_ID).length, 1);
  assert.equal((second as unknown as FakeElement).children[0]?.textContent, 'Second');
  assert.equal((second as unknown as FakeElement).children[1]?.textContent, 'two');
});
