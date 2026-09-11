/** @param {string} code @param {string} [key] */
export function isMenuOnlyKey(code, key = '') {
  return code === 'KeyO' || code === 'KeyC' || (key.length === 1 && ['o','c'].includes(key.toLowerCase()));
}
