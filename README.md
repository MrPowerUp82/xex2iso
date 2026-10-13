# XEX ⇄ ISO

Site estático (GitHub Pages) que cria ISOs de Xbox 360 (formato XISO/XDVDFS) a partir de uma pasta de jogo ou de um `.xex`, e extrai `default.xex` ou todos os arquivos de uma ISO. Tudo roda no navegador; nenhum arquivo é enviado.

## Uso
- **Criar ISO:** arraste uma pasta de jogo ou um `.xex` (ou use os botões). Para um `.xex` solto, a ISO conterá só ele, renomeado para `default.xex` (opcional). Serve para homebrew.
- **Extrair ISO:** arraste uma ISO (XISO pura ou de disco completo). Extraia só o `default.xex`, tudo (Chrome/Edge) ou arquivo por arquivo.

## Navegadores
Chrome/Edge gravam direto no disco (jogos de vários GB). Firefox/Safari funcionam via download comum, com mais limites para arquivos muito grandes.

## Limites
- Arquivos de 4 GiB ou mais não cabem no formato XISO.
- Nomes: Latin-1, até 255 bytes. Sem nomes iguais que só diferem em maiúsculas/minúsculas.
- Não remove nem recria assinaturas, não gera a partição de vídeo de discos XGD e não converte para GOD/STFS.
- A ISO gerada só roda em console desbloqueado ou em emulador.
- Ainda **não verificado contra uma ISO/ferramenta de referência**: os offsets de partição de discos completos (XGD1/2/3), o tratamento de arquivo e pasta vazios (setor 0, tamanho 0) e a ordenação dos nomes na árvore. Se uma ISO gerada não abrir no `extract-xiso`, comece por aí (`src/xdvdfs/format.js`).

## Desenvolvimento
```bash
npm test                         # testes (Node >= 20)
npm run serve                    # http://127.0.0.1:8080
node scripts/make-fixtures.mjs   # ISOs de teste em fixtures/
```
`?fallback` na URL força o caminho de download comum.

## Publicar no GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
