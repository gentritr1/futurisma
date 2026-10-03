export const rounds = [
  {map:'greenwater', name:'GREENWATER', image:'greenwater-55.png', detail:'Humid concrete. Your opening round.'},
  {map:'nightshift', name:'NIGHT SHIFT', image:'nightshift-30.png', detail:'City after dark. Every place matters.'},
  {map:'dreamisland', name:'DREAM ISLAND', image:'dreamisland-day-30.png', detail:'From daylight into night. Your final round.'},
];
export function racerKey(row) { return row.player ? 'player' : `${row.name}|${row.team}`; }
export function validateResult(result, previous = []) {
  const rows = result?.standings;
  if (!Array.isArray(rows) || rows.length !== 4 || result.racerCount !== 4) throw Error('This cup requires a four-driver Field Race. No points were added.');
  const positions = rows.map(row => row.position).sort((a,b) => a-b);
  if (positions.join(',') !== '1,2,3,4' || rows.filter(row => row.player === true).length !== 1
    || rows.some(row => typeof row.name !== 'string' || typeof row.team !== 'string' || typeof row.player !== 'boolean')
    || new Set(rows.map(racerKey)).size !== 4) throw Error('The classification is incomplete. No points were added.');
  if (previous.length) {
    const roster = previous[0].standings.map(racerKey).sort().join('\n');
    if (rows.map(racerKey).sort().join('\n') !== roster) throw Error('The driver roster changed. Keep the same livery for the cup; this round was not counted.');
  }
  return result;
}
export function standingsFor(results) {
  const scores = new Map();
  for (const result of results) for (const row of result.standings) {
    const key = racerKey(row), previous = scores.get(key);
    scores.set(key, {...row, key, points:(previous?.points ?? 0) + 5-row.position});
  }
  // Until the final, equal scores share a rank. Final-round position breaks ties.
  const rows = [...scores.values()].sort((a,b) => b.points-a.points || a.position-b.position);
  return rows.map((row,index) => ({...row, cupPosition:results.length === rounds.length
    ? index+1 : rows.findIndex(other => other.points === row.points)+1}));
}

function finishingOrders(drivers) {
  if (drivers.length === 0) return [[]];
  return drivers.flatMap((driver, index) => finishingOrders(drivers.filter((_, other) => other !== index))
    .map(rest => [driver, ...rest]));
}

// This is a mathematical possibility, not a prediction of pace. Enumerate the
// legal remaining classifications, including the final-round tie breaker.
export function bestReachablePosition(results) {
  if (results.length === 0) return null;
  const orders = finishingOrders(results[0].standings);
  let best = 4;
  function visit(completed) {
    if (completed.length === rounds.length) {
      best = Math.min(best, standingsFor(completed).find(row => row.player).cupPosition);
      return;
    }
    for (const order of orders) {
      visit([...completed, {standings:order.map((row, index) => ({...row, position:index+1}))}]);
    }
  }
  visit(results);
  return best;
}

export function cupTarget(results) {
  if (!results.length) return {headline:'Your opening round.', detail:'Every finish earns points. Keep the same livery throughout the cup.'};
  const rows = standingsFor(results);
  const player = rows.find(row => row.player);
  if (results.length === rounds.length) {
    const wonFinal = results.at(-1).standings.find(row => row.player).position === 1;
    return {
      headline:player.cupPosition === 1 ? 'The cup is yours.' : `Cup finish: P${player.cupPosition}.`,
      detail:`${wonFinal ? 'Final round won. ' : ''}${player.points} cup points. Classification complete.`,
    };
  }
  const best = bestReachablePosition(results);
  if (best === 4) return {headline:'Cup position: P4.', detail:'The cup order is out of reach. Race for a final-round win.'};
  const target = best === 1 ? rows.find(row => !row.player)
    : rows[best-1].player ? rows[best] : rows[best-1];
  const gap = target.points-player.points;
  const relation = gap > 0 ? `${gap} ${gap === 1 ? 'point' : 'points'} ahead`
    : gap === 0 ? 'level on points' : `${-gap} ${gap === -1 ? 'point' : 'points'} behind`;
  const headline = best > 1 ? `Best available: P${best}.`
    : player.cupPosition === 1 ? rows.filter(row => row.cupPosition === 1).length > 1 ? 'You share the lead.' : 'Defend the lead.'
      : 'The cup is still in reach.';
  return {headline, detail:`${target.name} is ${relation}. ${best > 1 ? `P${best} is possible with the remaining results.` : 'Every place in the next race matters.'}`};
}

export function formatLap(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const total = Math.round(milliseconds);
  return `${Math.floor(total/60000)}:${String(Math.floor(total/1000)%60).padStart(2,'0')}.${String(total%1000).padStart(3,'0')}`;
}
