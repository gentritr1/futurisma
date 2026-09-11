import {writeFileSync} from 'node:fs';
import {renderDreamIslandBed} from '../../../src/game/dreamisland-beds.js';
for(const kind of ['surf','night']){
 const samples=renderDreamIslandBed(kind);
 writeFileSync(`/tmp/di-${kind}.f32`,Buffer.from(samples.buffer));
}
