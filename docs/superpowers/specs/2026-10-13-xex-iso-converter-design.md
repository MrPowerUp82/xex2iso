# Conversor XEX ⇄ ISO para GitHub Pages — Design

Data: 2026-10-13
Status: aguardando revisão do usuário

## 1. Objetivo

Um site estático, publicado no GitHub Pages, que converte entre arquivos de Xbox 360 e imagens ISO do Xbox 360 (formato XISO/XDVDFS) direto no navegador:

- **Criar ISO:** pasta de jogo completo, ou um/poucos `.xex` (homebrew), vira uma XISO.
- **Extrair ISO:** uma ISO vira `default.xex` isolado ou a árvore completa de arquivos.

Casos de uso confirmados: jogo completo **e** homebrew.

### Critérios de sucesso

1. O usuário arrasta uma pasta ou um `.xex`, clica em converter e baixa uma ISO que o `extract-xiso` (e leitores equivalentes) abrem sem erro.
2. O usuário arrasta uma ISO (XISO pura ou redump de disco completo), vê a lista de arquivos e extrai o `default.xex` ou tudo.
3. Imagens de vários GB funcionam em Chrome/Edge sem carregar o arquivo inteiro na RAM.
4. Nenhum byte do arquivo do usuário sai da máquina dele. Não há backend nem requisição de rede com os dados.
5. O repositório publica no GitHub Pages "a partir da branch", sem etapa de build.

### Fora do escopo (YAGNI)

- Conversão para/de GOD ou STFS, e qualquer outro container além de XISO.
- Parse, patch ou assinatura de XEX. Não há remoção de proteções nem recriação de assinaturas. O site só empacota e extrai.
- Exportar ZIP, ou gerar a partição de vídeo/segurança de um disco XGD completo.
- Vários idiomas (somente pt-BR).
- Web Worker. A E/S é assíncrona em blocos, e a UI não congela de forma relevante.

## 2. Premissas

- Um `.xex` solto é só o executável. A ISO gerada a partir dele só contém esse arquivo e serve para homebrew. Uma ISO de jogo completo exige a pasta inteira do jogo.
- A ISO gerada só roda em console desbloqueado ou em emulador. O site informa isso, sem sermão.
- O usuário fornece os próprios arquivos.

## 3. Formato XDVDFS (referência de implementação)

Todos os inteiros são little-endian. Setor = 2048 bytes. Os offsets abaixo são relativos ao **início da partição de jogo**.

**Descritor de volume** — setor 32 (byte `0x10000`):

| Offset | Tamanho | Conteúdo |
|---|---|---|
| `0x000` | 20 | `"MICROSOFT*XBOX*MEDIA"` |
| `0x014` | 4 | setor do diretório raiz |
| `0x018` | 4 | tamanho em bytes do diretório raiz |
| `0x01C` | 8 | FILETIME de criação |
| `0x024` | — | zeros |
| `0x7EC` | 20 | `"MICROSOFT*XBOX*MEDIA"` (repetido) |

**Entrada de diretório** (nó de árvore binária de busca, cada diretório é uma árvore própria):

| Offset | Tamanho | Conteúdo |
|---|---|---|
| `0x00` | 2 | filho esquerdo, em unidades de 4 bytes a partir do início do diretório (0 = nenhum) |
| `0x02` | 2 | filho direito (idem) |
| `0x04` | 4 | setor inicial dos dados |
| `0x08` | 4 | tamanho em bytes (para diretório: tamanho do diretório em disco) |
| `0x0C` | 1 | atributos (`0x10` = diretório, `0x20` = arquivo/arquivo morto, `0x01` somente leitura, `0x02` oculto, `0x04` sistema) |
| `0x0D` | 1 | tamanho do nome |
| `0x0E` | n | nome (Latin-1) |

- Cada entrada é preenchida até múltiplo de 4 bytes.
- Uma entrada não cruza o limite de um setor. O restante do setor é preenchido com `0xFF`.
- Uma entrada cujos primeiros 4 bytes são `0xFFFFFFFF` marca fim/padding.
- A ordenação da árvore compara os nomes sem diferenciar maiúsculas de minúsculas.
- Diretório vazio: setor 0 e tamanho 0 (a confirmar contra uma ISO de referência durante a implementação).

**Offsets de partição em discos completos.** ISOs redump trazem a partição de jogo deslocada. O leitor sonda o magic em `offset + 0x10000` para cada candidato: `0`, `0x18300000`, `0x0FD90000`, `0x02080000`, `0x89D80000`. **A lista de candidatos e os valores exatos devem ser confirmados contra ISOs/fontes de referência na implementação**, e não assumidos a partir desta spec.

## 4. Arquitetura

Módulos ES puros, sem bundler e sem dependências em tempo de execução.

```
index.html
styles.css
src/
  xdvdfs/format.js    constantes; codificar/decodificar descritor e entradas
  xdvdfs/reader.js    abrir ISO, achar offset, listar, ler arquivos
  xdvdfs/writer.js    layout de uma árvore de arquivos e geração da XISO
  io/sources.js       entrada: pasta arrastada, showDirectoryPicker, arquivos soltos
  io/sinks.js         saída: FileSystemWritableFileStream ou Blob + download
  ui/app.js           abas, drag-and-drop, progresso, lista de arquivos
tests/                node:test
```

### 4.1 `format.js`
Funções puras sobre `Uint8Array`/`DataView`. Sem E/S. É a base testável de leitor e gravador.

### 4.2 `reader.js`
- Entrada: um `Blob`/`File`. Todas as leituras usam `blob.slice(a, b).arrayBuffer()`.
- `openIso(blob)` → `{ partitionOffset, root }`, ou erro `NotXisoError`.
- `list(iso)` → caminhos, tamanhos e atributos, percorrendo a árvore binária por diretório.
- `readFile(iso, entry)` → `Blob` (um slice, sem cópia), para download ou gravação em fluxo.
- Só os setores de diretório são lidos para listar. Os dados dos arquivos só são lidos na extração.

### 4.3 `writer.js`
1. Entrada: árvore `{ nome, tamanho, blob? , filhos? }`.
2. Valida (ver seção 6).
3. Para cada diretório: ordena as entradas sem diferenciar maiúsculas de minúsculas, constrói uma árvore binária balanceada e serializa em setores, com padding `0xFF`.
4. Aloca setores: descritor no 32, depois diretórios, depois os dados dos arquivos, alinhados a 2048 bytes.
5. Saída: lista de partes (`Uint8Array` para metadados e padding, `Blob` slices para dados) mais o tamanho total.

### 4.4 `sources.js` / `sinks.js`
- `sources` normaliza as entradas (drag-and-drop com `webkitGetAsEntry`, `showDirectoryPicker`, `<input webkitdirectory>`, `<input type=file>`) para a árvore do gravador.
- `sinks`:
  - Chrome/Edge: `showSaveFilePicker` e escrita em fluxo das partes. Para extrair tudo, `showDirectoryPicker`.
  - Demais navegadores: `new Blob(partes)` (os blobs de arquivos permanecem referenciados e não são copiados para a RAM) e download via `URL.createObjectURL`. Na extração completa, a lista de arquivos oferece um link de download por arquivo.

### 4.5 `ui/app.js`
- Duas abas: **Criar ISO** e **Extrair ISO**.
- Criar: zona de soltar para pasta ou `.xex`, checkbox "renomear para `default.xex`" (ligado quando é um `.xex` solto), botão converter.
- Extrair: zona de soltar para ISO, tabela de conteúdo (caminho, tamanho), botões "Extrair `default.xex`" e "Extrair tudo".
- Barra de progresso por bytes, botão cancelar, área de mensagens de erro e aviso.
- Aviso de navegador no topo quando faltam as APIs de gravação direta.

## 5. Fluxo de dados

**Criar:** fonte → árvore → validação → layout → partes → sink → arquivo `.iso`.
**Extrair:** `File` → `openIso` → lista → (escolha do usuário) → `readFile` por entrada → sink.

## 6. Validações e erros

Bloqueiam a conversão, com mensagem apontando o arquivo causador:
- Arquivo com 4 GiB ou mais (o campo de tamanho é `u32`).
- Nome com mais de 255 bytes ou com caractere fora de Latin-1.
- Dois nomes iguais no mesmo diretório, sem diferenciar maiúsculas de minúsculas.
- Entrada de diretório que não cabe em um setor.

Avisos (não bloqueiam):
- A pasta não tem `default.xex` na raiz.
- O arquivo `default.xex` não começa com `XEX2`/`XEX1`.

Na leitura:
- Nenhum candidato de offset tem o magic: erro "não é uma ISO Xbox válida".
- Árvore corrompida (offset fora do diretório, ciclo, setor além do fim do arquivo): erro de leitura sem travar. Há limite de entradas visitadas para evitar loop infinito.

Cancelamento aborta a E/S, e a gravação parcial é descartada (`abort()` do `WritableStream`).

## 7. Testes

Executados com `node --test`, sem dependências.

- **Ida e volta:** árvore sintética (subpastas, arquivo vazio, arquivo de vários setores, nomes com maiúsculas/minúsculas misturadas) → gerar ISO → ler → comparar byte a byte.
- **Invariantes:** magic nos dois lugares do descritor, dados alinhados a 2048, árvore ordenada e sem ciclos, padding `0xFF` correto.
- **Offset de partição:** ISO gerada, deslocada artificialmente para cada offset candidato, é aberta corretamente.
- **Erros:** validações da seção 6 e ISO inválida.
- **Referência externa:** se `extract-xiso` ou outra ferramenta de referência estiver disponível, listar a ISO gerada com ela. Caso contrário, registrar a limitação.
- **Interface:** teste manual no navegador embutido (Chrome-like) e, se possível, no Firefox: criar a partir de pasta e de `.xex`, extrair `default.xex`, extrair tudo, cancelar.

## 8. Publicação

- Repositório com `index.html` na raiz. O GitHub Pages usa "Deploy from a branch" (`main`, pasta `/`).
- Sem build, sem CI obrigatório. O caminho dos assets é relativo, para funcionar em `usuario.github.io/repositorio/`.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Offsets de partição de discos completos incorretos | Confirmar contra fontes/ISOs de referência; lista fácil de ajustar em `format.js` |
| Detalhes de ISO "real" que o gravador não reproduz (ex.: diretório vazio) | Comparar com saída do `extract-xiso`, se disponível; documentar divergências |
| Navegadores sem API de gravação direta | `Blob` apoiado nos arquivos originais, mais aviso na interface |
| Arquivos acima de 4 GiB | Bloqueio explícito com mensagem |
