// Uma tarefa longa por vez: evita progresso misturado e perda do botão Cancelar.
export function createTaskRunner({ onStart = () => {}, onFinish = () => {}, onError = () => {} } = {}) {
  let current = null;
  return {
    get busy() { return current !== null; },
    cancel() { current?.abort(); },
    // Devolve false (sem executar) se já há uma tarefa em andamento.
    async run(job) {
      if (current) return false;
      const controller = new AbortController();
      current = controller;
      onStart(controller.signal);
      try {
        await job(controller.signal);
      } catch (error) {
        onError(error);
      } finally {
        current = null;
        onFinish();
      }
      return true;
    },
  };
}
