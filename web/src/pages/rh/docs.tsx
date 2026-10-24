import { Badge } from '../../components/ui';
import { dmy } from '../../lib/format';

export interface Doc {
  id: string; employeeId: string; employeeName: string; employeeStatus: string; typeId: number; type: string; title: string | null; issueDate: string | null; expiresAt: string | null;
  notes: string | null; fileName: string | null; fileSize: number | null; status: 'vencido' | 'a_vencer' | 'valido' | 'sem_validade'; daysLeft: number | null; alertDays: number;
}
export interface DocType { id: number; name: string; requiresExpiry: boolean; alertDays: number; active: boolean; usageCount: number }

const plural = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;
/** Situação do documento com o prazo por extenso ("Vencido há 3 dias", "Vence em 12 dias"). */
export function DocBadge({ d }: { d: Pick<Doc, 'status' | 'daysLeft' | 'expiresAt'> }) {
  if (d.status === 'vencido') return <Badge tone="danger">Vencido há {plural(Math.abs(d.daysLeft ?? 0))}</Badge>;
  if (d.status === 'a_vencer') return <Badge tone="warning">{d.daysLeft === 0 ? 'Vence hoje' : `Vence em ${plural(d.daysLeft ?? 0)}`}</Badge>;
  if (d.status === 'valido') return <Badge tone="success">Válido até {dmy(d.expiresAt)}</Badge>;
  return <Badge>Sem validade</Badge>;
}
export const fileSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
