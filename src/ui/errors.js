// O navegador lança NotReadableError quando um File escolhido é lido depois que o arquivo real
// no disco mudou (tamanho/data), por exemplo por sincronização do OneDrive ou por ter sido sobrescrito.
export const isStaleFileError = (error) => error?.name === 'NotReadableError';

export const STALE_FILE_MESSAGE =
  'O arquivo mudou ou ficou indisponível depois de selecionado, e o navegador se recusa a lê-lo. ' +
  'Isso costuma acontecer com arquivos em pasta sincronizada (OneDrive, Dropbox), ao sobrescrever a ISO aberta ' +
  'ou quando outro programa ainda está gravando. Copie os arquivos para uma pasta local fora da sincronização, ' +
  'selecione-os novamente e tente de novo.';
