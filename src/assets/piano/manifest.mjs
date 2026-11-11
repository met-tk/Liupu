export const PIANO_LAYERS = Object.freeze([3, 8, 13]);

export const PIANO_INFO = Object.freeze({
  name: 'Salamander Grand Piano',
  instrument: 'Yamaha C5',
  author: 'Alexander Holm',
  license: 'CC-BY-3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
  sourceUrl: 'https://github.com/tambien/Piano/tree/0cd2c034f820c53e83ab22f5c13bd490b9e4de85/audio',
  minMidi: 21,
  maxMidi: 108,
});

const noteNames = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

export const PIANO_SAMPLES = Object.freeze(PIANO_LAYERS.flatMap(layer =>
  Array.from({ length: 30 }, (_, index) => {
    const midi = 21 + index * 3;
    const note = `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
    return Object.freeze({ note, midi, layer, file: `${note}v${layer}.mp3` });
  }),
));
