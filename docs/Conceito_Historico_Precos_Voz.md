# Documento Conceptual — Histórico de Compras com Consulta por Nota de Voz

> **Natureza e divisão de trabalho.** Projeto pessoal de laboratório, utilizador único. Este documento define o **conceptual e as decisões de design**; a implementação técnica é do Claude Code. Não é spec de produto comercial — o critério é aprender e experimentar ferramentas.
>
> **Sobre segredos.** As credenciais (OpenRouter, Google OAuth) vivem só no `backend/.env` (chmod 600), carregado via dotenv, **nunca versionado** — `.env` no `.gitignore` desde o primeiro commit. Este documento refere-as por nome de variável, nunca por valor. Os limites de gasto no OpenRouter e no Google são a salvaguarda de custo.

---

## 1. O que é

Uma PWA, servida no servidor próprio de produção (`85.25.46.6`, padrão do projeto 1417), que:

1. **Lê faturas** de supermercado (Continente, Pingo Doce, Mercadona, Aldi, Lidl — Braga) e extrai itens, preços, data e loja, ao nível de cada SKU.
2. **Acumula** essa massa de dados numa base MySQL própria (`app_<PROJ>`).
3. Permite **consultar por nota de voz** (estilo WhatsApp, assíncrono): gravo uma mensagem de voz → é transcrita e interpretada → **resposta em texto**.

Exemplos de consulta: *"quanto paguei pela manteiga da última vez e onde foi?"*, *"onde é que o leite tem estado mais barato?"*, *"quanto gastei em café este mês?"*

A consulta por voz é o foco do que se quer experimentar; a leitura de faturas é o meio de gerar os dados.

---

## 2. Forma e âmbito

| Dimensão | Decisão |
| --- | --- |
| Cliente | PWA (sem app store no MVP; caminho para loja depois, via wrapper, se o iOS limitar câmara/microfone) |
| Processamento | No **servidor** — chaves protegidas no backend, modelos chamados a partir do Node |
| Utilizadores | Um (eu). Sem multi-tenancy, sem `user_id` a propagar, BD trivial de modelar |
| Privacidade | Dados próprios, servidor próprio — RGPD deixa de ser questão prática a esta escala |
| Cadeias-alvo | Continente, Pingo Doce, Mercadona, Aldi, Lidl (Braga). Sugestão de faseamento: Continente + Pingo Doce primeiro (casos mais ricos), depois os outros |

**Nota PWA sobre câmara e microfone:** são as duas APIs do browser de que este projeto depende (`getUserMedia`, `MediaRecorder`). Correm bem em Android/Chrome; o iOS/Safari tem mais restrições e quirks (permissões em PWA instalada, formatos de áudio). Testar cedo no dispositivo real que vou usar, não só no desktop — é aqui que uma PWA mais "range", e o eventual motivo para empacotar como app nativa mais tarde.

---

## 3. Arquitetura conceptual

```
                    ┌──────────────────────────────┐
   Foto da fatura → │  INGESTÃO                     │ → MySQL app_<PROJ>
                    │  (VLM direto  OU  OCR + LLM)  │   (itens, preços,
                    └──────────────────────────────┘    data, loja)
                                                               │
                    ┌──────────────────────────────┐          │
   Nota de voz   →  │  CONSULTA (assíncrona)        │ ←────────┘
   "quanto paguei…" │  (áudio → texto → LLM tool    │
                    │   use → query → resposta)     │ → Resposta em texto
                    └──────────────────────────────┘
```

Dois subsistemas independentes que partilham a BD. Toda a IA passa pelo **OpenRouter** (API compatível OpenAI), com uma só chave a cobrir texto, imagem e áudio.

---

## 4. Subsistema A — Ingestão de faturas

**Decisão: experimentar as duas abordagens e comparar.** Ambas correm via OpenRouter, trocando só modelo/endpoint.

- **Abordagem A — VLM direto:** mandar a imagem da fatura a um modelo multimodal e pedir JSON estruturado.
- **Abordagem B — OCR + LLM:** OCR no servidor (Tesseract / PaddleOCR / docTR) extrai texto bruto → LLM estrutura em JSON (só texto, mais barato).

*Pergunta a responder com dados reais:* em faturas térmicas amassadas/desbotadas, qual ganha em fiabilidade de **preço** e de **descrição**, e a que custo por fatura?

### 4.1 Regras de extração (casos reais das cadeias-alvo)

| Cenário | Regra |
| --- | --- |
| Fim de prazo de validade (etiqueta rosa Continente) | Detetar "Aprox. fim prazo validade", associar ao item acima, marcar `is_clearance` e isolar da série histórica |
| Desconto por item ("Poupança" sob o produto) | Subtrair ao bruto; registar o líquido; guardar `desconto_direto` |
| Desconto global no fim da nota (Cartão Continente) | NÃO espalhar pelos itens (distorcia cada preço): guardar em `fatura.desconto_global` como desconto da nota; cada `preco_liquido` = preço impresso na linha. Reconciliação: `Σbase − desconto_global` deve bater com o total pago |
| Itens não-produto (saco, taxas) | Marcar `is_non_product`; excluir do histórico de preços, manter para reconciliar o total |
| Multipack "N × preço" (Continente) / coluna "Quant" (grossista) | `quantidade` = N; `valor` = TOTAL da linha (não o unitário). Nunca deixar `quantidade` a null |
| IVA de grossista / cash-and-carry (Makro) | Preços das linhas SEM IVA; o IVA é somado ao total. Captar em `iva`; reconciliação `Σbase − desconto_global + iva = total`. (Nuance em aberto: comparar preço s/IVA do Makro com c/IVA do supermercado é injusto — falta normalizar) |

### 4.2 Normalização de SKU
`BOL DIGESTIVE AVEIA CNT 425GR` → `Bolacha Digestive de Aveia · Continente · 425g · Mercearia Doce`. É o pedaço mais subestimado: agrupar o **mesmo** produto escrito de formas diferentes entre lojas/datas é o que faz a consulta "onde está mais barato" funcionar. Candidato a experimentação: LLM puro vs. embeddings + similaridade.

---

## 5. Subsistema B — Consulta por nota de voz (o foco)

### 5.1 Fluxo (assíncrono, estilo WhatsApp)
Gravo → envio → transcrição + interpretação → **resposta em texto**. Sem streaming, sem tempo real, **sem TTS** no MVP. Resposta falada só se mais tarde quiser conversa de ida-e-volta.

### 5.2 Transcrição — experimentar e decidir depois
O OpenRouter (desde maio/2026) cobre áudio com a mesma chave. Duas vias a comparar, ambas dentro do OpenRouter:

- **Via 1 — STT separado:** endpoint dedicado `/api/v1/audio/transcriptions` (áudio base64 → JSON com texto), depois o texto vai ao LLM. Dá transcrição visível para debug; melhor para ver onde o STT erra em português europeu. Modelos: Whisper, GPT-4o Transcribe, Voxtral.
- **Via 2 — áudio direto:** `/api/v1/chat/completions` com conteúdo `input_audio` — o modelo transcreve + interpreta num só passo. Menos código, menos visibilidade do passo de transcrição.

*Detalhe de implementação:* áudio tem de ir **base64** (URLs não são suportados para áudio). Não é preciso nada fora do OpenRouter — Whisper local fica como opção apenas se quiser, por custo ou privacidade.

### 5.3 Interpretação — tool use (não slot-filling)
Dar ao LLM as funções de consulta como **ferramentas (function calling)** e deixá-lo traduzir a consulta em chamadas. Lida com fraseados imprevistos e perguntas compostas. Funções a expor:
- `buscar_ultima_compra(produto)`
- `comparar_precos_por_loja(produto)`
- `historico_preco(produto, intervalo)`
- `total_gasto(categoria_ou_produto, periodo)`

Exemplo: *"quanto paguei pela manteiga e onde"* → modelo chama `buscar_ultima_compra("manteiga")` → recebe `{preco:2.19, loja:"Pingo Doce", data:"2026-05-28"}` → responde em texto: *"Pagaste 2,19 € no Pingo Doce, a 28 de maio."*

### 5.4 Alerta de português europeu
Testar o STT cedo com a minha voz, sobretudo nomes de marca ("Mimosa", "Pingo Doce") e preços ditos em voz alta ("dois e dezanove"). Se a transcrição escorrega, o tool use recebe lixo e a resposta sai errada — é o ponto de falha mais provável da cadeia.

---

## 6. Modelo de dados (conceptual)

Sem `user_id` (utilizador único). Entidades mínimas:

- **fatura** — loja, NIF, data/hora, total impresso, total reconciliado, caminho do ficheiro original.
- **item** — fatura_id, descrição_original, descrição_normalizada, sku_normalizado_id, quantidade, preço_unitário, preço_líquido, flags (`is_clearance`, `desconto_direto`, `is_non_product`).
- **sku_normalizado** — nome canónico, marca, formato/peso, categoria (é o que liga o mesmo produto entre lojas/datas).
- **loja** — nome, cadeia, localização em Braga.

(Schema detalhado é trabalho do Claude Code; isto fixa as entidades e o porquê de cada uma.)

---

## 7. Autenticação — DECISÃO FECHADA (2026-06-04): Google OAuth + `SUPERUSER_EMAIL`

**Decisão:** o servidor **vai estar exposto à internet**. Logo, usa-se **Google OAuth completo** (Authorization Code no backend, sessão em JWT em cookie httpOnly) + `SUPERUSER_EMAIL`, exatamente como no runbook do 1417 (padrão já testado).

**Porquê:** estando a PWA pública, o OAuth protege a app e o `SUPERUSER_EMAIL` garante que **só o meu email** entra. Foi a opção mais restritiva — e, com o servidor exposto, é a única coerente. A alternativa "auth mínima/nenhuma" só fazia sentido em rede local/VPN, que ficou de fora.

**Consequência de design (importante para os Blocos 2 e 3):** como a app fica exposta, a proteção dos endpoints **não é opcional**. São duas camadas distintas, ambas necessárias:
- `SUPERUSER_EMAIL` controla **quem** entra (na callback do OAuth).
- O **middleware de auth nas rotas** impede chamadas **anónimas**. Os endpoints de **upload de fatura** e de **consulta** exigem sessão autenticada — sem isso, qualquer pessoa que descubra o URL pode gastar a chave OpenRouter ou escrever na BD. Confirmar que o middleware cobre estas rotas quando forem implementadas.

---

## 8. Infraestrutura (resumo do runbook — detalhe no ficheiro de bootstrap)

Padrão do 1417, sem quebrar os projetos vizinhos (pitacos.ai, 1417):

- **Stack:** Node/Express + React/Vite (PWA) + MySQL no host + Apache (proxy + serve `dist/`) + Let's Encrypt.
- **Isolamento:** utilizador Linux próprio, BD `app_<PROJ>` e user MySQL próprios (GRANT só em `app_<PROJ>.*`), porta local própria — **`4200`** (confirmar livre com `ss -tln`).
- **Backend:** serviço systemd `<PROJ>-backend.service`, dotenv a partir do WorkingDirectory.
- **Uploads:** `/var/lib/<PROJ>/...` para faturas; **acrescentar um diretório próprio para notas de voz** (não estava no runbook). Apache `LimitRequestBody` 12 MB chega de sobra para áudio curto e fotos de fatura.
- **Segurança de processo:** sudo temporário durante a instalação, **revogado no fim**; `.env` chmod 600; UFW com SSH (22) libertado antes de habilitar.

### 8.1 Variáveis de ambiente relevantes para a IA (valores no `.env`, não aqui)
- `OPENROUTER_API_KEY` — usar a chave de laboratório existente, com limite de gasto partilhado por todos os projetos de laboratório (decisão tomada). O limite plafona o risco de custo.
- `OPENROUTER_MODEL` — `google/gemini-2.5-flash` como ponto de partida; trocável por string para as comparações.
- `OPENROUTER_TIMEOUT_MS` — 20000 herdado; **vigiar** — pode ser curto para uma imagem de fatura grande num VLM. Subir se necessário.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` / `SUPERUSER_EMAIL` — só se a auth OAuth for confirmada (§7). Para projeto realmente separado, criar um OAuth Client novo em vez de reusar o do 1417.

---

## 9. Ordem de construção sugerida

1. **Bootstrap de infra** pelo runbook (utilizador, BD, systemd, Apache, HTTPS, smoke test).
2. **Ingestão**, só Continente + Pingo Doce, começando por VLM direto — objetivo: ter ~30-50 faturas minhas estruturadas na BD.
3. **Funções de consulta em texto** — implementar as 4 funções (§5.3) e testá-las escrevendo as perguntas, sem voz ainda. Validar a lógica de dados antes do áudio.
4. **Camada de nota de voz** — gravar áudio na PWA → transcrição/interpretação (Via 1 ou 2) → resposta em texto.
5. **Comparações** (o verdadeiro produto deste laboratório): VLM vs. OCR+LLM; STT-separado vs. áudio-direto; português europeu em cada STT.
6. **Esticar:** restantes cadeias; normalização com embeddings para consulta cross-loja; e — só se quiser conversa falada — TTS (também já disponível no OpenRouter) e eventual modo tempo real.

---

## 10. Decisões em aberto (a fechar com dados / com o Claude Code)

1. **Transcrição da voz:** STT separado vs. áudio-direto — decidir após experimentar (§5.2).
2. **Leitura de fatura:** VLM direto vs. OCR+LLM — decidir após comparar (§4).
3. ~~**Autenticação:** depende de o servidor estar ou não exposto à internet.~~ **FECHADA (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL` (§7).

---

## 11. Perguntas técnicas que quero responder

- Um VLM multimodal lê faturas térmicas amassadas melhor que OCR dedicado + LLM?
- O STT (Whisper/GPT-4o/Voxtral via OpenRouter) aguenta português europeu com marcas e preços ditos em voz alta?
- Transcrever em passo separado dá-me melhor controlo, ou áudio-direto num só passo é suficiente (e melhor)?
- Function calling a partir da consulta transcrita é robusto para perguntas compostas, ou parte-se?
- A normalização de SKU agrupa o mesmo produto entre cinco lojas bem o suficiente para a comparação de preços fazer sentido?
