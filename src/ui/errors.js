// O Chrome usa esta mensagem (NotReadableError ou InvalidStateError) quando um arquivo de que a operação
// depende mudou no disco depois de ser lido/aberto: tanto um arquivo de origem selecionado quanto o
// arquivo de destino (a ISO) durante a gravação. Reconhecemos pelo texto, para cobrir os dois nomes.
const STALE_TEXT = /state had changed since it was read from disk/i;

export const isStaleFileError = (error) =>
  error?.name === 'NotReadableError' || STALE_TEXT.test(error?.message ?? '');

export const STALE_FILE_MESSAGE =
  'O navegador detectou que um arquivo mudou durante a operação: um arquivo de origem alterado depois de ' +
  'selecionado, ou o arquivo de destino (a ISO que está sendo gravada) alterado ou travado por outro programa, ' +
  'como OneDrive, antivírus ou indexador. Salve a ISO em uma pasta fora do OneDrive (por exemplo C:\\ISO), ' +
  'selecione os arquivos novamente e tente de novo.';

const MIB = 1024 * 1024;

// Diz em qual etapa a gravação falhou, a partir das anotações de writeParts. null se não houver dados.
export function describeFailure({ failedStage, path, offset = 0, target }) {
  const where = path ? ` do arquivo "${path}"` : '';
  const at = ` (por volta de ${(offset / MIB).toFixed(1)} MiB${path ? ' dentro dele' : ''})`;
  if (failedStage === 'read') return `Falhou ao ler a origem${where}${at}.`;
  if (failedStage === 'write') return `Falhou ao gravar no arquivo de destino${path ? ` ao copiar "${path}"` : ''}${at}.`;
  if (failedStage === 'close') {
    const swap = target ? `"${target}.crswap"` : 'um arquivo ".crswap"';
    return 'Todos os dados foram enviados, mas o Chrome falhou ao finalizar o arquivo de destino. ' +
      `A ISO completa provavelmente está em ${swap}, na pasta onde você mandou salvar: apague o "${target ?? 'nome'}" vazio e renomeie o .crswap para .iso.`;
  }
  return null;
}
