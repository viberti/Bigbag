# Parser da lista "Affichage QCE consommateur" do Lidl FR (PDF, 492 pags) →
# lidl_qce.jsonl com {eans, nome, formato, marca}. A chave util e o EAN
# (igual em toda a Europa, incl. os codigos curtos 2xxxxxxx das lojas).
import json
import re
import sys

raw = open(r'C:\ProjetosAI\Bigbag\backend\scripts\lidl_qce_raw.txt', encoding='utf-8').read()
raw = raw.replace('\n<<<PAG>>>\n', ' ')
# cabecalhos de tabela repetidos por pagina
raw = re.sub(r'Date de mise . jour.*?P.nalit.s appliqu.es au\s+produit', ' ', raw, flags=re.S)
raw = re.sub(r'\s+', ' ', raw)

# registos comecam numa data dd/mm/yyyy
partes = re.split(r'(\d{2}/\d{2}/\d{4})', raw)
regs = []
for i in range(1, len(partes) - 1, 2):
    regs.append(partes[i + 1].strip())

CORTES = re.compile(
    r'(Emballage|Emballages|rPET|R.duction de poids|Incorporation|Possiblit.|Recyclabilit.|'
    r'Pr.sence de|Sans substance|Compo stabilit.|Primes? appliqu|P.nalit.s? appliqu|mat.riaux recycl).*$',
    re.I,
)
FORMATO = re.compile(
    r'(\d[\d.,]*\s?(?:x\s?\d[\d.,]*\s?)?(?:kg|g|gr|ml|cl|l|litres?|pi.ces?|pcs|unit.s?|doses?|lavages?|feuilles?|sachets?|capsules?|tablettes?)\b\.?)',
    re.I,
)

def gtin_ok(c):
    if not re.fullmatch(r'\d{8}|\d{12,14}', c):
        return False
    d = [int(x) for x in c]
    chk = d.pop()
    s = 0
    for idx, v in enumerate(reversed(d)):
        s += v * (3 if idx % 2 == 0 else 1)
    return (10 - s % 10) % 10 == chk

out, sem_ean, ean_inval = [], 0, 0
for r in regs:
    eans_raw = re.findall(r'\b\d{8}\b|\b\d{12,14}\b', r)
    texto = re.sub(r'\b\d{8,14}\b', ' ', r)
    texto = CORTES.sub('', texto)
    texto = re.sub(r'\s+', ' ', texto).strip(' -;,')
    if not eans_raw:
        sem_ean += 1
        continue
    eans = [e for e in eans_raw if gtin_ok(e)]
    ean_inval += len(eans_raw) - len(eans)
    if not eans:
        continue
    # ultimo formato no texto; marca = o que vem depois dele
    nome, formato, marca = texto, None, None
    ms = list(FORMATO.finditer(texto))
    if ms:
        m = ms[-1]
        formato = m.group(1).strip()
        cauda = texto[m.end():].strip(' -;,')
        cauda = re.sub(r'\s*\d+\s*%\s*$', '', cauda).strip(' -;,')  # rPET "40%" colado
        if 0 < len(cauda) <= 40 and not re.search(r'\d{3}', cauda):
            marca = cauda
        nome = texto[:m.end()].strip(' -;,')
    if not nome or len(nome) < 3:
        continue
    out.append({'eans': eans, 'nome': nome[:255], 'formato': formato, 'marca': marca})

with open(r'C:\ProjetosAI\Bigbag\backend\scripts\lidl_qce.jsonl', 'w', encoding='utf-8') as f:
    for o in out:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

print(f'registos: {len(regs)} | produtos com EAN valido: {len(out)} | sem EAN: {sem_ean} | EANs invalidos descartados: {ean_inval}')
print(f'EANs totais: {sum(len(o["eans"]) for o in out)} | com marca: {sum(1 for o in out if o["marca"])}')
for o in out[:6] + out[3000:3003]:
    print('  ·', o['eans'][:2], '|', o['nome'][:60], '|', o['formato'], '|', o['marca'])
