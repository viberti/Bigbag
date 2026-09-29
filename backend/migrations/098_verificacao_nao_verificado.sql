-- 098: verificação de nomes com FALHA VISÍVEL (2026-09-29).
-- Antes, se a 2.ª opinião (VLM verificador) falhava — modelo descontinuado, timeout,
-- JSON inválido — o código devolvia [] e a verificação desligava-se em SILÊNCIO
-- (indistinguível de "nada a corrigir"). Agora:
--   * cada suspeito não verificado fica em verificacao_nome com resultado 'nao_verificado';
--   * o job da fila guarda o estado da verificação daquele talão.
-- Não destrutivo: acrescenta um valor ao fim do ENUM e colunas NULL.
-- `motivo`: porquê de uma dúvida forçada pelas salvaguardas ('outra_linha' — a opinião
-- é o nome de outra linha do talão; 'leitura_distante' — não se parece com o lido) ou o
-- erro da chamada quando 'nao_verificado'.
ALTER TABLE verificacao_nome
  MODIFY resultado ENUM('confirmado','corrigido','duvida','nao_verificado') NOT NULL,
  ADD COLUMN motivo VARCHAR(200) NULL AFTER resultado;

ALTER TABLE fatura_job
  ADD COLUMN verificacao_nomes ENUM('nao_aplicavel','sem_suspeitos','verificado','nao_verificado') NULL
    AFTER data_compra;
