import { Composition } from 'remotion';
import { Apresentacao, duracaoTotal, FPS } from './Apresentacao';

export const Root = () => (
  <Composition id="Apresentacao" component={Apresentacao} durationInFrames={duracaoTotal} fps={FPS} width={1920} height={1080} />
);
