-- Migração 010 — origem da captura da nota, para comparar caminhos:
--   'scan'    = câmara guiada + digitalização (dewarp jscanify)
--   'foto'    = foto normal (câmara nativa, sem dewarp)
--   'galeria' = imagem escolhida da galeria
--   'arquivo' = ficheiro/PDF
-- Permite medir a taxa de reconciliação por caminho (o scanner ajuda?).
ALTER TABLE fatura ADD COLUMN origem_captura VARCHAR(16) NULL AFTER metodo_extracao;
