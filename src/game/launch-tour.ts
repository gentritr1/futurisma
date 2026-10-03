import {TRACKS,type MapSelection} from './map-selection';

/** Show the existing first-finish ledger; race settlement remains its owner. */
export class LaunchTour {
  readonly node=document.createElement('section');
  private readonly title=document.createElement('strong');
  private readonly marks=document.createElement('div');
  private readonly note=document.createElement('p');

  constructor(){
    this.node.className='launch-tour';
    this.node.setAttribute('aria-label','Circuit tour progress');
    this.marks.className='launch-tour__marks';
    this.marks.setAttribute('role','list');
    this.marks.setAttribute('aria-label','Circuit completion');
    this.node.append(this.title,this.marks,this.note);
  }

  update(circuits:readonly string[],selection:MapSelection):void {
    const completed=TRACKS.filter(track=>circuits.includes(track.selection));
    const selected=TRACKS.find(track=>track.selection===selection)!;
    this.title.textContent=`CIRCUIT TOUR · ${completed.length} / ${TRACKS.length}`;
    this.marks.replaceChildren(...TRACKS.map(track=>{
      const mark=document.createElement('span');
      mark.dataset.complete=String(circuits.includes(track.selection));
      mark.dataset.selected=String(track.selection===selection);
      mark.setAttribute('role','listitem');
      mark.setAttribute('aria-label',`${track.label}: ${circuits.includes(track.selection)?'completed':'not yet completed'}${track.selection===selection?', selected':''}`);
      mark.textContent=circuits.includes(track.selection)?'✓':track.mapCode.slice(-2);
      return mark;
    }));
    this.note.textContent=circuits.includes(selected.selection)
      ? 'Circuit logged. Chase a better lap or take a contract in Garage.'
      : 'Finish here to log this circuit and earn a first-finish garage bonus.';
  }
}
