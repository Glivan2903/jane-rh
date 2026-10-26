import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Badge, Modal, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, useAuth, useToast } from '../../lib/app';
import { downloadCsv, readSheet, type Sheet } from '../../lib/sheet';

interface Field { key: string; label: string; required?: boolean; hint: string; names: string[]; example: string }
export interface Kind { id: string; title: string; perm: string; blurb: string; fields: Field[] }
export const KINDS: Kind[] = [
  { id: 'produtos', title: 'Produtos', perm: 'est.create', blurb: 'Cadastra produtos novos. Quem já existe (mesmo nome ou código de barras) é ignorado.', fields: [
    { key: 'name', label: 'Nome', required: true, hint: 'Nome do produto', names: ['nome', 'produto', 'descricao', 'item'], example: 'Papel A4 75g' },
    { key: 'unit', label: 'Unidade', required: true, hint: 'UN, CX, KG… (já cadastrada)', names: ['unidade', 'un', 'und', 'medida'], example: 'CX' },
    { key: 'category', label: 'Categoria', hint: 'Criada se ainda não existir', names: ['categoria', 'grupo', 'tipo'], example: 'Papelaria' },
    { key: 'barcode', label: 'Código de barras', hint: 'EAN/UPC', names: ['codigo de barras', 'barras', 'ean', 'gtin', 'codigo'], example: '7891000100103' },
    { key: 'cost', label: 'Custo', hint: 'Ex.: 12,50', names: ['custo', 'preco de custo', 'valor de custo'], example: '12,50' },
    { key: 'salePrice', label: 'Preço de venda', hint: 'Ex.: 19,90', names: ['preco de venda', 'venda', 'preco', 'valor'], example: '19,90' },
    { key: 'minStock', label: 'Estoque mínimo', hint: 'Quantidade', names: ['estoque minimo', 'minimo', 'min'], example: '10' },
    { key: 'location', label: 'Localização', hint: 'Prateleira, corredor…', names: ['localizacao', 'local', 'endereco', 'prateleira'], example: 'A-01' },
    { key: 'quantity', label: 'Quantidade inicial', hint: 'Lança uma entrada de saldo inicial', names: ['quantidade', 'qtd', 'qtde', 'saldo', 'estoque'], example: '50' },
  ] },
  { id: 'parceiros', title: 'Clientes e fornecedores', perm: 'cad.create', blurb: 'Cadastra clientes e fornecedores novos. Quem já existe (mesmo CPF/CNPJ ou nome) é ignorado.', fields: [
    { key: 'name', label: 'Nome', required: true, hint: 'Nome ou razão social', names: ['nome', 'razao social', 'cliente', 'fornecedor'], example: 'Distribuidora Alfa Ltda' },
    { key: 'kind', label: 'Tipo', hint: 'Cliente, Fornecedor ou Ambos (vazio = Cliente)', names: ['tipo', 'classificacao', 'categoria'], example: 'Fornecedor' },
    { key: 'document', label: 'CPF/CNPJ', hint: 'Com ou sem pontuação', names: ['cpf/cnpj', 'cnpj', 'cpf', 'documento'], example: '11.222.333/0001-81' },
    { key: 'email', label: 'E-mail', hint: '', names: ['email', 'e-mail'], example: 'contato@alfa.com.br' },
    { key: 'phone', label: 'Telefone', hint: '', names: ['telefone', 'celular', 'fone', 'whatsapp'], example: '(11) 99999-0000' },
    { key: 'notes', label: 'Observações', hint: '', names: ['observacoes', 'obs', 'notas'], example: '' },
  ] },
  { id: 'funcionarios', title: 'Funcionários', perm: 'rh.create', blurb: 'Cadastra funcionários novos. Quem já existe (mesmo CPF) é ignorado. Com data de admissão o funcionário entra como ativo; sem data, como aguardando admissão. Cargo e departamento precisam já estar cadastrados.', fields: [
    { key: 'fullName', label: 'Nome completo', required: true, hint: 'Nome e sobrenome', names: ['nome completo', 'nome', 'funcionario', 'colaborador'], example: 'Maria da Silva' },
    { key: 'cpf', label: 'CPF', required: true, hint: 'Com ou sem pontuação', names: ['cpf', 'documento'], example: '529.982.247-25' },
    { key: 'phone', label: 'Telefone', hint: 'Opcional', names: ['telefone', 'celular', 'fone', 'whatsapp'], example: '(11) 99999-0000' },
    { key: 'email', label: 'E-mail', hint: '', names: ['email', 'e-mail'], example: 'maria@empresa.com.br' },
    { key: 'birthDate', label: 'Data de nascimento', hint: 'dd/mm/aaaa', names: ['data de nascimento', 'nascimento'], example: '15/03/1990' },
    { key: 'position', label: 'Cargo', hint: 'Já cadastrado', names: ['cargo', 'funcao'], example: 'Analista' },
    { key: 'department', label: 'Departamento', hint: 'Já cadastrado', names: ['departamento', 'setor', 'area'], example: 'Financeiro' },
    { key: 'admissionDate', label: 'Data de admissão', hint: 'dd/mm/aaaa (vazio = aguardando admissão)', names: ['data de admissao', 'admissao'], example: '01/02/2024' },
    { key: 'contractType', label: 'Tipo de vínculo', hint: 'CLT, PJ, Estágio, Temporário, Aprendiz, Autônomo, Outro', names: ['tipo de vinculo', 'vinculo', 'contrato'], example: 'CLT' },
    { key: 'salary', label: 'Salário', hint: 'Só é gravado com permissão de salário', names: ['salario', 'remuneracao'], example: '3500,00' },
    { key: 'cbo', label: 'CBO', hint: '6 dígitos', names: ['cbo', 'codigo cbo'], example: '252105' },
    { key: 'esocial', label: 'eSocial', hint: 'Matrícula do eSocial', names: ['esocial', 'e-social', 'matricula esocial'], example: '1001234' },
    { key: 'ctps', label: 'Nº Carteira de trabalho', hint: 'Número da CTPS', names: ['carteira de trabalho', 'n carteira de trabalho', 'no carteira de trabalho', 'ctps', 'carteira'], example: '1234567' },
    { key: 'registration', label: 'Matrícula', hint: 'Vazio = gerada automaticamente', names: ['matricula'], example: 'M000123' },
    { key: 'payrollNumber', label: 'Nº Folha', hint: '', names: ['n folha', 'no folha', 'numero da folha', 'folha'], example: '4567' },
    { key: 'pisPasep', label: 'PIS/PASEP', hint: '', names: ['pis/pasep', 'pis', 'pasep'], example: '12345678919' },
    { key: 'transportVoucher', label: 'Vale-transporte', hint: 'Sim ou Não', names: ['vale-transporte', 'vale transporte', 'vt'], example: 'Sim' },
    { key: 'city', label: 'Cidade', hint: '', names: ['cidade', 'municipio'], example: 'São Paulo' },
    { key: 'state', label: 'UF', hint: '', names: ['uf', 'estado'], example: 'SP' },
  ] },
]
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
interface Line { line: number; status: 'ok' | 'duplicado' | 'erro'; message: string }
interface Preview { ok: number; duplicado: number; erro: number; rows: Line[] }

/** Importação de uma planilha para um tipo de cadastro. Usada na página de importação e dentro dos módulos. */
export function ImportTool({ kind, onImported }: { kind: Kind; onImported?: () => void }) {
  const toast = useToast(); const input = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null); const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({}); const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ ok: number; duplicado: number; erro: number } | null>(null);

  const reset = () => { setSheet(null); setFileName(''); setMap({}); setPrev(null); setDone(null); if (input.current) input.current.value = ''; };
  const autoMap = (k: Kind, s: Sheet) => {
    const heads = s.headers.map(norm); const m: Record<string, number> = {};
    for (const f of k.fields) { const i = heads.findIndex((h) => f.names.includes(h)); if (i >= 0) m[f.key] = i; }
    return m;
  };
  const onFile = async (file?: File) => {
    if (!file) return; setPrev(null); setDone(null);
    try { const s = await readSheet(file); setSheet(s); setFileName(file.name); setMap(autoMap(kind, s)); } catch (e) { toast.error(errMsg(e)); }
  };
  const payload = useMemo(() => sheet?.rows.map((r) => Object.fromEntries(kind.fields.map((f) => [f.key, map[f.key] != null ? (r[map[f.key]] ?? '') : '']))) ?? [], [sheet, map, kind]);
  const missing = kind.fields.filter((f) => f.required && map[f.key] == null);

  const check = async () => {
    setBusy(true); setDone(null);
    try { setPrev(await api.post<Preview>(`/import/${kind.id}/preview`, { rows: payload })); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try { const r = await api.post<{ ok: number; duplicado: number; erro: number }>(`/import/${kind.id}/commit`, { rows: payload }); setDone(r); setPrev(null); if (r.ok > 0) onImported?.(); toast.success(`${r.ok} registro(s) importado(s).`); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const model = () => downloadCsv(`modelo-${kind.id}.csv`, [kind.fields.map((f) => f.label), kind.fields.map((f) => f.example)]);
  const tone = { ok: 'success', duplicado: 'neutral', erro: 'danger' } as const;
  const word = { ok: 'Será criado', duplicado: 'Ignorado', erro: 'Com erro' } as const;

  return (
    <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{kind.blurb} Nada que já está cadastrado é alterado.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={model}><Download className="h-4 w-4" /> Baixar planilha modelo</button>
          <button type="button" className="btn-primary" onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> Escolher arquivo (.xlsx ou .csv)</button>
          <input ref={input} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" aria-label="Arquivo da planilha" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>

        {sheet && !done && (
          <>
            <div>
              <p className="mb-2 text-sm font-medium">{fileName}: {sheet.rows.length} linha(s). Confira qual coluna da planilha vai em cada campo.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {kind.fields.map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="font-medium">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
                    <select className="input mt-1" value={map[f.key] ?? ''} onChange={(e) => { const m = { ...map }; if (e.target.value === '') delete m[f.key]; else m[f.key] = Number(e.target.value); setMap(m); setPrev(null); }}>
                      <option value="">Não importar</option>
                      {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                    </select>
                    {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
                  </label>
                ))}
              </div>
            </div>
            {missing.length > 0 && <p role="alert" className="text-sm text-danger">Escolha a coluna de: {missing.map((f) => f.label).join(', ')}.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy || missing.length > 0} onClick={check}>{busy && !prev ? 'Verificando…' : 'Verificar planilha'}</button>
              <button type="button" className="btn-outline" onClick={reset}>Cancelar</button>
            </div>
          </>
        )}

        {prev && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">{prev.ok} para criar</Badge><Badge tone="neutral">{prev.duplicado} já existem</Badge><Badge tone="danger">{prev.erro} com erro</Badge>
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left text-xs"><tr><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Detalhe</th></tr></thead>
                <tbody>{prev.rows.filter((r) => r.status !== 'ok' || r.message).concat(prev.rows.filter((r) => r.status === 'ok' && !r.message).slice(0, 5)).map((r) => (
                  <tr key={r.line} className="border-t border-border"><td className="px-3 py-1.5">{r.line + 1}</td><td className="px-3 py-1.5"><Badge tone={tone[r.status]}>{word[r.status]}</Badge></td><td className="px-3 py-1.5">{r.message || '—'}</td></tr>))}</tbody></table>
            </div>
            <p className="text-xs text-muted-foreground">Linhas sem problema aparecem só como amostra. O número da linha é o da planilha (a linha 1 são os títulos).</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy || prev.ok === 0} onClick={commit}>{busy ? 'Importando…' : `Importar ${prev.ok} registro(s)`}</button>
              <button type="button" className="btn-outline" onClick={reset}>Cancelar</button>
            </div>
          </div>
        )}

        {done && (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div><p className="font-medium">Importação concluída</p><p>{done.ok} criado(s), {done.duplicado} já existia(m), {done.erro} com erro (não importados).</p>
              <button type="button" className="btn-outline mt-3" onClick={reset}>Importar outra planilha</button></div>
          </div>
        )}
    </div>
  );
}

/** Janela de importação aberta a partir de um módulo (Produtos, Funcionários). */
export function ImportModal({ kindId, onClose, onImported }: { kindId: string; onClose: () => void; onImported?: () => void }) {
  const kind = KINDS.find((k) => k.id === kindId)!;
  return <Modal title={`Importar ${kind.title.toLowerCase()} de planilha`} size="xl" onClose={onClose}><ImportTool kind={kind} onImported={onImported} /></Modal>;
}

export default function Import() {
  const { can } = useAuth();
  const kinds = KINDS.filter((k) => can(k.perm));
  const [kindId, setKindId] = useState(kinds[0]?.id ?? 'produtos'); const kind = KINDS.find((k) => k.id === kindId)!;
  if (!kinds.length) return <p className="py-10 text-center text-muted-foreground">Você não tem permissão para importar planilhas.</p>;
  return (
    <div>
      <PageHeader title="Importar planilhas" subtitle="Traga produtos, funcionários e cadastros de uma planilha Excel ou CSV" icon={FileSpreadsheet} />
      <div className="mb-4 flex flex-wrap gap-2">
        {kinds.map((k) => <button key={k.id} type="button" onClick={() => setKindId(k.id)} className={k.id === kindId ? 'btn-primary' : 'btn-outline'}>{k.title}</button>)}
      </div>
      <div className="card p-4 sm:p-5"><ImportTool key={kind.id} kind={kind} /></div>
    </div>
  );
}
