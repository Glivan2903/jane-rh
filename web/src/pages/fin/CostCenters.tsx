import { LookupPanel } from '../Lookup';

export default function CostCenters() {
  return <LookupPanel cfg={{ title: 'Centros de custo', subtitle: 'Classifique lançamentos por área, projeto ou unidade. O relatório "Resultado por centro de custo" usa esta classificação.', url: '/fin/cost-centers', label: 'Centro de custo', create: 'fin.create', edit: 'fin.edit', inactivate: 'fin.inactivate' }} />;
}
