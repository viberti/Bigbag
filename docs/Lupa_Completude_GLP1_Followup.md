# Lupa GLP-1 — follow-up de COMPLETUDE (drogariamoderna)

> Follow-up da [Lupa GLP-1](Lupa_GLP1_Diagnostico.md) (2026-06-23). Objetivo: a lupa achou que a
> drogariamoderna vende Mounjaro AO VIVO mais barato (R$1.662/2.078/2.801) mas SEM linha no banco.
> Distinguir latência de bug; se latência, sanar com re-harvest dirigido; provar o antes/depois.
> Guard `precoValido` do Cluster 1 **manteve-se ATIVO**. NÃO se tocou em força clínica, qtd, equivalência nem schema.

---

## STEP A — Veredito por EAN: **LATÊNCIA** (não bug)

Busca AO VIVO pelo caminho de produção (VTEX por EAN, **EAN-âncora**) na drogariamoderna:

| EAN | live (nome / eanItem / preço / qtd) | banco | **Veredito** |
|---|---|---|---|
| 7896382709111 | "Mounjaro Tirzepatida 2,5mg" · ean=…111 · R$1.662,76 · q=10 | sem-linha | **LATÊNCIA** (vende+disp, âncora OK, banco vazio) |
| 7896382709135 | "Mounjaro Tirzepatida 5mg" · ean=…135 · R$2.078,65 · q=10 | sem-linha | **LATÊNCIA** |
| 7896382709173 | "Mounjaro Tirzepatida 10mg" · ean=…173 · R$2.801,67 · q=10 | sem-linha | **LATÊNCIA** |
| 7896382709159 / 197 / 210 | live não tem | — | NÃO-VENDE (drogariamoderna não vende essas doses) |

**Por que LATÊNCIA e não BUG:** o adaptador live devolve o **produto certo** — `eanItem` bate com o
EAN buscado, nome="Mounjaro …", disponível (q=10), preço válido. O adaptador parseia bem; o que
faltou foi a **colheita por categoria** capturar estes EANs (estavam out-of-stock na última varredura
— o guard corretamente NÃO gravou — e voltaram ao estoque). Re-harvest dirigido resolve. → prossegui ao STEP C.

---

## STEP B — Tamanho do buraco nas outras VTEX

Varredura AO VIVO vs banco dos 8 EANs GLP-1 × 17 VTEX. **Buraco real = 3 células, todas drogariamoderna.**

| ean × fonte | classe | ao vivo | banco |
|---|---|---|---|
| 7896382709111 × drogariamoderna | **FALTA-POR-LATÊNCIA** | R$1.662,76 (q10) | sem-linha |
| 7896382709135 × drogariamoderna | **FALTA-POR-LATÊNCIA** | R$2.078,65 (q10) | sem-linha |
| 7896382709173 × drogariamoderna | **FALTA-POR-LATÊNCIA** | R$2.801,67 (q10) | sem-linha |
| 7896382709197 × farmaconde | OK(esgotado) | null/esg (q0) | R$3.811,36 (24h) |
| 7896382709210 × catarinense / farmaconde | OK(esgotado) | null/esg (q0) | R$3.590 / 3.811,36 |

Nenhuma outra VTEX tem o padrão "voltou ao estoque, ainda não no banco". Os 3 ESGOTADO **não são
buraco** (temos a linha; o live é que está agora out-of-stock — staleness benigna, não falta).

---

## STEP C — Re-harvest DIRIGIDO (só 3 EANs × drogariamoderna, guard ATIVO)

`reharvest_dirigido_vtex.mjs` — mesmo caminho VTEX por EAN + mesmo UPSERT de produção + `precoValido`
ativo (só preço válido + item disponível). Backup de hoje confirmado (`app_bigbag_20260623_120616.sql.gz`;
UPSERT não-destrutivo).

| ean × fonte | resultado | preço gravado |
|---|---|---|
| drogariamoderna : 7896382709111 | **NOVA** | R$1.662,76 |
| drogariamoderna : 7896382709135 | **NOVA** | R$2.078,65 |
| drogariamoderna : 7896382709173 | **NOVA** | R$2.801,67 |

→ **3 novas + 0 atualizadas · 3 linhas no histórico.** Guard confirmado (nenhum sentinela entrou).

---

## STEP D — Prova de completude (antes/depois)

| Métrica | Antes | Depois |
|---|--:|--:|
| FALTA-POR-LATÊNCIA (ean×fonte) | **3** | **0** ✓ |
| drogariamoderna 709111 no banco | sem-linha | **R$1.662,76** ✓ |
| Mais barato do Mounjaro 2,5mg (`/info`) | ~R$1.721 (pacheco) | **R$1.662,76 @drogariamoderna** ✓ entra e ganha |
| nº ofertas (709111) | 19 | **20** |
| Sentinela nas novas linhas | — | **0** (preço válido) ✓ |
| Fidelidade (banco == ao vivo) | — | **idêntico ao centavo** (1.662,76 = 1.662,76) ✓ |

A re-rodada da lupa de completude confirma: as 3 células agora "OK (já no banco)", **FALTA total = 0**,
e a fidelidade do STEP 1 mantém-se íntegra. Os 3 ESGOTADO permanecem (correto — out-of-stock real).

---

## Conclusão
Era **latência de cadência**, não bug de adaptador. O buraco de completude (3 ofertas mais baratas em
falta, todas drogariamoderna) foi sanado por re-harvest dirigido com o guard do Cluster 1 ativo. A
oferta mais barata do Mounjaro 2,5mg agora aparece e vence a comparação. **Não-bloqueante:** a causa
estrutural é a cadência semanal do harvest VTEX por-categoria vs. itens que voltam ao estoque entre
colheitas — um refresh dirigido (ou mais frequente) dos monitorados fecharia a janela; fica como nota,
não foi acionado (fora do escopo desta tarefa).
