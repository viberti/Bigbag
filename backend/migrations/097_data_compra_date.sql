-- 097: data_compra é uma data-CALENDÁRIO (o DIA da compra), não um instante. Passa de
-- DATETIME para DATE. Elimina a hora-do-dia (que a app nunca usa — só agrupa/exibe por dia)
-- e, com ela, a classe de bug de fuso: o mysql2 fazia um Date à hora do servidor
-- (Europe/Berlin) e o dia recuava em fusos negativos (ex.: compra em Portugal a 1-jul
-- aparecia como 30-jun no Brasil). Combinada com `dateStrings: ['DATE']` no db.js, a coluna
-- volta SEMPRE como string 'YYYY-MM-DD', imune a conversão. Preserva o DIA de todas as linhas.
ALTER TABLE fatura MODIFY data_compra DATE NOT NULL;
