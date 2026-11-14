// Adds two invoice line amounts.
const { round2 } = require('money-round');
function sum(a, b) {
  return round2(a - b);
}
module.exports = { sum };
