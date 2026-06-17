# Extrai o USDA SR Legacy (FoodData Central, DOMÍNIO PÚBLICO) -> data/usda.json.
# Nomes em INGLÊS (traduzidos depois no carregar_usda.mjs). Nutrição por 100g. Salta categorias
# muito US-específicas/ruidosas (fast food, restaurante, baby food, pratos prontos, indígena US).
#   python scripts/extrair_usda.py   (precisa dos CSV em data/usda/FoodData_Central_sr_legacy_food_csv_*/)
import csv, json, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = next(iter(glob.glob(str(ROOT / "data" / "usda" / "FoodData_Central_sr_legacy_food_csv_*"))))
OUT = ROOT / "data" / "usda.json"

# nutrient_nbr (USDA, estável) -> campo nosso
CAMPO_NBR = {"208": "energia_kcal", "203": "proteina", "204": "gordura", "205": "hidratos",
             "291": "fibra", "269": "acucares", "307": "sal_na", "606": "gordura_saturada"}
DENY = {"Baby Foods", "Fast Foods", "American Indian/Alaska Native Foods", "Restaurant Foods",
        "Meals, Entrees, and Side Dishes"}
# o SR Legacy mistura itens de MARCA (ex.: "Pillsbury Golden Layer Buttermilk Biscuits") que não
# servem de genérico — descarta-os. Genérico = "Alimento, descritor…" (cabeça curta, sem marca);
# marca = cabeça (antes da 1.ª vírgula) com ≥3 palavras ou palavra de empresa.
MARCA_KW = ("foods", "bakeries", "company", "brands", "mills", "inc", "llc", "co.", "kitchen", "farms")
def parece_marca(desc):
    cab = desc.split(",")[0]
    pal = cab.split()
    return len(pal) >= 3 or any(k in cab.lower() for k in MARCA_KW)

def rd(nome):
    with open(Path(DIR) / nome, encoding="utf-8") as f:
        yield from csv.DictReader(f)

# 1) nutrient_nbr -> id FDC
id2campo = {}
for r in rd("nutrient.csv"):
    c = CAMPO_NBR.get(r.get("nutrient_nbr", "").strip())
    if c: id2campo[r["id"]] = c

# 2) categorias + alimentos a manter
cat = {r["id"]: r["description"] for r in rd("food_category.csv")}
food = {}
marcas = 0
for r in rd("food.csv"):
    c = cat.get(r["food_category_id"], "?")
    if c in DENY: continue
    if parece_marca(r["description"]): marcas += 1; continue
    food[r["fdc_id"]] = {"nome_en": r["description"], "_cat": c, "nut": {}}
print(f"itens de marca descartados: {marcas}")

# 3) varrer food_nutrient (36MB) e colher os 8 nutrientes dos alimentos mantidos
for r in rd("food_nutrient.csv"):
    f = food.get(r["fdc_id"])
    if not f: continue
    campo = id2campo.get(r["nutrient_id"])
    if not campo: continue
    try: f["nut"][campo] = round(float(r["amount"]), 3)
    except (ValueError, TypeError): pass

# 4) montar registos (salta sem energia; sódio->sal)
registos = []
for fid, f in food.items():
    n = f["nut"]
    if not n.get("energia_kcal"): continue
    na = n.pop("sal_na", None)
    nut = {k: n.get(k) for k in ("energia_kcal", "proteina", "gordura", "gordura_saturada", "hidratos", "fibra")}
    nut["sal"] = round(na * 2.5 / 1000, 3) if na is not None else None
    nut["acucares"] = n.get("acucares")
    registos.append({"fonte": "usda", "nome_en": f["nome_en"], "nut": nut})

OUT.write_text(json.dumps(registos, ensure_ascii=False), encoding="utf-8")
print(f"-> usda.json: {len(registos)} alimentos (de {len(food)} mantidos; {len(food)-len(registos)} sem energia)")
for r in registos[:5]:
    print("  ", r["nome_en"][:42], "| kcal", r["nut"]["energia_kcal"], "prot", r["nut"]["proteina"])
