-- A chave da cache de análises passa a caber também as avaliações PERSONALIZADAS
-- ("perfil:<membro>:<ean|sku:id>") — antes só EAN/sku (20 chars). Não-destrutivo.
-- Motivo: avaliarParaPerfil corria a CADA visualização da ficha (1 chamada LLM
-- por abertura) — o maior custo recorrente; passa a cache com invalidação por
-- hash do input (muda o perfil ou a nutrição → hash muda → re-gera).
ALTER TABLE produto_analise MODIFY ean VARCHAR(64) NOT NULL;
