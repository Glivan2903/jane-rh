"""Gera a narração (voz feminina pt-BR-FranciscaNeural) de cada cena do roteiro.json.
Saída: remotion/public/audio/<id>.mp3 e remotion/public/narracao.json (duração + frases com tempo, para legendas)."""
import asyncio, json, re, subprocess, pathlib
import edge_tts, imageio_ffmpeg

VOZ = 'pt-BR-FranciscaNeural'
AQUI = pathlib.Path(__file__).parent
OUT = AQUI / 'remotion' / 'public' / 'audio'
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def duracao(arq: pathlib.Path) -> float:
    err = subprocess.run([FFMPEG, '-i', str(arq)], capture_output=True, text=True).stderr
    h, m, s = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)

async def cena(c):
    arq = OUT / f"{c['id']}.mp3"
    frases = []
    com = edge_tts.Communicate(c['texto'], VOZ, rate='+4%', boundary='SentenceBoundary')
    with open(arq, 'wb') as f:
        async for ch in com.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] in ('SentenceBoundary', 'WordBoundary'):
                frases.append({'inicio': ch['offset'] / 1e7, 'fim': (ch['offset'] + ch['duration']) / 1e7, 'texto': ch['text']})
    return {'id': c['id'], 'secao': c['secao'], 'texto': c['texto'], 'duracao': round(duracao(arq), 3), 'frases': frases}

async def main():
    roteiro = json.loads((AQUI / 'roteiro.json').read_text())
    res = [await cena(c) for c in roteiro]
    (AQUI / 'remotion' / 'public' / 'narracao.json').write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"{len(res)} cenas · {sum(r['duracao'] for r in res):.1f}s de narração")
    for r in res: print(f"  {r['id']:<20} {r['duracao']:6.2f}s  {len(r['frases'])} frases")

asyncio.run(main())
