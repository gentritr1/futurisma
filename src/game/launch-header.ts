function span(className: string, text = ''): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className; node.textContent = text;
  return node;
}

export function launchBadge(text: string, pad = false): HTMLSpanElement {
  const node = span(`launch-badge${pad ? ' launch-badge--pad' : ''}`, text);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function icon(kind: 'sound' | 'options' | 'controls'): SVGElement {
  const namespace = document.querySelector('svg')!.namespaceURI;
  const svg = document.createElementNS(namespace, 'svg') as SVGElement;
  svg.setAttribute('viewBox', kind === 'controls' ? '0 0 26 20' : '0 0 22 22');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    sound: ['M2 8H6L11 4V18L6 14H2Z', 'M15 6Q21 11 15 16M14 9Q16 11 14 13'],
    options: ['M2 5H20M2 11H20M2 17H20', 'M7 2.5V7.5M15 8.5V13.5M9 14.5V19.5'],
    controls: ['M7 3H19A6 6 0 0 1 25 9V11A5 5 0 0 1 16 14L15 13H11L10 14A5 5 0 0 1 1 11V9A6 6 0 0 1 7 3Z', 'M8 6.5V11.5M5.5 9H10.5M17 8H19M19.5 10.5H21.5'],
  };
  paths[kind].forEach((d, index) => {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', kind === 'sound' && index === 0 ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2');
    svg.append(path);
  });
  return svg;
}

export class LaunchHeader {
  readonly node = document.createElement('nav');
  private readonly sound = document.createElement('button');
  private readonly soundLabel = span('launch-sound-label');
  private readonly daily = span('launch-header__daily');
  private readonly wallet = document.getElementById('garage-credits')!;

  constructor(toggleSound: () => void) {
    this.node.className = 'launch-top';
    this.node.setAttribute('aria-label', 'Game menus');
    this.sound.id = 'launch-sound'; this.sound.type = 'button';
    this.sound.setAttribute('aria-label', 'Sound effects (M)');
    const content = span('launch-top__content');
    content.append(icon('sound'), this.soundLabel, launchBadge('M'));
    this.sound.append(content); this.sound.addEventListener('click', toggleSound);
    this.node.append(this.sound);
    for (const [kind, pad, key] of [['options', 'Y', 'O'], ['controls', 'X', 'C']] as const) {
      const button = document.getElementById(`${kind}-button`)!;
      const content = span('launch-top__content');
      content.append(icon(kind), span('launch-top__label', kind.toUpperCase()), launchBadge(pad, true), launchBadge(key));
      button.replaceChildren(content);
      button.setAttribute('aria-label', `${kind === 'options' ? 'System options' : 'Controls'} (${pad}, ${key})`);
      this.node.append(button);
    }
    const garage = document.getElementById('garage-button')!;
    const contentGarage = span('launch-top__content');
    const identity = span('launch-header__garage');
    const title = span('launch-header__garage-title');
    title.append(span('launch-top__label', 'GARAGE'), launchBadge('G'));
    identity.append(title, this.daily);
    contentGarage.append(identity, this.wallet); garage.replaceChildren(contentGarage);
    this.node.append(garage);
    window.addEventListener('garage-purse-updated', this.refresh);
  }

  sync(): void {
    const muted = document.body.dataset.muted === 'true';
    this.soundLabel.textContent = muted ? 'OFF' : 'ON';
    this.sound.setAttribute('aria-pressed', String(!muted));
    this.sound.querySelectorAll('path')[1].setAttribute('d', muted ? 'M14 8L20 14M20 8L14 14' : 'M15 6Q21 11 15 16M14 9Q16 11 14 13');
    const source = this.node.querySelector('[data-garage-daily]');
    const done = source?.textContent?.includes('SWEPT') ? 3 : Number(source?.textContent?.match(/(\d)\/3/)?.[1] ?? 0);
    this.daily.replaceChildren(span('', `DAILY ${done}/3`));
    for (let i = 0; i < 3; i++) { const pip = span('launch-daily-pip'); pip.dataset.done = String(i < done); this.daily.append(pip); }
    document.getElementById('garage-button')!.setAttribute('aria-label', `Garage, ${this.wallet.textContent}, daily jobs ${done} of 3 done (G)`);
  }
  private readonly refresh = (): void => this.sync();
  dispose(): void { window.removeEventListener('garage-purse-updated', this.refresh); this.node.remove(); }
}
