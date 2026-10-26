import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanBarcode } from 'lucide-react';
import { Modal } from './ui';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
interface Detector { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

const explain = (e: unknown) => {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'A câmera está bloqueada. Permita o uso da câmera nas configurações do navegador e tente de novo.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nenhuma câmera foi encontrada neste aparelho.';
  if (n === 'NotReadableError') return 'A câmera está em uso por outro aplicativo.';
  return 'Não foi possível abrir a câmera.';
};

/**
 * Lê código de barras pela câmera. Usa a leitura nativa do navegador quando existe (Chrome/Android) e, nos demais,
 * carrega a biblioteca ZXing sob demanda. Sempre dá para digitar o código.
 */
export function BarcodeScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(''); const [ready, setReady] = useState(false); const [manual, setManual] = useState('');
  useEffect(() => {
    let stopped = false; let stop = () => undefined as void;
    const done = (code: string) => { if (stopped || !code.trim()) return; stopped = true; stop(); navigator.vibrate?.(60); onDetect(code.trim()); };
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setErr('A câmera só funciona em conexão segura (https) e em navegadores compatíveis. Digite o código abaixo.'); return; }
      try {
        const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false } as MediaStreamConstraints;
        if (window.BarcodeDetector) {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          const v = video.current!; v.srcObject = stream; await v.play(); setReady(true);
          const det = new window.BarcodeDetector({ formats: FORMATS });
          const timer = setInterval(async () => { try { const r = await det.detect(v); if (r[0]?.rawValue) done(r[0].rawValue); } catch { /* quadro sem código */ } }, 250);
          stop = () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); };
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
          const hints = new Map<unknown, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE]]]);
          const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 200 });
          const controls = await reader.decodeFromConstraints(constraints, video.current!, (result) => { if (result) done(result.getText()); });
          if (stopped) controls.stop(); else { stop = () => controls.stop(); setReady(true); }
        }
      } catch (e) { if (!stopped) setErr(explain(e)); }
    })();
    return () => { stopped = true; stop(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Ler código de barras" size="sm" onClose={onClose}
      footer={<button type="button" className="btn-outline" onClick={onClose}>Cancelar</button>}>
      <div className="space-y-3">
        {!err && (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video ref={video} className="h-full w-full object-cover" muted playsInline aria-label="Imagem da câmera" />
            <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[28%] -translate-y-1/2 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />
            {!ready && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Abrindo a câmera…</p>}
          </div>)}
        {err ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p> : <p className="text-center text-sm text-muted-foreground">Aponte a câmera para o código de barras. Ele é lido sozinho.</p>}
        <div className="flex gap-2">
          <input className="input" aria-label="Digitar o código" placeholder="Ou digite o código" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) onDetect(manual.trim()); }} />
          <button type="button" className="btn-primary" disabled={!manual.trim()} onClick={() => onDetect(manual.trim())}>Usar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Botão que abre o leitor e devolve o código lido. */
export function ScanButton({ onCode, label = 'Ler com a câmera' }: { onCode: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-outline shrink-0" aria-label={label} title={label} onClick={() => setOpen(true)}><ScanBarcode className="h-4 w-4" /></button>
      {open && createPortal(<BarcodeScanner onClose={() => setOpen(false)} onDetect={(c) => { setOpen(false); onCode(c); }} />, document.body)}
    </>
  );
}
