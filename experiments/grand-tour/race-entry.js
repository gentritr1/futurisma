// Preview entry only. Reuses current game markup and receives structured results
// at the existing UI seam; no result-text scraping or game-loop modifications.
const token = new URLSearchParams(location.search).get('tourToken');
function notify(type, payload = {}) {
  parent.postMessage({type, token, ...payload}, location.origin);
}
try {
  const response = await fetch('/');
  if (!response.ok) throw Error('The game could not be loaded.');
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  const app = page.getElementById('app');
  if (!app) throw Error('The game canvas is unavailable.');
  document.body.append(document.importNode(app, true));
  const {GameUi} = await import('/src/game/ui.ts');
  const {FuturismaGame} = await import('/src/game/game.ts');
  const showResult = GameUi.prototype.showResult;
  const canStart = FuturismaGame.prototype.canStart;
  let sent = false;
  // Finished preview rounds are consumed once. Inert blocks DOM input; this
  // existing public start gate also prevents a polled gamepad from restarting.
  FuturismaGame.prototype.canStart = function (...args) {
    return !sent && canStart.apply(this, args);
  };
  GameUi.prototype.showResult = function (...args) {
    showResult.apply(this, args);
    if (sent) return;
    sent = true;
    this.restartButton.hidden = true;
    document.getElementById('circuit-select-button').hidden = true;
    const [elapsedMs, totalLaps, bestLapMs, lapTimesMs, position, racerCount, standings] = args;
    notify('tour-finish', {result:{elapsedMs, totalLaps, bestLapMs, lapTimesMs, position, racerCount, standings}});
  };
  await import('/src/main.ts');
  notify('tour-ready');
} catch (error) {
  notify('tour-error', {message: error instanceof Error ? error.message : 'The race could not start.'});
}
