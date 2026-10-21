"""Converte os quadros capturados (captura/frames + timeline.json) em remotion/public/tela.mp4 (30 fps)
e grava remotion/public/cenas.json com o início de cada cena em segundos (já no tempo do vídeo).

Corte de trechos parados: períodos > 3 s sem nenhuma mudança na tela, que começam DEPOIS do fim da
narração da cena, são encurtados para 0,8 s. Assim um travamento eventual não vira tela congelada,
e a sincronia com a narração (que começa no início de cada cena) é preservada."""
import bisect, json, pathlib, subprocess
import imageio_ffmpeg

AQUI = pathlib.Path(__file__).parent
CAP = AQUI / 'captura'
PUB = AQUI / 'remotion' / 'public'
tl = json.loads((CAP / 'timeline.json').read_text())
narr = {n['id']: n['duracao'] for n in json.loads((PUB / 'narracao.json').read_text())}
frames = tl['frames']
cenas = tl['scenes']
t0 = frames[0]['ts']
fim = max(frames[-1]['ts'] + 1.5, cenas[-1]['start'] + narr.get(cenas[-1]['id'], 6) + 1)

starts = [c['start'] for c in cenas]
def fim_narracao(t):
    i = bisect.bisect_right(starts, t) - 1
    return starts[i] + narr.get(cenas[i]['id'], 6) + 0.8 if i >= 0 else t0

# eventos = quadros + inícios de cena; encontra lacunas ociosas após a narração
eventos = sorted([f['ts'] for f in frames] + starts + [fim])
cortes = []
for a, b in zip(eventos, eventos[1:]):
    ini = max(a, fim_narracao(a)) + 0.4
    if b - 0.4 - ini > 0.8 and b - a > 3:
        cortes.append((ini, b - 0.4))

def novo(t):
    """Tempo original → tempo no vídeo (descontando os cortes)."""
    r = 0.0
    for x, y in cortes:
        if t >= y: r += y - x
        elif t > x: r += t - x
    return t - t0 - r

linhas = []
for i, fr in enumerate(frames):
    prox = frames[i + 1]['ts'] if i + 1 < len(frames) else fim
    linhas.append(f"file '{(CAP / 'frames' / fr['file']).as_posix()}'\nduration {max(novo(prox) - novo(fr['ts']), 0.001):.4f}")
linhas.append(f"file '{(CAP / 'frames' / frames[-1]['file']).as_posix()}'")
(CAP / 'lista.txt').write_text('\n'.join(linhas))

subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(CAP / 'lista.txt'),
                '-vf', 'fps=30,scale=1600:900:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-movflags', '+faststart',
                str(PUB / 'tela.mp4')], check=True)
saida = [{'id': c['id'], 'inicio': round(novo(c['start']), 3)} for c in cenas]
total = round(novo(fim), 3)
(PUB / 'cenas.json').write_text(json.dumps({'duracao': total, 'cenas': saida}, indent=1))
removido = sum(y - x for x, y in cortes)
print(f"tela.mp4: {total:.1f}s ({len(frames)} quadros, {len(saida)} cenas, {removido:.1f}s de tela parada removidos)")
