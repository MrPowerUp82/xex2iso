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
