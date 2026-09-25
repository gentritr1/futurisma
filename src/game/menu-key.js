/**
 * O (options), C (controls) and, since the garage, G (the works bay).
 * @param {string} code @param {string} [key]
 */
export function isMenuOnlyKey(code, key = '') {
  return code === 'KeyO' || code === 'KeyC' || code === 'KeyG' || (key.length === 1 && ['o','c','g'].includes(key.toLowerCase()));
}
