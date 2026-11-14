const test = require('node:test');
const assert = require('node:assert');
const { sum } = require('../src/sum.js');

test('sum adds two amounts', () => {
  assert.strictEqual(sum(2, 3), 5);
});

test('sum handles zero', () => {
  assert.strictEqual(sum(0, 7), 7);
});
