import { trackFor, type MapSelection } from './map-selection';
import { launchBadge } from './launch-header';

function element(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function keycaps(labels: string[], pad = false): HTMLElement {
  const cell = element('span', pad ? 'control-pad' : 'control-keys');
  for (const label of labels) {
    // These are a reference chart, not device-dependent action prompts.
    cell.append(element('span', ['/', '+', 'or'].includes(label) ? 'control-join' : `control-key${pad ? ' control-key--pad' : ''}`, label));
  }
  return cell;
}

/** Restyle the existing menu surfaces while retaining their focus/navigation
 * ownership and setting inputs. Control labels describe the actual bindings. */
export function installLaunchPanels(): (track: MapSelection) => void {
  const controls = document.querySelector<HTMLElement>('#controls-screen .options-panel')!;
  const options = document.querySelector<HTMLElement>('#options-screen .options-panel')!;
  for (const [panel, id, title] of [[controls, 'controls', 'CONTROLS'], [options, 'options', 'OPTIONS']] as const) {
    panel.parentElement!.setAttribute('role', 'dialog');
    panel.parentElement!.setAttribute('aria-modal', 'true');
    panel.classList.add('launch-paper');
    const heading = panel.querySelector<HTMLElement>('.options-title')!;
    heading.textContent = title;
    const close = document.getElementById(`${id}-close`)!;
    close.replaceChildren(element('span', '', 'RETURN'), launchBadge('B', true), launchBadge('ESC'));
    const header = element('header', 'launch-paper__header');
    header.append(heading, close);
    panel.prepend(header);
  }

  const context = controls.querySelector<HTMLElement>('.intro-code')!;
  const table = element('div', 'control-chart');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Keyboard and gamepad controls');
  const columns = element('div', 'control-row control-columns');
  columns.setAttribute('role', 'row');
  for (const title of ['ACTION', 'KEYBOARD', 'PAD']) {
    const cell = element('span', '', title);
    cell.setAttribute('role', 'columnheader');
    columns.append(cell);
  }
  table.append(columns);
  const rows = new Map<string, HTMLElement>();
  function section(title: string): void { table.append(element('h3', 'control-section', title)); }
  function row(label: string, keyboard: string[], pad: string[]): void {
    const line = element('div', 'control-row');
    line.setAttribute('role', 'row');
    const name = element('strong', '', label);
    name.setAttribute('role', 'rowheader');
    const keys = keycaps(keyboard), buttons = keycaps(pad, true);
    keys.setAttribute('role', 'cell'); buttons.setAttribute('role', 'cell');
    line.append(name, keys, buttons);
    table.append(line); rows.set(label, line);
  }
  section('DRIVE');
  row('THRUST', ['W', '/', '↑'], ['RT']);
  row('STEER', ['A', 'D', '/', '←', '→'], ['LS']);
  row('BRAKE', ['S', '/', '↓'], ['LT']);
  row('DRIFT', ['BRAKE', '+', 'STEER'], ['LT', '+', 'LS']);
  section('ABILITIES');
  row('BOOST', ['SHIFT', 'or', 'SPACE'], ['A']);
  row('FLIP GRAVITY', ['SPACE'], ['X']);
  row('USE POWER', ['E'], ['B']);
  const abilityNote = element('p', 'control-note');
  table.append(abilityNote);
  section('SYSTEM');
  row('RECOVER', ['R'], ['Y']);
  row('PAUSE', ['ESC', '/', 'P'], ['START']);
  row('MUTE', ['M'], ['BACK']);
  controls.querySelector('.controls-list')!.replaceWith(table);
  const descriptions: Record<string, string> = {
    'option-hud-scale': 'Size of the speed, timer and map instruments.',
    'option-menu-scale': 'Text size in menus and service sheets.',
    'option-motion': 'Reduce camera movement and interface animation.',
    'option-voice': 'Spoken race calls. The race stays readable with sound off.',
    'option-quality': 'Adaptive balances resolution and frame rate. High favours detail.',
    'option-render': 'Filmic shading or a softer early-console image.',
  };
  for (const [id, description] of Object.entries(descriptions)) {
    const control = document.getElementById(id)!;
    const note = element('p', 'option-description', description);
    note.id = `${id}-description`;
    control.setAttribute('aria-describedby', note.id);
    control.closest('.option')!.append(note);
  }

  options.querySelector('.intro-code')!.textContent = 'SET THE FEEL · TUNE YOUR RACE';
  const audioHeading = element('h3', 'control-section', 'AUDIO');
  options.insertBefore(audioHeading, document.getElementById('option-master')!.closest('.option'));
  const viewHeading = element('h3', 'control-section', 'PRESENTATION');
  options.insertBefore(viewHeading, document.getElementById('option-hud-scale')!.closest('.option'));

  return (selection) => {
    const track = trackFor(selection);
    context.textContent = `${track.mapCode.slice(-2)} ${track.label}`;
    const gravity = selection === 'polarity';
    const power = ['polarity', 'tideline', 'ascension', 'dreamisland'].includes(selection);
    rows.get('FLIP GRAVITY')!.hidden = !gravity;
    rows.get('USE POWER')!.hidden = !power;
    const boost = rows.get('BOOST')!;
    const keys = keycaps(gravity ? ['SHIFT'] : ['SHIFT', 'or', 'SPACE']);
    keys.setAttribute('role', 'cell');
    boost.children[1].replaceWith(keys);
    abilityNote.textContent = gravity
      ? 'Space changes roads at marked junctions. Shift keeps boost separate.'
      : power ? 'Use power when your circuit device is ready. Space boosts too.'
      : selection === 'frostline' ? 'Drive over cyan stabilizers or amber thermal pickups to activate them.'
      : 'Drive over cyan grip or amber thrust devices to activate them automatically. Space boosts too.';
  };
}
