/**
 * Presentation consumes the recorded verdict; it never compares or writes saves.
 * @param {{mode?:string,newBestLap?:boolean,previousBestLapMs?:number|null}|null} summary
 */
export function resultPresentation(summary) {
  return {
    timeAttack: summary?.mode === 'timeattack',
    newBestLap: summary?.newBestLap === true,
    previousBestLapMs: summary?.previousBestLapMs ?? null,
  };
}
