# Vídeo de apresentação do Gentis

Vídeo horizontal (1920×1080) que percorre o sistema da tela de login até as configurações, com **narração em voz feminina** (pt-BR, voz neural *Francisca*) e legendas.

**Resultado:** `saida/gentis-apresentacao.mp4`

## Como foi produzido (e como refazer)

| Etapa | Arquivo | O que faz |
|---|---|---|
| 1. Dados de demonstração | `reset-demo.sh` + `seed-demo.mjs` | Recria o banco **separado** `jane_demo`, sobe a API de demo na porta 3003 e cadastra dados fictícios. O banco real não é tocado. |
| 2. Roteiro | `roteiro.json` | Texto narrado de cada cena. |
| 3. Narração | `gerar_audio.py` | Gera `remotion/public/audio/*.mp3` e `narracao.json` (duração + frases para legenda). |
| 4. Gravação | `gravar.mjs` | Chrome automatizado (1600×900), com cursor visível e digitação real, cena a cena no ritmo da narração. Salva os quadros em `captura/`. |
| 5. Tela em vídeo | `montar_tela.py` | Converte os quadros em `remotion/public/tela.mp4` e o início de cada cena em `cenas.json`. |
| 6. Montagem | `remotion/` | Abertura e encerramento animados, janela emoldurada, seção atual, legendas, barra de progresso e narração sincronizada → MP4. |

```bash
cd video
python3 -m venv .venv && .venv/bin/pip install edge-tts imageio-ffmpeg   # 1ª vez
npm install && (cd remotion && npm install)                                # 1ª vez
./reset-demo.sh                      # banco de demonstração + API :3003
.venv/bin/python gerar_audio.py      # narração
node gravar.mjs                      # gravação (~7 min)
.venv/bin/python montar_tela.py      # tela.mp4 + cenas.json
cd remotion && npm run render        # → ../saida/gentis-apresentacao.mp4
```

Para ajustar textos ou tempos: edite `roteiro.json`, rode de novo as etapas 3 a 6. Para pré-visualizar a montagem: `cd remotion && npm run studio`.

**Observações**
- A narração é sintetizada pelo serviço de voz online da Microsoft (via `edge-tts`): o texto do roteiro é enviado a esse serviço. O roteiro não contém dados pessoais.
- Todos os dados exibidos (pessoas, CPFs, empresas, valores) são fictícios. O logotipo "Exemplo RH" é gerado por `assets/gerar-logo.mjs`.
- Durante a gravação o efeito de desfoque de fundo é desligado (renderização sem GPU); no sistema real ele continua ativo.
