// Pré-processamento da imagem da fatura ANTES do VLM: facilita a leitura e
// corta custo/tempo (a foto crua do telemóvel tem 3–5 MB; não é preciso).
//  - orientação EXIF, redimensiona (o GANHO real: o VLM cobra por resolução),
//  - normaliza contraste (térmicas desbotadas), leve nitidez.
// Cinza está DESLIGADO por defeito: o A/B mostrou que não muda a qualidade
// (mesma taxa de reconciliação) nem o custo (tokens são por resolução), e
// descartava a cor. O ORIGINAL é guardado em disco à parte (auditoria/
// re-extração); isto é só para a chamada ao modelo. Em erro, devolve o original.
import sharp from 'sharp';

export async function preProcessarImagem(buffer, { largura = 1400, cinza = false } = {}) {
  try {
    let p = sharp(buffer)
      .rotate() // aplica a orientação EXIF (foto de telemóvel)
      .resize({ width: largura, withoutEnlargement: true });
    if (cinza) p = p.grayscale();
    const out = await p
      .normalize() // estica o contraste
      .sharpen()
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch {
    return { buffer, mime: 'image/jpeg' };
  }
}
