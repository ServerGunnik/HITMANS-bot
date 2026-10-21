'use strict';

/**
 * Identyfikatory komponentow maja format `namespace:action:arg1:arg2`.
 * Router interakcji (src/handlers/interactions.js) dopasowuje handler
 * po `namespace`, a reszte przekazuje jako argumenty.
 */
const SEPARATOR = ':';

function build(namespace, action, ...args) {
  return [namespace, action, ...args].filter((part) => part !== undefined && part !== null).join(SEPARATOR);
}

function parse(customId) {
  const [namespace, action, ...args] = String(customId ?? '').split(SEPARATOR);
  return { namespace, action, args };
}

module.exports = { build, parse, SEPARATOR };
