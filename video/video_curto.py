"""Versão curta (≤ 3 min) do vídeo de apresentação, montada direto com ffmpeg (sem Remotion).
Usa a gravação (remotion/public/tela.mp4 + cenas.json) e a narração (remotion/public/audio + narracao.json).
Cada cena dura o tempo da sua narração; se a ação gravada for mais longa, o vídeo é acelerado (até 2,2×).
Saída: saida/gentis-apresentacao-curta.mp4 (1920×1080, legendas na imagem)."""
import json, pathlib, subprocess, tempfile
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
AQUI = pathlib.Path(__file__).parent
PUB = AQUI / 'remotion' / 'public'
SAIDA = AQUI / 'saida'; SAIDA.mkdir(exist_ok=True)

# (cena da gravação, narração usada) — a última usa a cena "tema" com a fala de encerramento
ROTEIRO = [
    ('login', 'login'), ('dashboard', 'dashboard'), ('rh-lista', 'rh-lista'), ('rh-novo', 'rh-novo'), ('rh-vt', 'rh-vt'),
    ('rh-ficha', 'rh-ficha'), ('rh-desligar', 'rh-desligar'), ('fin-visao', 'fin-visao'), ('fin-receita', 'fin-receita'),
    ('fin-baixa', 'fin-baixa'), ('est-entrada', 'est-entrada'), ('est-saida', 'est-saida'), ('cfg-empresa', 'cfg-empresa'),
    ('impressao', 'impressao'), ('tema', 'encerramento'),
]
MAX_VEL, ATRASO, FOLGA = 2.2, 0.15, 0.35

tela = json.loads((PUB / 'cenas.json').read_text())
narr = {n['id']: n for n in json.loads((PUB / 'narracao.json').read_text())}
inicio = {c['id']: c['inicio'] for c in tela['cenas']}
ordem = [c['id'] for c in tela['cenas']]

def ts(t):
    h, r = divmod(t, 3600); m, s = divmod(r, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"

tmp = pathlib.Path(tempfile.mkdtemp(prefix='gentis-curto-'))
partes, duracoes, eventos, t_acum = [], [], [], 0.0
for k, (cena, fala) in enumerate(ROTEIRO):
    ini = inicio[cena]
    i = ordem.index(cena)
    fim = inicio[ordem[i + 1]] if i + 1 < len(ordem) else tela['duracao']
    bruto = fim - ini
    alvo = narr[fala]['duracao'] + ATRASO + FOLGA
    vel = min(max(bruto / alvo, 1.0), MAX_VEL)
    dur = max(alvo, bruto / vel)
    vf = (f"trim=start={ini:.3f}:duration={bruto:.3f},setpts=(PTS-STARTPTS)/{vel:.4f},"
          f"tpad=stop_mode=clone:stop_duration={dur:.3f},trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
          f"scale=1920:1080:flags=lanczos,fps=30,format=yuv420p")
    af = f"adelay={int(ATRASO * 1000)}:all=1,apad,atrim=duration={dur:.3f},aresample=48000"
    out = tmp / f"{k:02d}.mp4"
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', str(PUB / 'tela.mp4'), '-i', str(PUB / 'audio' / f'{fala}.mp3'),
                    '-filter_complex', f"[0:v]{vf}[v];[1:a]{af}[a]", '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', str(out)], check=True)
    partes.append(out); duracoes.append(dur)
    for fr in narr[fala]['frases']:
        eventos.append((t_acum + ATRASO + fr['inicio'], t_acum + ATRASO + fr['fim'] + 0.2, fr['texto'], narr[fala]['secao']))
    print(f"  {cena:<14} {bruto:5.1f}s → {dur:5.1f}s (×{vel:.2f})")
    t_acum += dur

# legenda estilizada (ASS): faixa escura arredondada + seção atual no canto
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Legenda,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H201A110B,&H201A110B,0,0,0,0,100,100,0,0,3,14,0,2,160,160,40,1",
       "Style: Secao,DejaVu Sans,30,&H00062A2A,&H00062A2A,&H00A6B814,&H00A6B814,1,0,0,0,100,100,0,0,3,10,0,9,40,40,30,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
for a, b, txt, _ in eventos:
    ass.append(f"Dialogue: 0,{ts(a)},{ts(b)},Legenda,,0,0,0,,{txt}")
t = 0.0
for k, (cena, fala) in enumerate(ROTEIRO):
    d = duracoes[k]
    ass.append(f"Dialogue: 1,{ts(t)},{ts(t + d)},Secao,,0,0,0,,{{\\fad(250,0)}}{narr[fala]['secao']}")
    t += d
(tmp / 'legendas.ass').write_text('\n'.join(ass), encoding='utf-8')
(tmp / 'lista.txt').write_text('\n'.join(f"file '{p.as_posix()}'" for p in partes))

final = SAIDA / 'gentis-apresentacao-curta.mp4'
subprocess.run([FF, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(tmp / 'lista.txt'),
                '-vf', f"subtitles={(tmp / 'legendas.ass').as_posix()},fade=t=in:st=0:d=0.6,fade=t=out:st={t - 1.2:.2f}:d=1.2",
                '-af', f"afade=t=out:st={t - 1.2:.2f}:d=1.2",
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(final)], check=True)
print(f"\n{final} — {t:.1f}s ({t / 60:.1f} min)")
