import { mountCase } from './case.js';
import { mountThread } from './thread.js';
import { mountDub } from './dub.js';
import { mountRadar } from './radar.js';
import { mountLetter } from './letter.js';

export const SCENES = {
  case: mountCase,
  thread: mountThread,
  dub: mountDub,
  radar: mountRadar,
  letter: mountLetter,
};

export const SCENE_LABEL = {
  case: 'дело',
  thread: 'тред',
  dub: 'дубляж',
  radar: 'радар',
  letter: 'чужое письмо',
};
