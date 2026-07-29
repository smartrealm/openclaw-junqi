import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelDropdownOption } from './ModelDropdownOption';

test('current model is marked, disabled, and cannot be selected again', () => {
  let selected = '';
  const element = ModelDropdownOption({
    modelId: 'deepseek/deepseek-v4-pro',
    label: 'deepseek-v4-pro',
    current: true,
    currentLabel: 'Current model',
    onSelect: (modelId) => { selected = modelId; },
  });
  const html = renderToStaticMarkup(element);

  assert.match(html, /disabled=""/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /Current model/);
  assert.match(html, /lucide-check/);
  element.props.onClick();
  assert.equal(selected, '');
});

test('another model remains selectable', () => {
  let selected = '';
  const element = ModelDropdownOption({
    modelId: 'minimax/MiniMax-M3',
    label: 'MiniMax-M3',
    current: false,
    currentLabel: 'Current model',
    onSelect: (modelId) => { selected = modelId; },
  });

  element.props.onClick();
  assert.equal(selected, 'minimax/MiniMax-M3');
});
