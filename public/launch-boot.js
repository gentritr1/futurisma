// Run before first paint, while the circuit and its launch UI are still loading.
// Keep this small, same-origin palette in sync with launch-guide.ts.
(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('launch') !== '1') return;
  const colours = {
    greenwater: '#95c46b', bitterpan: '#f5a524', nightshift: '#ff4fa3',
    polarity: '#7c7dff', tideline: '#20c2a0', ascension: '#ff6f4f', dreamisland: '#3cc8ff',
  };
  const colour = colours[query.get('map')];
  if (!/^#[0-9a-f]{6}$/.test(colour)) return;
  document.documentElement.style.setProperty('--launch-boot-colour', colour);
  document.documentElement.dataset.launchBoot = 'true';
})();
