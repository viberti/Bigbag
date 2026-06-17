# Extrai uFiSh + uPulses (FAO/INFOODS, CC BY-NC-SA 3.0 IGO) -> data/fao.json.
# Nomes em INGLÊS (traduzidos depois, no carregar_fao.mjs). Nutrição por 100g EP, forma-base
# (cru p/ peixe; cru/seco p/ leguminosas). 1 registo por espécie, com macros completas.
#   python scripts/extrair_fao.py
import json, openpyxl
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "data" / "fao"
OUT = Path(__file__).resolve().parent.parent / "data" / "fao.json"

# (ficheiro, folha, col_nome, col_estado, prefixos-estado-base, mapa de nutrientes [col 0-based])
FONTES = [
    ("uFiSh1.0.xlsx", "04 NV_sum (per 100 g EP)", 3, 5, ("r",),
     dict(energia_kcal=10, proteina=13, gordura=14, hidratos=15, fibra=16, sal_na=24, gordura_saturada=62, acucares=None)),
    ("uPulses1.0.xlsx", "04 NV_sum (per 100 g EP on FW)", 2, 3, ("r", "d"),
     dict(energia_kcal=8, proteina=11, gordura=14, hidratos=12, fibra=13, sal_na=27, gordura_saturada=17, acucares=None)),
]

def num(v):
    if v is None: return None
    s = str(v).strip().replace(",", ".")
    if s in ("", "-", "tr", "Tr", "[]", "nd", "NA", "na"): return None
    try: return round(float(s), 3)
    except ValueError: return None

def especie(nome):  # cabeça da espécie = antes da 1ª vírgula
    return nome.split(",")[0].strip().lower()

def estado_base(estado, prefixos):  # 'r'/'d/r' batem com prefixos de forma-base
    e = (estado or "").strip().lower()
    return any(e.startswith(p) for p in prefixos)

registos = []
for fich, folha, c_nome, c_est, prefs, M in FONTES:
    wb = openpyxl.load_workbook(BASE / fich, read_only=True, data_only=True)
    ws = wb[folha]
    porEspecie = {}
    for row in ws.iter_rows(min_row=3, values_only=True):  # r1=códigos, r2=descrições
        if not row or c_nome >= len(row): continue
        nome = row[c_nome]
        if not nome or not str(nome).strip(): continue
        nome = str(nome).strip()
        kcal = num(row[M["energia_kcal"]]) if M["energia_kcal"] < len(row) else None
        if not kcal: continue  # sem energia = buraco, salta (como na TACO)
        na = num(row[M["sal_na"]]) if M["sal_na"] is not None and M["sal_na"] < len(row) else None
        nut = dict(
            energia_kcal=kcal,
            proteina=num(row[M["proteina"]]),
            gordura=num(row[M["gordura"]]),
            gordura_saturada=num(row[M["gordura_saturada"]]) if M["gordura_saturada"] < len(row) else None,
            hidratos=num(row[M["hidratos"]]),
            fibra=num(row[M["fibra"]]),
            sal=round(na * 2.5 / 1000, 3) if na is not None else None,
            acucares=None,
        )
        est = row[c_est] if c_est < len(row) else None
        base = estado_base(est, prefs)
        esp = especie(nome)
        # 1 por espécie: prefere a forma-base (cru/seco); senão a 1ª que aparecer
        atual = porEspecie.get(esp)
        if atual is None or (base and not atual["_base"]):
            porEspecie[esp] = {"nome_en": nome, "nut": nut, "_base": base}
    for esp, r in porEspecie.items():
        registos.append({"fonte": fich.split("1")[0].lower(), "nome_en": r["nome_en"], "nut": r["nut"]})
    wb.close()
    print(f"{fich}: {len(porEspecie)} espécies")

OUT.write_text(json.dumps(registos, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"-> {OUT.name}: {len(registos)} registos")
# amostra
for r in registos[:6] + registos[-4:]:
    print("  ", r["nome_en"][:40], "| kcal", r["nut"]["energia_kcal"], "prot", r["nut"]["proteina"])
